import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createAdminChatStream, loadMatterContext, type AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { adminChatToolset } from '@/lib/adminChat/toolset'
import { READ_DOCUMENT_TEXT_TOOL_NAME } from '@/lib/adminChat/matterKnowledgeTools'
import { replayMessagesForModel } from '@/lib/assistantChats'
import {
  appendMatterAssistantTurns,
  clearMatterAssistantHistory,
  listMatterAssistantHistory,
} from '@/lib/matterAssistantHistory'
import { executeMcpToolCall, loadMcpToolsForUser } from '@/lib/matterAssistantTools'
import { consumeRateLimit } from '@/lib/rateLimit'

// The MCP tool loop can run for a while; give it the same headroom the other
// chat lanes get rather than inheriting the platform default mid-stream.
export const maxDuration = 120

/** Matches the admin chat lane: generous enough to work, tight enough to notice abuse. */
const RATE_LIMIT = { bucket: 'matter_assistant', limit: 60, windowSeconds: 600 }

const MAX_TOOL_ROUNDS = 4

/** The drafts the attorney has open in the Review step, named so the model can pick which to read. */
async function attachedDocumentsNote(matterId: string, documentIds: string[]): Promise<string> {
  const ids = documentIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 12)
  if (ids.length === 0) return ''
  const { data } = await getAdminClient()
    .from('matter_documents')
    .select('id, name')
    .eq('matter_id', matterId)
    .in('id', ids)
  const rows = (data ?? []) as Array<{ id: string; name: string | null }>
  const lines = ids.map(id => {
    const row = rows.find(candidate => candidate.id === id)
    return `- ${row?.name ?? 'Untitled document'} (document_id: ${id})`
  })
  return `\n\nATTACHED DRAFTS: The attorney has these drafts open in the Review step (first is the one on screen):\n${lines.join('\n')}\nUse \`${READ_DOCUMENT_TEXT_TOOL_NAME}\` with a document_id to read one before quoting, comparing or proposing edits to it.`
}

/**
 * Staff MCP connectors, exposed to the shared loop as ordinary tools. The
 * connector session is per request, as before.
 */
async function mcpToolExecutors(userId: string): Promise<AdminChatToolExecutor[]> {
  let loaded: Awaited<ReturnType<typeof loadMcpToolsForUser>>
  try {
    loaded = await loadMcpToolsForUser(getAdminClient(), userId)
  } catch {
    // connectors table may be absent
    return []
  }
  return loaded.tools.map(definition => ({
    tool: {
      name: definition.name,
      description: definition.description,
      input_schema: definition.inputSchema as AdminChatToolExecutor['tool']['input_schema'],
    },
    execute: async (input, { toolUseId, emit }) => {
      const entry = loaded.registry.find(candidate => candidate.llmName === definition.name)
      emit({ tool: definition.name, tool_use_id: toolUseId, status: 'running', result: { connector: entry?.connectorName ?? null } })
      const executed = await executeMcpToolCall(loaded.registry, definition.name, (input ?? {}) as Record<string, unknown>)
      if (!executed.ok) {
        emit({ tool: definition.name, tool_use_id: toolUseId, status: 'error', error: executed.error })
        return { content: JSON.stringify({ ok: false, error: executed.error }), isError: true }
      }
      emit({
        tool: definition.name,
        tool_use_id: toolUseId,
        status: 'done',
        result: { connector: executed.connectorName, tool: executed.mcpToolName },
      })
      return { content: executed.text }
    },
  }))
}

