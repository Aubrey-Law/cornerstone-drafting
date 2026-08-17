import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import {
  appendAssistantChatMessage,
  getAssistantChat,
  listAssistantChatMessages,
  setAssistantChatTitleIfEmpty,
} from '@/lib/assistantChats'
import {
  buildContext,
  createAdminChatStream,
  generalSystemPrompt,
  type AdminChatToolExecutor,
  type MatterContext,
} from '@/lib/adminChat/engine'
import { designSheetImportExecutor } from '@/lib/adminChat/designSheetTool'
import { workflowToolExecutors, workflowSystemPromptNote } from '@/lib/adminChat/workflowTools'
import { calendarPlanningSystemPromptNote, calendarPlanningToolExecutors } from '@/lib/adminChat/calendarTools'
import { templateBuilderSystemPromptNote, templateBuilderToolExecutors } from '@/lib/templateBuilder/assistantTools'
import {
  matterKnowledgeSystemPromptNote,
  matterKnowledgeToolExecutors,
} from '@/lib/adminChat/matterKnowledgeTools'

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

  const contextMatterId = chat.context_type === 'matter' ? chat.context_id : null
  const tools: AdminChatToolExecutor[] = [
    ...(contextMatterId ? [designSheetImportExecutor(contextMatterId, auth.userId)] : []),
    ...workflowToolExecutors({ userId: auth.userId, email: auth.user?.email ?? null }),
    ...calendarPlanningToolExecutors(),
    ...templateBuilderToolExecutors(auth.userId),
    // A lead is matter-owned, so its record reads by the same id.
    ...matterKnowledgeToolExecutors({ defaultRecordId: chat.context_id }),
  ]

  // Mike OSS handoff convention: an attached workflow becomes a [Workflow: ...]
  // prefix on the outgoing turn; the model reads the body via read_workflow.
  const outgoingContent = workflow
    ? `[Workflow: ${workflow.title} (id: ${workflow.id})]\n\n${content}`
    : content

  const messages = [
    ...history.map(message => ({ role: message.role, content: message.content })),
    { role: 'user' as const, content: outgoingContent },
  ]

  const events: Record<string, unknown>[] = []

  return createAdminChatStream({
    system: context.systemPrompt + workflowSystemPromptNote() + calendarPlanningSystemPromptNote()
      + templateBuilderSystemPromptNote() + matterKnowledgeSystemPromptNote(),
    messages,
    tools,
    maxIterations: 6,
    preamble: contextLoadNote || undefined,
    usage: {
      route: 'admin/assistant',
      contextType: chat.context_type,
      matterId: contextMatterId,
      userId: auth.userId,
    },
    onEvent: data => {
      if (typeof data.text !== 'string') events.push(data)
    },
    onComplete: async ({ text, success, errorMessage }) => {
      const contentToSave = text || (events.length ? '[Tool activity — see events]' : '')
      if (!contentToSave && success) return
      try {
        await appendAssistantChatMessage(chatId, {
          role: 'assistant',
          content: contentToSave || `Error: ${errorMessage ?? 'stream failed'}`,
          events,
        })
      } catch (error) {
        console.error('[admin assistant] failed to persist assistant message', { chatId, error })
      }
    },
  })
}
