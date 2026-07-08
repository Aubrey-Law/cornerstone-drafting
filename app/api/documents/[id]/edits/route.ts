import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auditDocumentAccess, isAdminUser } from '@/lib/documentSecurity'
import {
  DOCX_CONTENT_TYPE,
  getDocumentApiUser,
  isDocxDocument,
  loadR2Bytes,
} from '@/lib/documentApiHelpers'
import {
  applyTrackedEdits,
  extractDocxBodyText,
  type EditInput,
} from '@/lib/docxTrackedChanges'
import {
  createDocumentVersion,
  ensureInitialVersion,
  loadActiveVersion,
} from '@/lib/documentVersions'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveApiKey } from '@/lib/userApiKeys'
import {
  DEFAULT_ANTHROPIC_MODEL,
  parseUserPreferences,
  resolveAnthropicModel,
} from '@/lib/userPreferences'
import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'

interface RedlineBody {
  /** Direct edits (skip LLM). */
  edits?: EditInput[]
  /** Free-text instruction for AI to propose find/replace edits. */
  instruction?: string
  author?: string
}

/**
 * GET /api/documents/[id]/edits — list pending/resolved edit cards.
 * POST — apply tracked edits (direct or AI-proposed) and create a new version.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const sb = getAdminClient()
  const { data: doc } = await sb.from('matter_documents').select(MATTER_DOCUMENT_COLUMNS).eq('id', id).single()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: edits, error } = await sb
    .from('document_edits')
    .select('*')
    .eq('document_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    if (error.message.includes('document_edits') || error.message.includes('schema cache')) {
      return NextResponse.json({ edits: [], unavailable: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ edits: edits ?? [] })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: doc, error } = await sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isDocxDocument(doc)) {
    return NextResponse.json({ error: 'Only DOCX documents support tracked edits' }, { status: 415 })
  }

  const body = (await req.json().catch(() => null)) as RedlineBody | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const audit = await auditDocumentAccess(sb, user, doc, 'edit', {
    route: '/api/documents/[id]/edits',
    mode: body.instruction ? 'ai' : 'direct',
  })
  if (!audit.ok) {
    return NextResponse.json({ error: 'Audit log write failed; access denied', code: 'audit_failed' }, { status: 503 })
  }

  try {
    await ensureInitialVersion({
      admin: sb,
      documentId: id,
      r2Key: doc.r2_key,
      filename: doc.name,
      contentType: doc.content_type || DOCX_CONTENT_TYPE,
      sizeBytes: doc.size,
      source: doc.generation_id ? 'generated' : 'upload',
      createdBy: user.id,
    })

    const version = await loadActiveVersion(sb, id)
    const bytes = await loadR2Bytes(version?.r2_key ?? doc.r2_key)

    let edits: EditInput[] = Array.isArray(body.edits) ? body.edits : []
    if (edits.length === 0 && body.instruction?.trim()) {
      edits = await proposeEditsWithAi({
        admin: sb,
        userId: user.id,
        instruction: body.instruction.trim(),
        docBytes: bytes,
      })
    }
    if (edits.length === 0) {
      return NextResponse.json({ error: 'No edits provided or proposed' }, { status: 400 })
    }

    const result = await applyTrackedEdits(bytes, edits, {
      author: body.author?.trim() || 'Cornerstone',
    })
    if (result.changes.length === 0) {
      return NextResponse.json(
        {
          error: 'No edits could be applied',
          errors: result.errors,
        },
        { status: 422 },
      )
    }

    const scan = scanDocxBufferForMarkers(result.bytes)
    const versionResult = await createDocumentVersion({
      admin: sb,
      documentId: id,
      matterId: doc.matter_id,
      bytes: result.bytes,
      filename: doc.name,
      contentType: DOCX_CONTENT_TYPE,
      source: 'assistant_edit',
      createdBy: user.id,
      folder: doc.folder || 'draft',
    })
    if ('error' in versionResult) {
      return NextResponse.json({ error: versionResult.error }, { status: 500 })
    }

    await sb
      .from('matter_documents')
      .update({ marker_count: scan.markerCount, missing_count: scan.missingFields.length })
      .eq('id', id)

    const editRows = result.changes.map(change => ({
      document_id: id,
      version_id: versionResult.version.id,
      change_id: change.id,
      del_w_id: change.delId ?? null,
      ins_w_id: change.insId ?? null,
      deleted_text: change.deletedText,
      inserted_text: change.insertedText,
      context_before: change.contextBefore,
      context_after: change.contextAfter,
      reason: change.reason ?? null,
      status: 'pending',
    }))

    const { data: insertedEdits, error: editErr } = await sb
      .from('document_edits')
      .insert(editRows)
      .select('*')

    if (editErr) {
      console.warn('[edits] document_edits insert failed', editErr.message)
    }

    return NextResponse.json({
      version: versionResult.version,
      changes: result.changes,
      errors: result.errors,
      edits: insertedEdits ?? [],
      markerCount: scan.markerCount,
    })
  } catch (err) {
    console.error('[edits]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply edits' },
      { status: 500 },
    )
  }
}

async function proposeEditsWithAi(args: {
  admin: ReturnType<typeof getAdminClient>
  userId: string
  instruction: string
  docBytes: Buffer
}): Promise<EditInput[]> {
  const resolved = await resolveApiKey(args.admin, args.userId, 'anthropic')
  if (!resolved.key) {
    throw new Error('No Anthropic API key configured (BYOK or ANTHROPIC_API_KEY)')
  }

  const { data: profile } = await args.admin
    .from('users')
    .select('preferences')
    .eq('id', args.userId)
    .maybeSingle()
  const model = resolveAnthropicModel(parseUserPreferences(profile?.preferences)) || DEFAULT_ANTHROPIC_MODEL

  const bodyText = await extractDocxBodyText(args.docBytes)
  const truncated = bodyText.slice(0, 80_000)

  const client = new Anthropic({ apiKey: resolved.key })
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are editing an estate-planning Word document using find/replace with short context anchors.

Document text (accepted view, paragraphs separated by newlines):
---
${truncated}
---

Attorney instruction:
${args.instruction}

Return ONLY a JSON array of edit objects (no markdown), each:
{"find":"...","replace":"...","context_before":"...","context_after":"...","reason":"..."}

Rules:
- find should be the minimal unique phrase to change (or "" for pure insert with context).
- context_before and context_after should be ~20-40 characters of surrounding text for disambiguation.
- Prefer 1-8 precise edits over broad rewrites.
- Do not invent parties or fiduciary names not supported by the document or instruction.`,
      },
    ],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []
  const parsed = JSON.parse(jsonMatch[0]) as EditInput[]
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    e =>
      e &&
      typeof e.find === 'string' &&
      typeof e.replace === 'string' &&
      typeof e.context_before === 'string' &&
      typeof e.context_after === 'string',
  )
}
