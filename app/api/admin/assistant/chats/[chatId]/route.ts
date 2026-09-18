import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { describeRecord } from '@/lib/matterKnowledge'
import {
  ASSISTANT_DISPLAY_HISTORY_TURNS,
  deleteAssistantChat,
  getAssistantChat,
  listAssistantChatMessages,
  renameAssistantChat,
  updateAssistantChatContext,
  type AssistantChatContextType,
} from '@/lib/assistantChats'

type Params = { params: Promise<{ chatId: string }> }

export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params
  try {
    const chat = await getAssistantChat(chatId, auth.userId)
    if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    const messages = await listAssistantChatMessages(chatId, { limit: ASSISTANT_DISPLAY_HISTORY_TURNS })
    // The record's label, so the page can name what the chat is pointed at
    // without a second lookup. A record that no longer resolves reads as
    // unlabeled rather than failing the load.
    const record = chat.context_type !== 'general' && chat.context_id
      ? await describeRecord(chat.context_id).catch(() => null)
      : null
    const context = {
      type: chat.context_type,
      id: chat.context_type === 'general' ? null : chat.context_id,
      label: record?.label ?? null,
    }
    return NextResponse.json({ chat, messages, context })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load chat' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params
  const body = await req.json().catch(() => ({})) as { title?: unknown; context_type?: unknown; context_id?: unknown }

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null
  let context: { contextType: AssistantChatContextType; contextId: string | null } | null = null
  if (body.context_type !== undefined) {
    if (!['general', 'matter', 'lead'].includes(String(body.context_type))) {
      return NextResponse.json({ error: 'Invalid context_type' }, { status: 400 })
    }
    const contextType = body.context_type as AssistantChatContextType
    const contextId = typeof body.context_id === 'string' && body.context_id.trim() ? body.context_id.trim() : null
    if (contextType !== 'general' && !contextId) {
      return NextResponse.json({ error: `context_id is required for ${contextType} chats` }, { status: 400 })
    }
    context = { contextType, contextId: contextType === 'general' ? null : contextId }
  }
  if (!title && !context) {
    return NextResponse.json({ error: 'title or context_type is required' }, { status: 400 })
  }

  try {
    const chat = await getAssistantChat(chatId, auth.userId)
    if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    if (title) await renameAssistantChat(chatId, auth.userId, title)
    if (context) await updateAssistantChatContext(chatId, auth.userId, context)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update chat' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params
  try {
    const chat = await getAssistantChat(chatId, auth.userId)
    if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    await deleteAssistantChat(chatId, auth.userId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete chat' }, { status: 500 })
  }
}
