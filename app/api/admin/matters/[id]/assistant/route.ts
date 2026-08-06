import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { logAiUsage } from '@/lib/aiUsage'
import { runLlmChat, resolveLlmConfig } from '@/lib/llm'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import {
  appendMatterAssistantTurns,
  clearMatterAssistantHistory,
  listMatterAssistantHistory,
} from '@/lib/matterAssistantHistory'
import { executeMcpToolCall, loadMcpToolsForUser } from '@/lib/matterAssistantTools'

const MAX_TOOL_ROUNDS = 4

async function buildMatterContext(
  admin: ReturnType<typeof getAdminClient>,
  matterId: string,
  documentIds: string[],
) {
  const { data: matter } = await admin
    .from('matters')
    .select('id, name, stage')
    .eq('id', matterId)
    .eq('relationship_status', 'hired')
    .maybeSingle()
  if (!matter) return null

  const { data: design } = await admin
    .from('design_sheets')
    .select('client_name, spouse_name, plan_type, trust_name, marital_status')
    .eq('matter_id', matterId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  let docSummary = ''
  if (documentIds.length > 0) {
    const { data: docs } = await admin
      .from('matter_documents')
      .select(MATTER_DOCUMENT_COLUMNS)
      .eq('matter_id', matterId)
      .in('id', documentIds.slice(0, 12))
    docSummary = (docs ?? [])
      .map(d => `- ${d.name} (${d.shared_at ? 'shared' : 'internal'}, markers=${d.marker_count ?? '?'})`)
      .join('\n')
  } else {
    const { data: drafts } = await admin
      .from('matter_documents')
      .select('name, source, shared_at, marker_count')
      .eq('matter_id', matterId)
      .eq('source', 'firm')
      .is('superseded_at', null)
      .limit(20)
    docSummary = (drafts ?? [])
      .map(d => `- ${d.name} (markers=${d.marker_count ?? '?'})`)
      .join('\n')
  }

  return { matter, design, docSummary }
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
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
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const admin = getAdminClient()
  const turns = await listMatterAssistantHistory(admin, matterId, user.id)
  return Response.json({ turns })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const admin = getAdminClient()
  await clearMatterAssistantHistory(admin, matterId, user.id)
  return Response.json({ ok: true })
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
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const body = (await req.json().catch(() => null)) as {
    turns?: Array<{ role?: string; content?: string }>
  } | null
  const rawTurns = body?.turns
  if (!Array.isArray(rawTurns) || rawTurns.length === 0 || rawTurns.length > 4) {
    return Response.json({ error: 'turns must be an array of 1-4 items' }, { status: 400 })
  }
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const turn of rawTurns) {
    const content = typeof turn?.content === 'string' ? turn.content.trim() : ''
    if ((turn?.role !== 'user' && turn?.role !== 'assistant') || !content) {
      return Response.json({ error: 'each turn needs a role and non-empty content' }, { status: 400 })
    }
    turns.push({ role: turn.role, content: content.slice(0, 32_000) })
  }

  const admin = getAdminClient()
  await appendMatterAssistantTurns(admin, matterId, user.id, turns)
  return Response.json({ ok: true })
}

