import type Anthropic from '@anthropic-ai/sdk'
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

/**
 * Turns replayed to the model on each send. Without a cap, every turn of a
 * thread is re-sent forever: cost grows linearly and a long thread eventually
 * exceeds the context window and fails outright. Matches MAX_HISTORY_TURNS in
 * lib/matterAssistantHistory.ts.
 */
export const ASSISTANT_MODEL_HISTORY_TURNS = 40

/** Wider window for rendering a chat page — still bounded. */
export const ASSISTANT_DISPLAY_HISTORY_TURNS = 200

/**
 * Longest tool result replayed to the model from history. A record read can
 * run to tens of kilobytes; the turn that made it has already used it, and
 * later turns need the gist, not the whole dossier on every send.
 */
export const TOOL_RESULT_REPLAY_CHARS = 4_000

/** The placeholder older rows carry for a reply that was all tool activity. */
const LEGACY_TOOL_ACTIVITY_PLACEHOLDER = '[Tool activity — see events]'

interface StoredToolRound {
  assistant_content: unknown[]
  tool_results: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function storedToolRounds(events: Record<string, unknown>[] | null | undefined): StoredToolRound[] {
  const rounds: StoredToolRound[] = []
  for (const event of events ?? []) {
    const round = isRecord(event) ? event.tool_round : null
    if (isRecord(round) && Array.isArray(round.assistant_content) && Array.isArray(round.tool_results)) {
      rounds.push({ assistant_content: round.assistant_content, tool_results: round.tool_results })
    }
  }
  return rounds
}

/** Only the block shapes the Messages API accepts back; anything else is dropped. */
function replayAssistantBlocks(blocks: unknown[]): Anthropic.ContentBlockParam[] {
  const out: Anthropic.ContentBlockParam[] = []
  for (const block of blocks) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      out.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      out.push({ type: 'tool_use', id: block.id, name: block.name, input: isRecord(block.input) ? block.input : {} })
    }
  }
  return out
}

function truncateToolResult(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  if (text.length <= TOOL_RESULT_REPLAY_CHARS) return text
  return `${text.slice(0, TOOL_RESULT_REPLAY_CHARS)}\n…[truncated ${text.length - TOOL_RESULT_REPLAY_CHARS} characters for replay]`
}

function replayToolResults(results: unknown[]): Anthropic.ToolResultBlockParam[] {
  const out: Anthropic.ToolResultBlockParam[] = []
  for (const result of results) {
    if (!isRecord(result) || typeof result.tool_use_id !== 'string') continue
    out.push({
      type: 'tool_result',
      tool_use_id: result.tool_use_id,
      content: truncateToolResult(result.content),
      ...(result.is_error ? { is_error: true } : {}),
    })
  }
  return out
}

/**
 * Turn persisted rows into the messages replayed to the model.
 *
 * History used to be text only, so by the next turn the model had forgotten
 * every record it read. Stored tool rounds are rebuilt here as the assistant's
 * tool_use blocks followed by the user-role tool_result blocks, exactly as the
 * API saw them the first time. The window is also made to start on a user turn
 * and to alternate, which the API requires.
 */
export function replayMessagesForModel(
  rows: Array<Pick<AssistantChatMessageRow, 'role' | 'content' | 'events'>>,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = []
  const firstUser = rows.findIndex(row => row.role === 'user')
  if (firstUser === -1) return messages

  for (const row of rows.slice(firstUser)) {
    if (row.role === 'user') {
      if (row.content.trim()) messages.push({ role: 'user', content: row.content })
      continue
    }

    for (const round of storedToolRounds(row.events)) {
      const assistantBlocks = replayAssistantBlocks(round.assistant_content)
      const toolResults = replayToolResults(round.tool_results)
      if (assistantBlocks.length === 0 || toolResults.length === 0) continue
      messages.push({ role: 'assistant', content: assistantBlocks })
      messages.push({ role: 'user', content: toolResults })
    }

    const text = row.content.trim()
    if (text && text !== LEGACY_TOOL_ACTIVITY_PLACEHOLDER) {
      messages.push({ role: 'assistant', content: text })
    } else if (messages[messages.length - 1]?.role === 'user') {
      // A tool-only reply: close the round so the thread still alternates.
      messages.push({ role: 'assistant', content: '(Replied through tool activity only.)' })
    }
  }

  return messages
}

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

export async function listAssistantChatMessages(
  chatId: string,
  options: { limit?: number } = {},
): Promise<AssistantChatMessageRow[]> {
  // Newest rows first so a long thread keeps its most recent turns, then
  // reversed back to chronological order for callers. The default is the model
  // window: a caller that wants more must ask for it.
  const { data, error } = await assistantDb()
    .from('assistant_chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? ASSISTANT_MODEL_HISTORY_TURNS)
  if (error) throw new Error(error.message)
  return ((data ?? []) as AssistantChatMessageRow[]).reverse()
}

export async function renameAssistantChat(chatId: string, userId: string, title: string) {
  const { error } = await assistantDb()
    .from('assistant_chats')
    .update({ title: title.slice(0, CHAT_TITLE_MAX), updated_at: new Date().toISOString() })
    .eq('id', chatId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

/**
 * Point a chat at a matter or lead, or back to general. The next turn builds
 * its context from this, so a chat started as general can pick up a matter
 * without the attorney starting over.
 */
export async function updateAssistantChatContext(
  chatId: string,
  userId: string,
  context: { contextType: AssistantChatContextType; contextId: string | null },
) {
  const { error } = await assistantDb()
    .from('assistant_chats')
    .update({
      context_type: context.contextType,
      context_id: context.contextType === 'general' ? null : context.contextId,
      updated_at: new Date().toISOString(),
    })
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
