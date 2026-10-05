import {
  TRIAGE_SEARCH_QUERY,
  getMailboxIdentity,
  getThread,
  getThreadMetadata,
  listTriageThreadIds,
  GmailReadError,
} from '@/lib/email/gmailRead'
import { applyTriageLabel } from '@/lib/email/gmailLabels'
import { getFirmConfig } from '@/lib/firmConfig'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { TriageClassification } from '@/lib/queries/emailTriage'
import {
  classifySender,
  collectThreadParticipants,
  emailDomain,
  type IgnoreRules,
} from './classifySender'
import { generateTriageDraft } from './draft'
import { delegateTriageReply } from './delegate'
import { describeError } from './describeError'
import { evaluateNeedsReply } from './needsReply'

export { describeError }

/**
 * One pass over the mailbox: find what is waiting, file it against the firm's
 * records, and draft replies until the clock runs out.
 *
 * Everything here is bounded and idempotent. The unique index on
 * (connection_email, gmail_thread_id) makes a rescan an update rather than a
 * second copy of the inbox, and an undrafted row simply stays `needs_reply` for
 * the next pass — so a run that stops halfway needs no recovery and no queue.
 */

/** Vercel's ceiling is 60s. The rest is headroom for the response. */
const DEFAULT_BUDGET_MS = 40_000
const DEFAULT_MAX_DRAFTS = 5

/**
 * A safety valve, not the scan window. The window is the `newer_than:` in the
 * search query itself.
 *
 * This was 40, which read like a sensible page size and was in fact a second,
 * much smaller window silently overriding the first. The query asks Gmail for
 * fourteen days; in a mailbox taking ~27 threads a day — most of it CI
 * notifications and DMARC reports — the newest 40 threads is about thirty-six
 * hours. Everything older was listed by Gmail, discarded here, and never
 * looked at again, because a thread that never reaches the queue leaves no row
 * to come back to. Meanwhile the cron's own worst gap, Friday noon to Monday
 * morning, is seventy-one hours. Two clients' mail was lost in the difference.
 *
 * Set high enough that reaching it means something is wrong with the mailbox
 * rather than with the number. `threads_listed` hitting it is reported on the
 * page instead of passing for a healthy count.
 */
export const TRIAGE_LISTING_CEILING = 500

/**
 * Drafting is the expensive half and must not be starved by a large listing.
 * Metadata reads stop here; what they did not reach is still inside the
 * query's window on the next run, which is the whole point of sizing the
 * window in days rather than in threads.
 */
const DRAFTING_RESERVE_MS = 20_000

/**
 * How long an unsent reply of the attorney's own keeps the model out of a
 * thread.
 *
 * Deferring to a half-written reply is right while it is being written —
 * nobody wants a second answer appearing over the one they are typing. It
 * stops being right some time later. The first scan to read the whole window
 * found seventeen unsent replies, several of them more than a week old: not
 * people mid-sentence, people who started and forgot. Those are the threads
 * most overdue a reply, and suppressing help on exactly them is the page
 * declining to do the one thing it is for.
 *
 * Two days is chosen to clear a weekend without clearing a lunch break.
 */
export const STALE_HUMAN_DRAFT_MS = 48 * 60 * 60 * 1000

/**
 * The timestamp a row's `human_draft_at` must be at or after to still suppress
 * drafting. Older than this and the draft is treated as abandoned.
 */
export function humanDraftCutoff(now: number = Date.now()): string {
  return new Date(now - STALE_HUMAN_DRAFT_MS).toISOString()
}

/** Gmail metadata reads, in parallel. Its per-user budget is far above this. */
const METADATA_CONCURRENCY = 5

/**
 * A run older than this is assumed dead rather than in flight — a process
 * killed mid-scan would otherwise block every later run forever.
 */
const STALE_SCAN_MS = 3 * 60_000