/**
 * GET /api/admin/matters/[id]/assistant — chat history for this matter + user.
 * DELETE — clear history.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const admin = getAdminClient()
  const turns = await listMatterAssistantHistory(admin, matterId, user.id)
  return NextResponse.json({ turns })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const admin = getAdminClient()
  await clearMatterAssistantHistory(admin, matterId, user.id)
  return NextResponse.json({ ok: true })
}

/**
 * PATCH /api/admin/matters/[id]/assistant — append already-completed turns.
 * Used by the global assistant panel (whose chat engine is /api/admin/chat)
 * so both surfaces share one thread per matter.
 * Body: { turns: Array<{ role: 'user' | 'assistant', content: string }> }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const body = (await req.json().catch(() => null)) as {
    turns?: Array<{ role?: string; content?: string }>
  } | null
  const rawTurns = body?.turns
  if (!Array.isArray(rawTurns) || rawTurns.length === 0 || rawTurns.length > 4) {
    return NextResponse.json({ error: 'turns must be an array of 1-4 items' }, { status: 400 })
  }
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const turn of rawTurns) {
    const content = typeof turn?.content === 'string' ? turn.content.trim() : ''
    if ((turn?.role !== 'user' && turn?.role !== 'assistant') || !content) {
      return NextResponse.json({ error: 'each turn needs a role and non-empty content' }, { status: 400 })
    }
    turns.push({ role: turn.role, content: content.slice(0, 32_000) })
  }

  const admin = getAdminClient()
  await appendMatterAssistantTurns(admin, matterId, user.id, turns)
  return NextResponse.json({ ok: true })
}

/**
 * POST /api/admin/matters/[id]/assistant
 * Body: { message: string, documentIds?: string[] }
 *
 * The Review step's assistant. It used to be its own chat lane — a
 * user-preference LLM, a five-field design snapshot and document names for
 * context, no firm-record tools. It now runs the shared engine with the full
 * matter prompt and the same tool set as the Assistant page and the rail; the
 * per-matter thread it shares with the rail is unchanged.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = await consumeRateLimit(RATE_LIMIT, user.id)
  if (!limit.ok) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    })
  }

  const { id: matterId } = await params
  const body = (await req.json().catch(() => null)) as { message?: string; documentIds?: unknown } | null
  const message = body?.message?.trim()
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  const documentIds = Array.isArray(body?.documentIds) ? body.documentIds.filter((id): id is string => typeof id === 'string') : []

  let context: Awaited<ReturnType<typeof loadMatterContext>>
  try {
    context = await loadMatterContext(matterId)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (/not found/i.test(detail)) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    console.error('[matter-assistant] context failed', { matterId, error: detail })
    return NextResponse.json({ error: 'Unable to load the matter' }, { status: 500 })
  }

  const admin = getAdminClient()
  const [attachedNote, mcpTools, history] = await Promise.all([
    attachedDocumentsNote(matterId, documentIds),
    mcpToolExecutors(user.id),
    listMatterAssistantHistory(admin, matterId, user.id),
  ])

  const toolset = adminChatToolset({
    contextType: 'matter',
    contextId: matterId,
    user: { id: user.id, email: user.email ?? null, user_metadata: user.user_metadata },
    surface: 'rail',
  })
  const reviewStepNote = `\n\nREVIEW STEP: The attorney is reviewing generated drafts for this matter. Help with design-sheet questions, draft review notes, fiduciary consistency across documents, marker cleanup and redline suggestions. When suggesting Word edits, propose short find/replace anchors with enough surrounding text to be unambiguous.${mcpTools.length > 0 ? ` Staff connector tools (${mcpTools.length}) are available; prefer the matter record first.` : ''}`

  const messages = [
    ...replayMessagesForModel(history.map(turn => ({ role: turn.role, content: turn.content, events: [] }))),
    { role: 'user' as const, content: message },
  ]

  return createAdminChatStream({
    system: context.systemPrompt + toolset.promptNotes + reviewStepNote + attachedNote,
    messages,
    tools: [...toolset.tools, ...mcpTools],
    maxIterations: MAX_TOOL_ROUNDS,
    usage: { route: 'matters/assistant', contextType: 'matter', matterId, userId: user.id },
    onComplete: async ({ text, success }) => {
      // Failed sends persist nothing, as before; a stopped reply keeps what
      // was shown so a reload matches the screen.
      if (!success || !text.trim()) return
      try {
        await appendMatterAssistantTurns(admin, matterId, user.id, [
          { role: 'user', content: message },
          { role: 'assistant', content: text },
        ])
      } catch (error) {
        console.error('[matter-assistant] failed to persist turns', { matterId, error })
      }
    },
  })
}
