export const CORNERSTONE_CHAT_OPEN_EVENT = 'cornerstone:chat-open'

export type MatterNoteSaveType = 'internal' | 'client_comm'

export type CornerstoneChatOpenDetail = {
  prompt?: string
  /** Pre-fill the chat input without sending (good for activity notes you describe). */
  prefill?: string
  send?: boolean
  /** Matter notes only — which note_type to use when saving from the assistant. */
  noteType?: MatterNoteSaveType
}

export const MATTER_NOTE_ASSISTANT_PROMPT =
  'Create a matter note summarizing the current status, key facts, open items, and next steps. Write it ready to save to the matter file — no greeting or preamble.'

export const MATTER_INTERNAL_ACTIVITY_NOTE_PROMPT =
  'Draft a concise internal matter note about the activity I describe (email sent, call held, document shared, etc.). Include what happened, today\'s date, and any follow-up timing. Write it ready to save as an internal note — no greeting or preamble.'

export const MATTER_CLIENT_COMM_ACTIVITY_NOTE_PROMPT =
  'Draft a concise client communication note for the matter file about the outreach I describe (email, call, letter, portal message, etc.). Include what was sent or discussed, today\'s date, and any follow-up timing. Write it ready to save to the client comm log — no greeting or preamble.'

export const MATTER_ACTIVITY_PREFILL =
  'Describe the activity and follow-up timing (e.g. "Sent draft review email today; follow up in 2 days if no reply").'

export function openCornerstoneAssistant(detail?: CornerstoneChatOpenDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<CornerstoneChatOpenDetail>(CORNERSTONE_CHAT_OPEN_EVENT, { detail }))
}