export interface TriageScanOptions {
  trigger: 'cron' | 'manual'
  actorId?: string | null
  userId?: string | null
  budgetMs?: number
  maxThreads?: number
  maxDrafts?: number
}

export interface TriageScanResult {
  ok: boolean
  reason?: 'disabled' | 'no_connection' | 'missing_scope' | 'already_running'
  scanId: string | null
  threadsListed: number
  threadsExamined: number
  queued: number
  resolved: number
  skippedAutomated: number
  skippedInternal: number
  draftsGenerated: number
  /** Drafts the delegation dial sent on its own this run. */
  repliesSent: number
  /** Drafts the dial recorded as "would have sent" without sending. */
  repliesObserved: number
  /** Listed inside the window but not reached before the metadata budget ran out. */
  threadsDeferred: number
  /** The listing hit `TRIAGE_LISTING_CEILING` and may be incomplete. */
  listingTruncated: boolean
  remainingNeedsDraft: number
  durationMs: number
}

function emptyResult(reason: TriageScanResult['reason'], durationMs = 0): TriageScanResult {
  return {
    ok: false,
    reason,
    scanId: null,
    threadsListed: 0,
    threadsExamined: 0,
    queued: 0,
    resolved: 0,
    skippedAutomated: 0,
    skippedInternal: 0,
    draftsGenerated: 0,
    repliesSent: 0,
    repliesObserved: 0,
    threadsDeferred: 0,
    listingTruncated: false,
    remainingNeedsDraft: 0,
    durationMs,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

async function loadIgnoreRules(): Promise<IgnoreRules> {
  const { data, error } = await getAdminClient()
    .from('email_triage_ignore_rules')
    .select('kind, value')
  if (error) throw error

  const domains = new Set<string>()
  const addresses = new Set<string>()
  for (const row of (data ?? []) as { kind: string; value: string }[]) {
    const value = row.value.trim().toLowerCase()
    if (!value) continue
    if (row.kind === 'domain') domains.add(value)
    else addresses.add(value)
  }
  return { domains, addresses }
}

interface TriageSettings {
  enabled: boolean
  query: string
}

async function loadSettings(): Promise<TriageSettings> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('email_triage_enabled, email_triage_query')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  const row = data as { email_triage_enabled?: boolean; email_triage_query?: string | null } | null
  return {
    enabled: Boolean(row?.email_triage_enabled),
    query: row?.email_triage_query?.trim() || TRIAGE_SEARCH_QUERY,
  }
}

export interface ExistingTriageRow {
  id: string
  gmail_thread_id: string
  gmail_message_id: string
  gmail_draft_message_id: string | null
  status: string
  classification: TriageClassification
}

/**
 * Every row this mailbox already has, whatever its status — not only the open
 * ones. Both halves matter and both are easy to get wrong:
 *
 * Open rows are re-checked even when Gmail's search no longer returns their
 * thread, because a thread the attorney answered and archived leaves the
 * results and would otherwise sit in the queue forever having been dealt with.
 *
 * Resolved rows are loaded so the scan can recognise them and leave them alone.
 * A dismissed thread's last message is still inbound, so without this the very
 * next scan would file it as needing a reply again and dismissing anything
 * would do nothing at all.
 */
async function loadExistingRows(connectionEmail: string): Promise<ExistingTriageRow[]> {
  const { data, error } = await getAdminClient()
    .from('email_triage_threads')
    .select('id, gmail_thread_id, gmail_message_id, gmail_draft_message_id, status, classification')
    .eq('connection_email', connectionEmail)
  if (error) throw error
  return (data ?? []) as ExistingTriageRow[]
}

const OPEN_STATUSES = new Set(['needs_reply', 'drafting', 'drafted', 'failed'])

export type ThreadAction =
  /** Nothing to do — not waiting on the firm, or settled and unchanged. */
  | { kind: 'skip' }
  /** It was answered outside Cornerstone; close the row. */
  | { kind: 'resolve' }
  /** It is waiting. `reset` clears any draft, which no longer answers the last word. */
  | { kind: 'queue'; reset: boolean }

/**
 * What this scan should do with one thread. Pure, so the rules that decide
 * whether the attorney sees a message again can be tested without a mailbox.
 *
 * The two rules worth stating plainly, because both fail quietly:
 *
 * A dismissed or replied thread still *ends* with an inbound message — that is
 * what it means to have dismissed it. Re-queueing on that basis would make
 * Dismiss do nothing at all, so a settled row is left alone while it is the
 * same message. A **new** inbound message reopens it: dismissal is of a
 * message, not of a correspondent forever. Silencing someone permanently is
 * what the sender and domain ignore rules are for.
 *
 * A new inbound message on an open row invalidates the draft, which was written
 * to answer something that is no longer the last thing said.
 */
export function decideThreadAction(
  verdict: { needsReply: boolean; reason?: string; inboundMessageId?: string },
  existing: ExistingTriageRow | undefined,
): ThreadAction {
  if (!verdict.needsReply) {
    const open = existing && OPEN_STATUSES.has(existing.status)
    return open && verdict.reason === 'already_replied' ? { kind: 'resolve' } : { kind: 'skip' }
  }
  if (!existing) return { kind: 'queue', reset: true }

  const sameMessage = existing.gmail_message_id === verdict.inboundMessageId
  if (!OPEN_STATUSES.has(existing.status)) {
    return sameMessage ? { kind: 'skip' } : { kind: 'queue', reset: true }
  }
  return { kind: 'queue', reset: !sameMessage }
}

export async function runEmailTriageScan(opts: TriageScanOptions): Promise<TriageScanResult> {
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const maxThreads = opts.maxThreads ?? TRIAGE_LISTING_CEILING
  const maxDrafts = opts.maxDrafts ?? DEFAULT_MAX_DRAFTS
  const admin = getAdminClient()

  const settings = await loadSettings()
  if (!settings.enabled) return emptyResult('disabled', Date.now() - startedAt)

  // The mutex. consumeRateLimit fails open by design (lib/rateLimit.ts), so it
  // limits abuse and cannot be relied on for correctness: without this a cron
  // run and a Refresh click would draft the same threads twice and bill twice.
  const { data: inFlight } = await admin
    .from('email_triage_scans')
    .select('id, started_at')
    .is('finished_at', null)
    .gte('started_at', new Date(Date.now() - STALE_SCAN_MS).toISOString())
    .limit(1)
    .maybeSingle()
  if (inFlight) return emptyResult('already_running', Date.now() - startedAt)

  let identity: Awaited<ReturnType<typeof getMailboxIdentity>>
  try {
    identity = await getMailboxIdentity(opts.userId)
  } catch (err) {
    if (err instanceof GmailReadError && err.kind !== 'gmail_error') {
      return emptyResult(err.kind === 'missing_scope' ? 'missing_scope' : 'no_connection',
        Date.now() - startedAt)
    }
    throw err
  }

  const { data: scanRow, error: scanErr } = await admin
    .from('email_triage_scans')
    .insert({ trigger: opts.trigger, actor_id: opts.actorId ?? null })
    .select('id')
    .single()
  if (scanErr) throw scanErr
  const scanId = (scanRow as { id: string }).id

  const counts = {
    threadsListed: 0,
    threadsExamined: 0,
    queued: 0,
    resolved: 0,
    skippedAutomated: 0,
    skippedInternal: 0,
    draftsGenerated: 0,
    repliesSent: 0,
    repliesObserved: 0,
    threadsDeferred: 0,
  }
  let listingTruncated = false
  let failure: string | null = null

  try {
    const [ignore, existingRows] = await Promise.all([
      loadIgnoreRules(),
      loadExistingRows(identity.address),
    ])

    const firmDomains = Array.from(new Set([
      emailDomain(identity.address),
      emailDomain(getFirmConfig().email),
    ]))

    const listed = await listTriageThreadIds({
      token: identity.token,
      query: settings.query,
      maxResults: maxThreads,
    })
    counts.threadsListed = listed.length
    listingTruncated = listed.length >= maxThreads

    // Open rows first: resolving one is cheap and is what keeps the queue
    // honest. Gmail's search drops a thread once it is archived, so a thread
    // answered and filed would otherwise never be revisited. Resolved rows are
    // not re-fetched — they are only consulted when their thread turns up in
    // the search anyway.
    const threadIds = Array.from(new Set([
      ...existingRows
        .filter(row => OPEN_STATUSES.has(row.status))
        .map(row => row.gmail_thread_id),
      ...listed,
    ]))
    const rowByThread = new Map(existingRows.map(row => [row.gmail_thread_id, row]))

    // Open rows are read whatever the clock says: they are few, and they are
    // the rows already on the attorney's screen. Only the listing defers.
    const metadataDeadline = startedAt + Math.max(budgetMs - DRAFTING_RESERVE_MS, 5_000)
    const openThreadIds = new Set(
      existingRows.filter(row => OPEN_STATUSES.has(row.status)).map(row => row.gmail_thread_id),
    )
    const threads = await mapWithConcurrency(threadIds, METADATA_CONCURRENCY, async id => {
      if (Date.now() > metadataDeadline && !openThreadIds.has(id)) {
        counts.threadsDeferred += 1
        return null
      }
      try {
        return await getThreadMetadata({ token: identity.token, threadId: id })
      } catch (err) {
        // One unreadable thread — deleted between list and fetch, or a quota
        // bounce — must not abandon the scan.
        if (err instanceof GmailReadError) return null
        throw err
      }
    })

    // How many separate threads each address opened across this scan. A person
    // writing to a law firm opens one, maybe two; a claims desk opens seven,
    // each with its own reference number. Counted once here rather than
    // re-derived per thread.
    const threadsBySender = new Map<string, number>()
    for (const thread of threads) {
      const last = thread?.messages.at(-1)
      if (!last) continue
      const key = last.from.email.toLowerCase()
      threadsBySender.set(key, (threadsBySender.get(key) ?? 0) + 1)
    }

    for (const thread of threads) {
      if (!thread) continue
      counts.threadsExamined += 1
      const existing = rowByThread.get(thread.id)

      const verdict = evaluateNeedsReply({
        connectedAddress: identity.address,
        ownDraftMessageIds: existing?.gmail_draft_message_id
          ? [existing.gmail_draft_message_id]
          : [],
        thread,
      })

      const action = decideThreadAction(verdict, existing)
      if (action.kind === 'skip') continue

      if (action.kind === 'resolve') {
        // The thread now ends outbound: it was answered in Gmail, on a phone,
        // wherever. That is the queue cleaning itself.
        const now = new Date().toISOString()
        await admin
          .from('email_triage_threads')
          .update({ status: 'replied', replied_at: now, last_scanned_at: now, updated_at: now })
          .eq('id', existing!.id)
        counts.resolved += 1
        // File it under Client / Lead the same way an approved reply is. Best
        // effort: the reply already went out, and a labelling failure is not a
        // reason to fail the scan or leave the row open.
        await applyTriageLabel({
          token: identity.token,
          threadId: thread.id,
          classification: existing!.classification,
        }).catch(() => {})
        continue
      }

      // `action.kind === 'queue'` already implies this; restated so the
      // verdict narrows to the branch carrying the inbound message.
      if (!verdict.needsReply) continue

      const inbound = thread.messages.find(m => m.id === verdict.inboundMessageId)
      if (!inbound) continue

      const match = await classifySender(admin, {
        email: inbound.from.email,
        name: inbound.from.name,
        threadsFromSender: threadsBySender.get(inbound.from.email.toLowerCase()) ?? 1,
        headers: inbound.headers,
        labelIds: inbound.labelIds,
        subject: inbound.subject,
        ignore,
        connectedAddress: identity.address,
        firmDomains,
        // The other side of a thread the firm started, for a sender whose own
        // address matches nothing — a client written to at work who replies
        // from personal Gmail.
        threadParticipants: collectThreadParticipants({
          messages: thread.messages,
          senderEmail: inbound.from.email,
          connectedAddress: identity.address,
          firmDomains,
        }),
      })

      if (match.classification === 'internal') {
        counts.skippedInternal += 1
        continue
      }
      if (match.classification === 'automated') {
        counts.skippedAutomated += 1
        continue
      }

      // A newer inbound message means the drafted reply answers something that
      // is no longer the last word, so the draft is cleared and the row goes
      // back into the queue.
      const now = new Date().toISOString()

      const { error: upsertErr } = await admin
        .from('email_triage_threads')
        .upsert({
          connection_email: identity.address,
          gmail_thread_id: thread.id,
          gmail_message_id: inbound.id,
          message_id_header: inbound.messageIdHeader,
          references_header: inbound.references,
          thread_message_count: verdict.messageCount,
          sender_email: inbound.from.email,
          sender_name: match.displayName ?? inbound.from.name,
          sender_domain: emailDomain(inbound.from.email),
          subject: inbound.subject,
          snippet: inbound.snippet,
          received_at: verdict.receivedAt,
          classification: match.classification,
          classification_reason: match.reason,
          client_intake_id: match.clientIntakeId,
          matter_id: match.matterId,
          contact_id: match.contactId,
          last_scanned_at: now,
          updated_at: now,
          human_draft_at: verdict.humanDraftAt,
          ...(action.reset
            ? {
                status: 'needs_reply',
                draft_subject: null,
                draft_body: null,
                draft_generated_at: null,
                draft_error: null,
                gmail_draft_id: null,
                gmail_draft_message_id: null,
                approved_at: null,
                dismissed_at: null,
                dismissed_reason: null,
                replied_at: null,
              }
            : {}),
        }, { onConflict: 'connection_email,gmail_thread_id' })
      if (upsertErr) throw upsertErr
      counts.queued += 1
    }

    const drafting = await draftPending({
      connectionEmail: identity.address,
      token: identity.token,
      userId: opts.userId ?? null,
      // The dial sends as the person whose Gmail this is: the clicker on a
      // manual refresh, the mailbox owner on a cron run.
      actorId: opts.actorId ?? identity.userId ?? null,
      route: opts.trigger === 'cron' ? 'cron/email-triage' : 'admin/email-triage',
      maxDrafts,
      deadline: startedAt + budgetMs,
    })
    counts.draftsGenerated = drafting.drafted
    counts.repliesSent = drafting.sent
    counts.repliesObserved = drafting.observed
  } catch (err) {
    failure = describeError(err)
  }

  const { count: remaining } = await admin
    .from('email_triage_threads')
    .select('id', { count: 'exact', head: true })
    .eq('connection_email', identity.address)
    .eq('status', 'needs_reply')
    .or(`human_draft_at.is.null,human_draft_at.lt.${humanDraftCutoff()}`)

  await admin
    .from('email_triage_scans')
    .update({
      finished_at: new Date().toISOString(),
      threads_listed: counts.threadsListed,
      threads_examined: counts.threadsExamined,
      threads_queued: counts.queued,
      threads_resolved: counts.resolved,
      skipped_automated: counts.skippedAutomated,
      skipped_internal: counts.skippedInternal,
      drafts_generated: counts.draftsGenerated,
      error: failure,
    })
    .eq('id', scanId)

  return {
    ok: failure === null,
    scanId,
    ...counts,
    listingTruncated,
    remainingNeedsDraft: remaining ?? 0,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * Draft replies for queued rows, newest first, until the budget or the count
 * runs out.
 *
 * Drafting is the expensive half — a model call each, seconds apiece — so it is
 * capped rather than run to completion. What is left stays `needs_reply`, shows
 * a "Generate draft" button in the page, and is picked up by the next pass.
 */
async function draftPending(args: {
  connectionEmail: string
  token: string
  userId: string | null
  /** Who a delegated send runs as; null means the dial is not consulted. */
  actorId: string | null
  route: 'admin/email-triage' | 'cron/email-triage'
  maxDrafts: number
  deadline: number
}): Promise<{ drafted: number; sent: number; observed: number }> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('email_triage_threads')
    .select('id, gmail_thread_id, gmail_message_id, classification, client_intake_id, matter_id, sender_email, sender_name, subject, received_at')
    .eq('connection_email', args.connectionEmail)
    .eq('status', 'needs_reply')
    // Nobody wants a second answer written over the one they are typing — but
    // a reply abandoned two days ago is not being typed.
    .or(`human_draft_at.is.null,human_draft_at.lt.${humanDraftCutoff()}`)
    .order('received_at', { ascending: false })
    .limit(args.maxDrafts)
  if (error) throw error

  let drafted = 0
  let sent = 0
  let observed = 0
  for (const row of (data ?? []) as Record<string, string | null>[]) {
    if (Date.now() > args.deadline) break

    // Claim it. Zero rows back means another run took it between the select
    // and here, which is the case this conditional update exists to lose
    // safely rather than pay twice for.
    const claim = await admin
      .from('email_triage_threads')
      .update({ status: 'drafting', updated_at: new Date().toISOString() })
      .eq('id', row.id as string)
      .eq('status', 'needs_reply')
      .select('id')
    if (claim.error) throw claim.error
    if (!claim.data?.length) continue

    try {
      // The body is read live and never stored — see the migration header.
      const thread = await getThread({
        token: args.token,
        threadId: row.gmail_thread_id as string,
      })
      const inbound = thread?.messages.find(m => m.id === row.gmail_message_id)
      if (!inbound) throw new Error('the message is no longer in Gmail')

      const draft = await generateTriageDraft({
        classification: row.classification as 'client' | 'lead' | 'contact' | 'possible_lead',
        clientIntakeId: row.client_intake_id,
        matterId: row.matter_id,
        senderEmail: row.sender_email as string,
        senderName: row.sender_name,
        subject: row.subject,
        receivedAt: row.received_at as string,
        bodyText: inbound.bodyText,
        userId: args.userId,
        route: args.route,
      })

      await admin
        .from('email_triage_threads')
        .update({
          status: 'drafted',
          draft_subject: draft.subject,
          draft_body: draft.body,
          draft_model: draft.model,
          draft_generated_at: new Date().toISOString(),
          draft_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id as string)
      drafted += 1

      // The draft is on the page. Whether it also goes out is the delegation
      // dial's call; a failure there leaves the draft where it is, with the
      // reason attached, and never undoes the drafting above.
      const delegated = await delegateTriageReply({
        actorId: args.actorId,
        row: {
          id: row.id as string,
          gmail_message_id: row.gmail_message_id as string,
          classification: row.classification as 'client' | 'lead' | 'contact' | 'possible_lead',
          sender_email: row.sender_email as string,
          sender_name: row.sender_name,
          subject: row.subject,
          matter_id: row.matter_id,
          client_intake_id: row.client_intake_id,
        },
      })
      if (delegated === 'sent') sent += 1
      else if (delegated === 'observed') observed += 1
    } catch (err) {
      // A failed draft keeps its place in the queue with a Retry button. The
      // thread still needs a reply; only the drafting of one went wrong.
      await admin
        .from('email_triage_threads')
        .update({
          status: 'failed',
          draft_error: describeError(err),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id as string)
    }
  }
  return { drafted, sent, observed }
}
