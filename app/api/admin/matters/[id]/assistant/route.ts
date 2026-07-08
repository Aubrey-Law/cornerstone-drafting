import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveApiKey } from '@/lib/userApiKeys'
import {
  DEFAULT_ANTHROPIC_MODEL,
  parseUserPreferences,
  resolveAnthropicModel,
} from '@/lib/userPreferences'
import { listMcpConnectors } from '@/lib/mcpConnectors'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'

/**
 * POST /api/admin/matters/[id]/assistant
 * Matter-scoped drafting assistant (non-streaming JSON for v1).
 * Body: { message: string, documentIds?: string[] }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const body = (await req.json().catch(() => null)) as {
    message?: string
    documentIds?: string[]
  } | null
  const message = body?.message?.trim()
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const admin = getAdminClient()
  const { data: matter } = await admin
    .from('matters')
    .select('id, name, stage')
    .eq('id', matterId)
    .maybeSingle()
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

  const { data: design } = await admin
    .from('design_sheets')
    .select('client_name, spouse_name, plan_type, trust_name, marital_status')
    .eq('matter_id', matterId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  let docSummary = ''
  const attachedDocIds = body?.documentIds ?? []
  if (attachedDocIds.length > 0) {
    const { data: docs } = await admin
      .from('matter_documents')
      .select(MATTER_DOCUMENT_COLUMNS)
      .eq('matter_id', matterId)
      .in('id', attachedDocIds.slice(0, 12))
    docSummary = (docs ?? [])
      .map(d => `- ${d.name} (${d.folder}, markers=${d.marker_count ?? '?'})`)
      .join('\n')
  } else {
    const { data: drafts } = await admin
      .from('matter_documents')
      .select('name, folder, marker_count')
      .eq('matter_id', matterId)
      .eq('folder', 'draft')
      .is('superseded_at', null)
      .limit(20)
    docSummary = (drafts ?? [])
      .map(d => `- ${d.name} (markers=${d.marker_count ?? '?'})`)
      .join('\n')
  }

  let connectorsNote = ''
  try {
    const connectors = await listMcpConnectors(admin, user.id)
    const enabled = connectors.filter(c => c.enabled)
    if (enabled.length > 0) {
      connectorsNote = `\nConfigured MCP connectors (not invoked in this turn): ${enabled.map(c => c.name).join(', ')}.`
    }
  } catch {
    // connectors table may be absent
  }

  const resolved = await resolveApiKey(admin, user.id, 'anthropic')
  if (!resolved.key) {
    return NextResponse.json(
      { error: 'No Anthropic API key configured. Add one in Settings → API Keys or set ANTHROPIC_API_KEY.' },
      { status: 501 },
    )
  }

  const { data: profile } = await admin.from('users').select('preferences').eq('id', user.id).maybeSingle()
  const model = resolveAnthropicModel(parseUserPreferences(profile?.preferences)) || DEFAULT_ANTHROPIC_MODEL

  const system = `You are Cornerstone Drafting assistant for Aubrey Law estate planning.
Help the attorney with design-sheet questions, draft review notes, fiduciary consistency, and redline suggestions.
Be concise and practical. Do not invent client facts.
When suggesting Word edits, propose short find/replace anchors with context.
${connectorsNote}`

  const userContent = `Matter: ${matter.name ?? matterId} (stage: ${matter.stage ?? 'unknown'})
Design snapshot: ${JSON.stringify(design ?? {})}
Active drafts:
${docSummary || '(none)'}

Attorney message:
${message}`

  try {
    const client = new Anthropic({ apiKey: resolved.key })
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
    const reply = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    return NextResponse.json({
      reply,
      model,
      keySource: resolved.source,
    })
  } catch (e) {
    console.error('[matter-assistant]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Assistant request failed' },
      { status: 500 },
    )
  }
}
