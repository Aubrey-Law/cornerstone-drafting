import type { TriageClassification } from '@/lib/queries/emailTriage'
import { triageLabelName } from '@/lib/emailTriage/labels'
import { GmailSendError } from './gmailSend'

/**
 * File a triaged thread under the firm's Client / Lead labels in Gmail.
 *
 * Applied when the attorney approves a reply, so the thread is sorted in the
 * mailbox by the time the draft is waiting there, and by the triage scan when
 * it finds a thread was answered straight from Gmail. Which label a classification
 * gets is decided in `lib/emailTriage/labels.ts`.
 */

export { triageLabelName }

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const GMAIL_TIMEOUT_MS = 20_000

async function gmailJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(`${GMAIL_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS),
    })
  } catch (err) {
    throw new GmailSendError('gmail_error', err instanceof Error ? err.message : 'Gmail request failed')
  }
  const json = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!r.ok) {
    throw new GmailSendError('gmail_error', json.error?.message ?? `${r.status} ${r.statusText}`)
  }
  return json
}

/**
 * The id of the user label with this name, creating it if the mailbox has none.
 * Matched case-insensitively, so an existing hand-made "client" label is reused
 * rather than shadowed by a second one Gmail would refuse to create anyway.
 */
export async function ensureGmailLabel(token: string, name: string): Promise<string> {
  const { labels = [] } = await gmailJson<{ labels?: { id: string; name: string }[] }>(token, '/labels')
  const existing = labels.find(label => label.name.toLowerCase() === name.toLowerCase())
  if (existing) return existing.id

  const created = await gmailJson<{ id?: string }>(token, '/labels', {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  })
  if (!created.id) throw new GmailSendError('gmail_error', `Gmail created label "${name}" but returned no id`)
  return created.id
}

/**
 * Label the whole thread for this classification. Returns the label applied,
 * or null when the classification does not get one.
 */
export async function applyTriageLabel(args: {
  token: string
  threadId: string
  classification: TriageClassification
}): Promise<string | null> {
  const name = triageLabelName(args.classification)
  if (!name) return null

  const labelId = await ensureGmailLabel(args.token, name)
  await gmailJson(args.token, `/threads/${encodeURIComponent(args.threadId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [labelId] }),
  })
  return name
}