/**
 * POST /api/admin/matters/[id]/assistant
 * Body: { message: string, documentIds?: string[], stream?: boolean }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const body = (await req.json().catch(() => null)) as {
    message?: string
    documentIds?: string[]
    stream?: boolean
  } | null
  const message = body?.message?.trim()
  if (!message) return Response.json({ error: 'message is required' }, { status: 400 })
  const useStream = body?.stream !== false

  const admin = getAdminClient()
  const attachedDocIds = body?.documentIds ?? []
  const context = await buildMatterContext(admin, matterId, attachedDocIds)
  if (!context) return Response.json({ error: 'Matter not found' }, { status: 404 })

  const llmResolved = await resolveLlmConfig(admin, user.id)
  if (!llmResolved.ok) {
    return Response.json({ error: llmResolved.error }, { status: 501 })
  }
  const llm = llmResolved.config

  let mcpTools: Awaited<ReturnType<typeof loadMcpToolsForUser>>['tools'] = []
  let mcpRegistry: Awaited<ReturnType<typeof loadMcpToolsForUser>>['registry'] = []
  try {
    const loaded = await loadMcpToolsForUser(admin, user.id)
    mcpTools = loaded.tools
    mcpRegistry = loaded.registry
  } catch {
    // connectors table may be absent
  }

  const toolsNote =
    mcpRegistry.length > 0
      ? `\nYou have ${mcpRegistry.length} MCP tool(s) from staff connectors. Use them when they help answer the attorney; prefer matter/draft context first.`
      : ''

  const system = `You are Cornerstone Drafting assistant for Aubrey Law estate planning.
Help the attorney with design-sheet questions, draft review notes, fiduciary consistency, and redline suggestions.
Be concise and practical. Do not invent client facts.
When suggesting Word edits, propose short find/replace anchors with context.${toolsNote}

Matter: ${context.matter.name ?? matterId} (stage: ${context.matter.stage ?? 'unknown'})
Design snapshot: ${JSON.stringify(context.design ?? {})}
Active drafts:
${context.docSummary || '(none)'}`

  const history = await listMatterAssistantHistory(admin, matterId, user.id)
  const messages = [
    ...history.map(turn => ({ role: turn.role, content: turn.content })),
    { role: 'user' as const, content: message },
  ]

  const run = async (hooks?: {
    onDelta?: (text: string) => void
    onTool?: (event: { phase: 'start' | 'result'; name: string; connector?: string; ok?: boolean }) => void
  }) => {
    const result = await runLlmChat(llm, {
      system,
      messages,
      maxTokens: 4096,
      tools: mcpTools,
      maxToolRounds: MAX_TOOL_ROUNDS,
      executeTool: async (name, input) => {
        const executed = await executeMcpToolCall(mcpRegistry, name, input)
        if (executed.ok) return { ok: true as const, text: executed.text }
        return { ok: false as const, error: executed.error }
      },
      hooks: {
        onDelta: hooks?.onDelta,
        onTool: event => {
          if (event.phase === 'start') hooks?.onTool?.({ phase: 'start', name: event.name })
          if (event.phase === 'result') {
            const entry = mcpRegistry.find(r => r.llmName === event.name)
            hooks?.onTool?.({
              phase: 'result',
              name: event.name,
              connector: entry?.connectorName,
              ok: event.ok,
            })
          }
        },
      },
    })

    const toolsUsed = result.toolsUsed.map(t => {
      const entry = mcpRegistry.find(r => r.llmName === t.tool)
      return {
        connector: entry?.connectorName ?? 'unknown',
        tool: entry?.mcpToolName ?? t.tool,
        ok: t.ok,
      }
    })

    return {
      reply: result.reply,
      toolsUsed,
      model: result.model,
      keySource: result.keySource,
      provider: result.provider,
      usage: result.usage,
    }
  }

  const startedAt = Date.now()
  const logUsage = (result: Awaited<ReturnType<typeof run>> | null, errorMessage?: string) => {
    void logAiUsage({
      route: 'matters/assistant',
      contextType: 'matter',
      matterId,
      userId: user.id,
      model: result?.model ?? llm.model,
      inputTokens: result?.usage?.inputTokens ?? 0,
      outputTokens: result?.usage?.outputTokens ?? 0,
      cacheReadInputTokens: result?.usage?.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: result?.usage?.cacheCreationInputTokens ?? 0,
      durationMs: Date.now() - startedAt,
      success: !errorMessage,
      errorMessage: errorMessage ?? null,
    })
  }

  if (!useStream) {
    try {
      const result = await run()
      logUsage(result)
      const { reply, toolsUsed, model, keySource, provider } = result
      await appendMatterAssistantTurns(admin, matterId, user.id, [
        { role: 'user', content: message },
        { role: 'assistant', content: reply },
      ])
      return Response.json({ reply, model, provider, keySource, toolsUsed })
    } catch (e) {
      console.error('[matter-assistant]', e)
      const msg = e instanceof Error ? e.message : 'Assistant request failed'
      logUsage(null, msg)
      return Response.json({ error: msg }, { status: 500 })
    }
  }

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const result = await run({
          onDelta: text => {
            controller.enqueue(encoder.encode(sseLine('delta', { text })))
          },
          onTool: event => {
            controller.enqueue(encoder.encode(sseLine('tool', event)))
          },
        })
        logUsage(result)
        const { reply, toolsUsed, model, keySource, provider } = result

        await appendMatterAssistantTurns(admin, matterId, user.id, [
          { role: 'user', content: message },
          { role: 'assistant', content: reply },
        ])

        controller.enqueue(
          encoder.encode(
            sseLine('done', {
              reply,
              model,
              provider,
              keySource,
              toolsUsed,
            }),
          ),
        )
        controller.close()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Assistant request failed'
        console.error('[matter-assistant stream]', e)
        logUsage(null, msg)
        controller.enqueue(encoder.encode(sseLine('error', { message: msg })))
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
