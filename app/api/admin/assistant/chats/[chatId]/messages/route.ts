import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import {
  appendAssistantChatMessage,
  getAssistantChat,
  listAssistantChatMessages,
  replayMessagesForModel,
  setAssistantChatTitleIfEmpty,
} from '@/lib/assistantChats'
import {
  buildContext,
  createAdminChatStream,
  generalSystemPrompt,
  type MatterContext,
} from '@/lib/adminChat/engine'
import { adminChatToolset } from '@/lib/adminChat/toolset'
import { attachedWorkflowPromptNote, loadAttachedWorkflow } from '@/lib/adminChat/workflowAttachment'

export const maxDuration = 120

interface SendMessageRequest {
  content?: unknown
  workflow?: { id?: unknown; title?: unknown } | null
}

export async function POST(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params

  // Separate bucket from the floating panel's admin_chat so the two surfaces
  // don't starve each other.
  const rl = await consumeRateLimit(
    { bucket: 'admin_assistant', limit: 60, windowSeconds: 600 },
    auth.userId,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded for the assistant', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const chat = await getAssistantChat(chatId, auth.userId).catch(() => null)
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as SendMessageRequest | null
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  const workflow = body?.workflow && typeof body.workflow.id === 'string' && typeof body.workflow.title === 'string'
    ? { id: body.workflow.id, title: body.workflow.title }
    : null

  // Server-side history: prior turns come from the DB, not the client.
  const history = await listAssistantChatMessages(chatId)

  await appendAssistantChatMessage(chatId, {
    role: 'user',
    content,
    events: workflow ? [{ workflow_attached: workflow }] : [],
  })
  await setAssistantChatTitleIfEmpty(chatId, auth.userId, content)

  let contextLoadNote = ''
  let context: MatterContext
  try {
    context = await buildContext(chat.context_type, chat.context_id ?? undefined)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[admin assistant] context fetch failed', { chatId, error: detail })
    context = { systemPrompt: await generalSystemPrompt(), matterLabel: null }
    contextLoadNote = `Note: I wasn't able to load full ${chat.context_type} context (${detail}) - answering from general knowledge.\n\n`
  }

  // The workflow's text goes into the system prompt here. Leaving it to the
  // model to fetch via read_workflow meant it sometimes did not, and then
  // answered as if nothing had been attached.
  let workflowNote = ''
  const initialEvents: Record<string, unknown>[] = []
  if (workflow) {
    const attached = await loadAttachedWorkflow(workflow.id, { userId: auth.userId, email: auth.user?.email ?? null })
    if (attached) {
      workflowNote = attachedWorkflowPromptNote(attached, { contextType: chat.context_type })
      initialEvents.push({ workflow_applied: { workflow_id: attached.id, title: attached.title } })
    } else {
      contextLoadNote += `Note: the attached workflow "${workflow.title}" is no longer available, so I am answering without it.\n\n`
    }
  }

  const contextMatterId = chat.context_type === 'matter' ? chat.context_id : null
  const toolset = adminChatToolset({
    contextType: chat.context_type,
    contextId: chat.context_id,
    user: { id: auth.userId, email: auth.user?.email ?? null, user_metadata: auth.user?.user_metadata },
    surface: 'assistant',
  })

  // Mike OSS handoff convention: an attached workflow becomes a [Workflow: ...]
  // prefix on the outgoing turn. The body itself is already in the system
  // prompt (workflowNote); the tag survives so the turn reads the same in
  // history and so the model can name what it is following.
  const outgoingContent = workflow
    ? `[Workflow: ${workflow.title} (id: ${workflow.id})]\n\n${content}`
    : content

  // Stored tool rounds replay as the blocks the API saw, so the model keeps
  // what it read on earlier turns instead of re-reading or guessing.
  const messages = [
    ...replayMessagesForModel(history),
    { role: 'user' as const, content: outgoingContent },
  ]

  const events: Record<string, unknown>[] = []

  return createAdminChatStream({
    system: context.systemPrompt + toolset.promptNotes + workflowNote,
    messages,
    tools: toolset.tools,
    maxIterations: 6,
    preamble: contextLoadNote || undefined,
    initialEvents,
    usage: {
      route: 'admin/assistant',
      contextType: chat.context_type,
      matterId: contextMatterId,
      userId: auth.userId,
    },
    onEvent: data => {
      if (typeof data.text !== 'string') events.push(data)
    },
    onToolRound: ({ assistantContent, toolResults }) => {
      events.push({ tool_round: { assistant_content: assistantContent, tool_results: toolResults } })
    },
    onComplete: async ({ text, success, errorMessage }) => {
      // A reply that was all tool activity is saved with empty text and its
      // events; the thread renders the chips, and replay closes the round.
      if (!text && events.length === 0 && success) return
      try {
        await appendAssistantChatMessage(chatId, {
          role: 'assistant',
          content: success ? text : (text || `Error: ${errorMessage ?? 'stream failed'}`),
          events,
        })
      } catch (error) {
        console.error('[admin assistant] failed to persist assistant message', { chatId, error })
      }
    },
  })
}
