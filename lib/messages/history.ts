import type { SupabaseClient } from '@supabase/supabase-js'
import type { Message } from '@/app/(portal)/messages/actions'
export type MessageCursor = { createdAt: string; id: string }
export type MessageHistoryPage = { messages: Message[]; older: MessageCursor | null }
export const MESSAGE_PAGE_SIZE = 50
export async function readMessageHistory(supabase: SupabaseClient, matterId: string, before?: MessageCursor | null): Promise<MessageHistoryPage> {
  let query = supabase.from('messages').select('id,matter_id,sender_role,sender_id,body,created_at,read_at').eq('matter_id', matterId)
  if (before) {
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(before.createdAt) || !Number.isFinite(Date.parse(before.createdAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before.id)) throw new Error('Invalid message cursor')
    query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`)
  }
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE + 1)
  if (error) throw new Error('Could not load your messages. Please retry.')
  const rows = (data ?? []) as Message[]
  const messages = rows.slice(0, MESSAGE_PAGE_SIZE)
  const oldest = messages.at(-1)
  return { messages: messages.reverse(), older: rows.length > MESSAGE_PAGE_SIZE && oldest ? { id: oldest.id, createdAt: oldest.created_at } : null }
}
