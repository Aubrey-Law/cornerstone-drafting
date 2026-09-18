import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { ASSISTANT_MODEL_HISTORY_TURNS } from '@/lib/assistantChats'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import {
  buildContext,
  createAdminChatStream,
  generalSystemPrompt,
  sse,
  type ChatContextType,
  type MatterContext,
} from '@/lib/adminChat/engine'
import { isDraftingSummaryRequest, formatClaudeDraftingSkillInput } from '@/lib/adminChat/prompts'
import { adminChatToolset } from '@/lib/adminChat/toolset'

export const maxDuration = 120

/** One turn's ceiling. A pasted document belongs in a document, not in a turn. */
const MAX_MESSAGE_CHARS = 24_000

type ChatRole = 'user' | 'assistant'

interface ChatRequest {
  messages: { role: ChatRole; content: string }[]
  context_type: ChatContextType
  context_id?: string
}

export async function POST(req: Request) {
  const { err, userId: adminUserId, user } = await requireAdmin(req)
  if (err) return err

  // Rate limit Cowork chat: 60 calls per 10-minute window per admin.
  // Anthropic spend is the dominant cost; a runaway loop would burn through
  // a budget in minutes. 60/10min ≈ one message every 10 seconds sustained.
  const rl = await consumeRateLimit(
    { bucket: 'admin_chat', limit: 60, windowSeconds: 600 },
    adminUserId ?? 'anon',
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded for chat', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await req.json().catch(() => null) as ChatRequest | null
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'Invalid chat request' }, { status: 400 })
  }

  const contextType = body.context_type
  if (!['matter', 'lead', 'general'].includes(contextType)) {
    return NextResponse.json({ error: 'Invalid context_type' }, { status: 400 })
  }

  // This lane takes its history from the client, so the bounds have to be
  // applied here: an unbounded array is unbounded context and unbounded cost.
  const requestMessages = body.messages
    .filter(message =>
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim()
    )
    .slice(-ASSISTANT_MODEL_HISTORY_TURNS)
    .map(message => ({ role: message.role, content: message.content.trim().slice(0, MAX_MESSAGE_CHARS) }))

  if (requestMessages.length === 0) {
    return NextResponse.json({ error: 'At least one message is required' }, { status: 400 })
  }

  // Drafting-summary short-circuit: answer straight from the normalized payload
  // instead of a model round-trip.
  const lastUserMessage = [...requestMessages].reverse().find(message => message.role === 'user')?.content ?? ''
  if (contextType === 'matter' && body.context_id && isDraftingSummaryRequest(lastUserMessage)) {
    try {
      const payload = await buildDraftPayload(body.context_id)
      const textOutput = formatClaudeDraftingSkillInput(payload)
      return new Response(`${sse({ text: textOutput })}data: [DONE]\n\n`, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to summarize design sheet' },
        { status: 500 },
      )
    }
  }

  let contextLoadNote = ''
  let context: MatterContext
  try {
    context = await buildContext(contextType, body.context_id)
  } catch (error) {
    const detail = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string')
        ? (error as { message: string }).message
        : JSON.stringify(error)
    console.error('[admin chat] context fetch failed', {
      contextType,
      contextId: body.context_id,
      error: detail,
      stack: error instanceof Error ? error.stack : undefined,
    })
    context = { systemPrompt: await generalSystemPrompt(), matterLabel: null }
    contextLoadNote = `Note: I wasn't able to load full matter context (${detail}) - answering from general knowledge.\n\n`
  }

  const contextMatterId = contextType === 'matter' && body.context_id ? body.context_id : null
  const toolset = adminChatToolset({
    contextType,
    contextId: body.context_id ?? null,
    user: { id: adminUserId ?? '', email: user?.email ?? null, user_metadata: user?.user_metadata },
    surface: 'rail',
  })

  return createAdminChatStream({
    system: context.systemPrompt + toolset.promptNotes,
    messages: requestMessages.map(message => ({ role: message.role, content: message.content })),
    tools: toolset.tools,
    maxIterations: 4,
    preamble: contextLoadNote || undefined,
    usage: {
      route: 'admin/chat',
      contextType,
      matterId: contextMatterId,
      userId: adminUserId ?? null,
    },
  })
}
