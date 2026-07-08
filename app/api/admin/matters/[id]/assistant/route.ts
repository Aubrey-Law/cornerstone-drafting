import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveApiKey } from '@/lib/userApiKeys'
import {
  DEFAULT_ANTHROPIC_MODEL,
  parseUserPreferences,
  resolveAnthropicModel,
} from '@/lib/userPreferences'
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
 * POST /api/admin/matters/[id]/assistant
 * Body: { message: string, documentIds?: string[], stream?: boolean }
 *
 * Default `stream: true` → SSE (`text/event-stream`) with delta/tool/done events.
 * `stream: false` → JSON `{ reply, model, keySource, toolsUsed }`.
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

  const resolved = await resolveApiKey(admin, user.id, 'anthropic')
  if (!resolved.key) {
    return Response.json(
      { error: 'No Anthropic API key configured. Add one in Settings → API Keys or set ANTHROPIC_API_KEY.' },
      { status: 501 },
    )
  }

  const { data: profile } = await admin.from('users').select('preferences').eq('id', user.id).maybeSingle()
  const model = resolveAnthropicModel(parseUserPreferences(profile?.preferences)) || DEFAULT_ANTHROPIC_MODEL

  let mcpTools: Anthropic.Tool[] = []
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
  const messages: Anthropic.MessageParam[] = [
    ...history.map(turn => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: message },
  ]

  const client = new Anthropic({ apiKey: resolved.key })

  const run = async (
    hooks?: {
      onDelta?: (text: string) => void
      onTool?: (event: { phase: 'start' | 'result'; name: string; connector?: string; ok?: boolean }) => void
    },
  ) => {
    const toolsUsed: Array<{ connector: string; tool: string; ok: boolean }> = []
    let replyText = ''
    let workingMessages = [...messages]

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = client.messages.stream({
        model,
        max_tokens: 2048,
        system,
        messages: workingMessages,
        ...(mcpTools.length > 0 ? { tools: mcpTools } : {}),
      })

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta' &&
          event.delta.text
        ) {
          replyText += event.delta.text
          hooks?.onDelta?.(event.delta.text)
        }
      }

      const final = await stream.finalMessage()
      const toolUses = final.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      )

      if (final.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const textFromBlocks = final.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
        if (textFromBlocks && !replyText) replyText = textFromBlocks
        return { reply: replyText || textFromBlocks, toolsUsed }
      }

      workingMessages.push({ role: 'assistant', content: final.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        const input =
          typeof toolUse.input === 'object' && toolUse.input && !Array.isArray(toolUse.input)
            ? (toolUse.input as Record<string, unknown>)
            : {}

        hooks?.onTool?.({ phase: 'start', name: toolUse.name })
        const executed = await executeMcpToolCall(mcpRegistry, toolUse.name, input)
        hooks?.onTool?.({
          phase: 'result',
          name: toolUse.name,
          connector: executed.ok ? executed.connectorName : undefined,
          ok: executed.ok,
        })
        toolsUsed.push({
          connector: executed.ok ? executed.connectorName : 'unknown',
          tool: executed.ok ? executed.mcpToolName : toolUse.name,
          ok: executed.ok,
        })

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: executed.ok
            ? executed.text.slice(0, 12_000)
            : `Error: ${executed.error}`,
          is_error: !executed.ok,
        })
      }

      workingMessages.push({ role: 'user', content: toolResults })
      replyText = ''
    }

    return { reply: replyText || 'Tool loop limit reached.', toolsUsed }
  }

  if (!useStream) {
    try {
      const { reply, toolsUsed } = await run()
      await appendMatterAssistantTurns(admin, matterId, user.id, [
        { role: 'user', content: message },
        { role: 'assistant', content: reply },
      ])
      return Response.json({
        reply,
        model,
        keySource: resolved.source,
        toolsUsed,
      })
    } catch (e) {
      console.error('[matter-assistant]', e)
      return Response.json(
        { error: e instanceof Error ? e.message : 'Assistant request failed' },
        { status: 500 },
      )
    }
  }

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const { reply, toolsUsed } = await run({
          onDelta: text => {
            controller.enqueue(encoder.encode(sseLine('delta', { text })))
          },
          onTool: event => {
            controller.enqueue(encoder.encode(sseLine('tool', event)))
          },
        })

        await appendMatterAssistantTurns(admin, matterId, user.id, [
          { role: 'user', content: message },
          { role: 'assistant', content: reply },
        ])

        controller.enqueue(
          encoder.encode(
            sseLine('done', {
              reply,
              model,
              keySource: resolved.source,
              toolsUsed,
            }),
          ),
        )
        controller.close()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Assistant request failed'
        console.error('[matter-assistant stream]', e)
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
