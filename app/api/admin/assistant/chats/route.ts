import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createAssistantChat, listAssistantChats, type AssistantChatContextType } from '@/lib/assistantChats'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const chats = await listAssistantChats(auth.userId)
    return NextResponse.json({ chats })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to list chats' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as {
    context_type?: unknown
    context_id?: unknown
  }
  const contextType: AssistantChatContextType = body.context_type === 'matter' ? 'matter' : 'general'
  if (contextType === 'matter' && (typeof body.context_id !== 'string' || !body.context_id.trim())) {
    return NextResponse.json({ error: 'context_id is required for matter chats' }, { status: 400 })
  }
  try {
    const chat = await createAssistantChat(auth.userId, {
      contextType,
      contextId: typeof body.context_id === 'string' ? body.context_id.trim() : null,
    })
    return NextResponse.json({ chat }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create chat' }, { status: 500 })
  }
}
