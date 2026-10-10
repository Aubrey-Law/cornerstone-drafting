import type { TriageClassification } from '@/lib/queries/emailTriage'
import {
  LEGACY_TRIAGE_LABEL_NAMES,
  TRIAGE_LABEL_NAMES,
  decideMailboxSort,
  triageLabelName,
  type MailboxSortDecision,
  type MailboxSortKind,
} from '@/lib/emailTriage/labels'
import { GmailSendError } from './gmailSend'

/**
 * File and archive Gmail threads according to Mail Desk decisions.
 *
 * Labels live under `Cornerstone/…`. Archiving is `removeLabelIds: ['INBOX']`;
 * restoring attention is `addLabelIds: ['INBOX']`. Nothing here trashes or
 * marks spam.
 */

export { triageLabelName, decideMailboxSort }

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

type GmailLabel = { id: string; name: string }

/** Per-token label list + id map so a scan does not re-list on every thread. */
export class GmailLabelCache {
  private labels: GmailLabel[] | null = null
  private byName = new Map<string, string>()

  constructor(private readonly token: string) {}

  async list(): Promise<GmailLabel[]> {
    if (this.labels) return this.labels
    const { labels = [] } = await gmailJson<{ labels?: GmailLabel[] }>(this.token, '/labels')
    this.labels = labels
    this.byName = new Map(labels.map(l => [l.name.toLowerCase(), l.id]))
    return labels
  }

  async ensure(name: string): Promise<string> {
    await this.list()
    const existing = this.byName.get(name.toLowerCase())
    if (existing) return existing

    const created = await gmailJson<{ id?: string; name?: string }>(this.token, '/labels', {
      method: 'POST',
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    })
    if (!created.id) {
      throw new GmailSendError('gmail_error', `Gmail created label "${name}" but returned no id`)
    }
    this.labels = [...(this.labels ?? []), { id: created.id, name: created.name ?? name }]
    this.byName.set(name.toLowerCase(), created.id)
    return created.id
  }

  /** Ids of labels that already exist (does not create). */
  async existingIds(names: string[]): Promise<string[]> {
    const labels = await this.list()
    const wanted = new Set(names.map(n => n.toLowerCase()))
    return labels.filter(l => wanted.has(l.name.toLowerCase())).map(l => l.id)
  }
}

/**
 * The id of the user label with this name, creating it if the mailbox has none.
 * Matched case-insensitively, so an existing hand-made label is reused.
 */
export async function ensureGmailLabel(token: string, name: string): Promise<string> {
  return new GmailLabelCache(token).ensure(name)
}

export interface ApplyMailboxSortArgs {
  token: string
  threadId: string
  decision: MailboxSortDecision
  /** Reuse across a scan so label list/create is not paid per thread. */
  cache?: GmailLabelCache
}

/**
 * Apply a sort decision: add/remove Cornerstone labels, archive or restore Inbox.
 * Returns the primary display label, or null when nothing was added.
 */
export async function applyMailboxSort(args: ApplyMailboxSortArgs): Promise<string | null> {
  const { decision, threadId } = args
  if (
    decision.addLabels.length === 0
    && decision.removeLabels.length === 0
    && !decision.archive
    && !decision.restoreInbox
  ) {
    return null
  }

  const cache = args.cache ?? new GmailLabelCache(args.token)
  const addLabelIds: string[] = []
  for (const name of decision.addLabels) {
    addLabelIds.push(await cache.ensure(name))
  }

  const removeLabelIds = await cache.existingIds(decision.removeLabels)
  // Also strip legacy flat Client/Lead when applying a new relationship label
  // under Cornerstone/, so the thread is not double-filed.
  if (decision.addLabels.some(n => n.startsWith('Cornerstone/'))) {
    for (const id of await cache.existingIds([...LEGACY_TRIAGE_LABEL_NAMES])) {
      if (!removeLabelIds.includes(id)) removeLabelIds.push(id)
    }
  }

  if (decision.archive) removeLabelIds.push('INBOX')
  if (decision.restoreInbox && !decision.archive) addLabelIds.push('INBOX')

  // Deduplicate; Gmail rejects empty modify bodies.
  const add = Array.from(new Set(addLabelIds))
  const remove = Array.from(new Set(removeLabelIds)).filter(id => !add.includes(id))
  if (add.length === 0 && remove.length === 0) return decision.displayLabel

  await gmailJson(args.token, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({
      ...(add.length ? { addLabelIds: add } : {}),
      ...(remove.length ? { removeLabelIds: remove } : {}),
    }),
  })
  return decision.displayLabel
}

/** Convenience: decide + apply for a common Mail Desk action. */
export async function sortMailboxThread(args: {
  token: string
  threadId: string
  kind: MailboxSortKind
  classification?: TriageClassification | 'automated' | 'internal'
  archiveEnabled: boolean
  automatedHard?: boolean
  cache?: GmailLabelCache
}): Promise<string | null> {
  const decision = decideMailboxSort({
    kind: args.kind,
    classification: args.classification,
    archiveEnabled: args.archiveEnabled,
    automatedHard: args.automatedHard,
  })
  return applyMailboxSort({
    token: args.token,
    threadId: args.threadId,
    decision,
    cache: args.cache,
  })
}

/**
 * Label the whole thread for this classification (relationship only, Inbox kept).
 * Prefer `sortMailboxThread` for handled / noise / snooze paths.
 */
export async function applyTriageLabel(args: {
  token: string
  threadId: string
  classification: TriageClassification
  cache?: GmailLabelCache
}): Promise<string | null> {
  return sortMailboxThread({
    token: args.token,
    threadId: args.threadId,
    kind: 'needs_reply',
    classification: args.classification,
    archiveEnabled: false,
    cache: args.cache,
  })
}

/**
 * Take every triage label off these threads. Used when the attorney says
 * "never this sender" or "never this domain". Then Noise + archive is applied
 * separately so ignored mail leaves the Inbox.
 */
export async function removeTriageLabels(args: {
  token: string
  threadIds: string[]
  cache?: GmailLabelCache
}): Promise<number> {
  if (args.threadIds.length === 0) return 0
  const cache = args.cache ?? new GmailLabelCache(args.token)
  const labelIds = await cache.existingIds([...TRIAGE_LABEL_NAMES])
  if (labelIds.length === 0) return 0

  for (const threadId of args.threadIds) {
    await gmailJson(args.token, `/threads/${encodeURIComponent(threadId)}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: labelIds }),
    })
  }
  return args.threadIds.length
}
