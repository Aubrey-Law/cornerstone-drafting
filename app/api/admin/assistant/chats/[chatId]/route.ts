import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  deleteAssistantChat,
  getAssistantChat,
  listAssistantChatMessages,
  renameAssistantChat,
} from '@/lib/assistantChats'

type Params = { params: Promise<{ chatId: string }> }

export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params
  try {
    const chat = await getAssistantChat(chatId, auth.userId)
    if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    const messages = await listAssistantChatMessages(chatId)
    return NextResponse.json({ chat, messages })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load chat' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params
  const body = await req.json().catch(() => ({})) as { title?: unknown }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  try {
    const chat = await getAssistantChat(chatId, auth.userId)
    if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    await renameAssistantChat(chatId, auth.userId, body.title.trim())
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to rename chat' }, { status: 500 })
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
