import { getAdminClient } from '@/lib/supabaseAdmin'

export type AssistantChatContextType = 'general' | 'matter' | 'lead'

export interface AssistantChatRow {
  id: string
  user_id: string
  title: string | null
  context_type: AssistantChatContextType
  context_id: string | null
  created_at: string
  updated_at: string
}

export interface AssistantChatMessageRow {
  id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  events: Record<string, unknown>[]
  created_at: string
}

function assistantDb() {
  // Generated Database types are regenerated separately from migrations; this
  // boundary keeps the new tables isolated until then (same as worksDb()).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getAdminClient() as any
}

const CHAT_TITLE_MAX = 80

export function chatTitleFromMessage(content: string) {
  const firstLine = content.replace(/^\[Workflow:[^\]]*\]\s*/i, '').split('\n').find(line => line.trim()) ?? ''
  const trimmed = firstLine.trim()
  if (!trimmed) return 'New chat'
  return trimmed.length > CHAT_TITLE_MAX ? `${trimmed.slice(0, CHAT_TITLE_MAX - 1)}…` : trimmed
}

export async function listAssistantChats(userId: string, limit = 50): Promise<AssistantChatRow[]> {
  const { data, error } = await assistantDb()
    .from('assistant_chats')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as AssistantChatRow[]
}

export async function createAssistantChat(
  userId: string,
  input: { contextType?: AssistantChatContextType; contextId?: string | null; title?: string | null },
): Promise<AssistantChatRow> {
  const { data, error } = await assistantDb()
    .from('assistant_chats')
    .insert({
      user_id: userId,
      title: input.title ?? null,
      context_type: input.contextType ?? 'general',
      context_id: input.contextType === 'matter' || input.contextType === 'lead'
        ? input.contextId ?? null
        : null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as AssistantChatRow
}

export async function getAssistantChat(chatId: string, userId: string): Promise<AssistantChatRow | null> {
  const { data, error } = await assistantDb()
    .from('assistant_chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as AssistantChatRow | null) ?? null
}

export async function listAssistantChatMessages(chatId: string): Promise<AssistantChatMessageRow[]> {
  const { data, error } = await assistantDb()
    .from('assistant_chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as AssistantChatMessageRow[]
}

export async function renameAssistantChat(chatId: string, userId: string, title: string) {
  const { error } = await assistantDb()
    .from('assistant_chats')
    .update({ title: title.slice(0, CHAT_TITLE_MAX), updated_at: new Date().toISOString() })
    .eq('id', chatId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function deleteAssistantChat(chatId: string, userId: string) {
  const { error } = await assistantDb()
    .from('assistant_chats')
    .delete()
    .eq('id', chatId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function appendAssistantChatMessage(
  chatId: string,
  message: { role: 'user' | 'assistant'; content: string; events?: Record<string, unknown>[] },
): Promise<AssistantChatMessageRow> {
  const db = assistantDb()
  const { data, error } = await db
    .from('assistant_chat_messages')
    .insert({
      chat_id: chatId,
      role: message.role,
      content: message.content,
      events: message.events ?? [],
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  await db
    .from('assistant_chats')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', chatId)
  return data as AssistantChatMessageRow
}

export async function setAssistantChatTitleIfEmpty(chatId: string, userId: string, content: string) {
  const db = assistantDb()
  const { data } = await db
    .from('assistant_chats')
    .select('title')
    .eq('id', chatId)
    .eq('user_id', userId)
    .maybeSingle()
  if (data && !data.title) {
    await db
      .from('assistant_chats')
      .update({ title: chatTitleFromMessage(content) })
      .eq('id', chatId)
  }
}
