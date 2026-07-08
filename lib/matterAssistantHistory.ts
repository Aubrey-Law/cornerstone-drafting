import type { SupabaseClient } from '@supabase/supabase-js'

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

const MAX_HISTORY_TURNS = 40

export async function listMatterAssistantHistory(
  admin: SupabaseClient,
  matterId: string,
  userId: string,
): Promise<AssistantTurn[]> {
  const { data, error } = await admin
    .from('matter_assistant_messages')
    .select('role, content, created_at')
    .eq('matter_id', matterId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(MAX_HISTORY_TURNS)

  if (error) {
    if (error.message.includes('matter_assistant_messages') || error.message.includes('schema cache')) {
      return []
    }
    throw new Error(error.message)
  }

  return (data ?? []).map(row => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
    createdAt: row.created_at,
  }))
}

export async function appendMatterAssistantTurns(
  admin: SupabaseClient,
  matterId: string,
  userId: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<void> {
  if (turns.length === 0) return
  const { error } = await admin.from('matter_assistant_messages').insert(
    turns.map(t => ({
      matter_id: matterId,
      user_id: userId,
      role: t.role,
      content: t.content,
    })),
  )
  if (error) {
    if (error.message.includes('matter_assistant_messages') || error.message.includes('schema cache')) {
      return
    }
    throw new Error(error.message)
  }
}

export async function clearMatterAssistantHistory(
  admin: SupabaseClient,
  matterId: string,
  userId: string,
): Promise<void> {
  const { error } = await admin
    .from('matter_assistant_messages')
    .delete()
    .eq('matter_id', matterId)
    .eq('user_id', userId)
  if (error && !error.message.includes('matter_assistant_messages')) {
    throw new Error(error.message)
  }
}
