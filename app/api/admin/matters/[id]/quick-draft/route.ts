import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/buildDraftPayload'
import {
  describeField,
  isOverridablePath,
  renderSingleTemplateForMatter,
} from '@/lib/drafting/quickDraft'
import { persistDraftDocument, DOCX_CONTENT_TYPE } from '@/lib/drafting/persistGeneratedDocument'
import { documentKindForTemplate } from '@/lib/execution/documentKind'
import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'
import { buildDraftDocumentName } from '@/lib/estateGenerator/draftDocumentName'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'
import { customTemplateId, listCustomTemplates } from '@/lib/documentTemplates/customTemplates'

export const runtime = 'nodejs'

type QuickDraftMode = 'analyze' | 'download' | 'save'

function parseMode(value: unknown): QuickDraftMode | null {
  return value === 'analyze' || value === 'download' || value === 'save' ? value : null
}

function parseOverrides(value: unknown):
  | { ok: true; overrides: Record<string, string> }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, overrides: {} }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'overrides must be an object of field path → value' }
  }
  const overrides: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isOverridablePath(key)) {
      return { ok: false, error: `Field path is not overridable: ${key}` }
    }
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue
    const text = String(raw)
    if (text.trim() === '') continue
    overrides[key] = text
  }
  return { ok: true, overrides }
}

type Params = { params: Promise<{ id: string }> }

/** Template picker data: estate templates plus this matter's saved quick-draft answers. */
export async function GET(req: NextRequest, { params }: Params) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  try {
    const canonicalMatterId = await resolveMatterId(matterId).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!canonicalMatterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    const admin = getAdminClient()
    const { data: sheetRow } = await admin
      .from('design_sheets')
      .select('decisions')
      .eq('matter_id', canonicalMatterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const decisions = sheetRow?.decisions as Record<string, unknown> | null | undefined
    const savedAnswers = decisions?.quick_draft && typeof decisions.quick_draft === 'object' && !Array.isArray(decisions.quick_draft)
      ? decisions.quick_draft as Record<string, Record<string, string>>
      : {}

    const templates = getDocumentTemplateRegistry()
      .filter(definition => definition.category === 'estate')
      .map(definition => ({
        id: definition.id,
        label: definition.label,
        packageNames: definition.packageNames,
        custom: false,
      }))

    const { templates: customRows } = await listCustomTemplates(admin as never)
    const customTemplates = customRows.map(row => ({
      id: customTemplateId(row.id),
      label: row.label,
      packageNames: ['custom'],
      custom: true,
    }))

    return NextResponse.json({ templates: [...templates, ...customTemplates], savedAnswers })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load quick-draft templates'
    return NextResponse.json({ error: message }, { status: message.startsWith('Matter not found') ? 404 : 500 })
  }
}

/**
 * One-off document generation for a matter. Unlike the full draft run this
 * tolerates missing/partial design sheets and non-hired matters: whatever the
 * matter data cannot resolve is reported back as `missingFields` for the
 * quick-draft form, and overrides fill the gaps at render time.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as {
    templateId?: unknown
    overrides?: unknown
    mode?: unknown
  } | null

  const templateId = typeof body?.templateId === 'string' ? body.templateId : null
  const mode = parseMode(body?.mode)
  if (!templateId || !mode) {
    return NextResponse.json({ error: 'templateId and mode (analyze|download|save) are required' }, { status: 400 })
  }
  const parsedOverrides = parseOverrides(body?.overrides)
  if (!parsedOverrides.ok) {
    return NextResponse.json({ error: parsedOverrides.error }, { status: 400 })
  }
  const overrides = parsedOverrides.overrides

  try {
    const canonicalMatterId = await resolveMatterId(matterId).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!canonicalMatterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    const rendered = await renderSingleTemplateForMatter({
      matterId: canonicalMatterId,
      templateId,
      overrides,
      allowPartial: true,
    })

    if (mode === 'analyze') {
      return NextResponse.json({
        outputFilename: rendered.outputFilename,
        title: rendered.title,
        packageName: rendered.packageName,
        templateSource: rendered.templateSource,
        missingFields: rendered.missingFields.map(describeField),
        unresolvedMarkers: rendered.unresolvedMarkers,
        warnings: rendered.warnings,
      })
    }

    const generationDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const documentName = buildDraftDocumentName({
      date: generationDate,
      owner: rendered.ownerName,
      title: rendered.title,
    })
    const scan = scanDocxBufferForMarkers(rendered.buffer)

    if (mode === 'download') {
      return new Response(new Uint8Array(rendered.buffer), {
        headers: {
          'Content-Type': DOCX_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${documentName.replace(/"/g, '')}"`,
          'X-Missing-Count': String(scan.missingFields.length),
          'X-Marker-Count': String(scan.markerCount),
        },
      })
    }

    // mode === 'save'
    const admin = getAdminClient()
    const { documentId } = await persistDraftDocument({
      admin,
      matterId: canonicalMatterId,
      buffer: rendered.buffer,
      documentName,
      actorId: user.id,
      generationId: randomUUID(),
      generationEngine: 'quick-draft',
      markerCount: scan.markerCount,
      missingCount: scan.missingFields.length,
      documentKind: documentKindForTemplate({ templateId, title: rendered.title ?? null }),
      templateId,
      templateVersionId: rendered.templateVersionId,
    })

    // Remember the answers so the next quick draft (and a later full design
    // sheet) pre-fills them. Best-effort: requires an existing sheet row.
    const overrideEntries = Object.entries(overrides)
    if (rendered.designSheetId && overrideEntries.length > 0) {
      const { data: sheetRow } = await admin
        .from('design_sheets')
        .select('id, decisions')
        .eq('id', rendered.designSheetId)
        .maybeSingle()
      if (sheetRow) {
        const decisions = (sheetRow.decisions && typeof sheetRow.decisions === 'object' && !Array.isArray(sheetRow.decisions)
          ? { ...(sheetRow.decisions as Record<string, unknown>) }
          : {}) as Record<string, unknown>
        const quickDraft = (decisions.quick_draft && typeof decisions.quick_draft === 'object' && !Array.isArray(decisions.quick_draft)
          ? { ...(decisions.quick_draft as Record<string, unknown>) }
          : {}) as Record<string, unknown>
        quickDraft[templateId] = Object.fromEntries(overrideEntries)
        decisions.quick_draft = quickDraft
        const { error: decisionsErr } = await admin
          .from('design_sheets')
          .update({ decisions })
          .eq('id', rendered.designSheetId)
        if (decisionsErr) {
          console.warn('[quick-draft route] failed to persist quick-draft answers', decisionsErr)
        }
      }
    }

    return NextResponse.json({
      success: true,
      documentId,
      documentName,
      markerCount: scan.markerCount,
      missingCount: scan.missingFields.length,
      missingFields: scan.missingFields,
      unresolvedMarkers: scan.unresolved,
      warnings: rendered.warnings,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Quick draft failed'
    const status = message.startsWith('Unknown document template')
      || message.startsWith('Quick draft supports')
      || message.startsWith('Field path is not overridable')
      ? 400
      : message.startsWith('Matter not found')
        ? 404
        : 500
    if (status === 500) console.error('[quick-draft route] error', matterId, e)
    return NextResponse.json({ error: message }, { status })
  }
}
