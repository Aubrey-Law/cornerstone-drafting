import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveRecordMatterId } from '@/lib/matterKnowledge'
import {
  appendMatterAssistantTurns,
  clearMatterAssistantHistory,
  listMatterAssistantHistory,
  type AssistantTurn,
} from '@/lib/matterAssistantHistory'

/**
 * Where the rail's threads live.
 *
 * The rail kept its general and lead threads in the browser's session
 * storage: a reload, a second tab or a different machine lost them, and only
 * the matter thread survived because it shared the Review step's per-user
 * store. All three now live in that store, keyed as follows.
 */
export type RailChatContext =
  | { type: 'general' }
  | { type: 'matter' | 'lead'; id: string }

/** The thread key for the attorney's general rail conversation. */
export const GENERAL_THREAD_KEY = 'general'

/**
 * The store's thread column is the matter id (text, no foreign key). A matter
 * thread is keyed by its id and shared with the Review step. A lead is
 * matter-owned, so its thread is filed under that matter: when the client
 * hires, the conversation follows them. The general thread uses a sentinel.
 */
export async function railThreadKey(context: RailChatContext): Promise<string> {
  if (context.type === 'general') return GENERAL_THREAD_KEY
  if (context.type === 'matter') return context.id
  const matterId = await resolveRecordMatterId(context.id).catch(() => null)
  return matterId ?? `lead:${context.id}`
}

export async function listRailThread(admin: SupabaseClient, context: RailChatContext, userId: string): Promise<AssistantTurn[]> {
  return listMatterAssistantHistory(admin, await railThreadKey(context), userId)
}

export async function appendRailTurns(
  admin: SupabaseClient,
  context: RailChatContext,
  userId: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<void> {
  await appendMatterAssistantTurns(admin, await railThreadKey(context), userId, turns)
}

export async function clearRailThread(admin: SupabaseClient, context: RailChatContext, userId: string): Promise<void> {
  await clearMatterAssistantHistory(admin, await railThreadKey(context), userId)
}
