import {
  TRIAGE_SEARCH_QUERY,
  getMailboxIdentity,
  getThread,
  getThreadMetadata,
  listTriageThreadIds,
  GmailReadError,
} from '@/lib/email/gmailRead'
import { getFirmConfig } from '@/lib/firmConfig'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { classifySender, emailDomain, type IgnoreRules } from './classifySender'
import { generateTriageDraft } from './draft'
import { evaluateNeedsReply } from './needsReply'

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
const DEFAULT_MAX_THREADS = 40
const DEFAULT_MAX_DRAFTS = 5

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
    .select('id, gmail_thread_id, gmail_message_id, gmail_draft_message_id, status')
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
  const maxThreads = opts.maxThreads ?? DEFAULT_MAX_THREADS
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
  }
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

    const threads = await mapWithConcurrency(threadIds, METADATA_CONCURRENCY, async id => {
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

    counts.draftsGenerated = await draftPending({
      connectionEmail: identity.address,
      token: identity.token,
      userId: opts.userId ?? null,
      route: opts.trigger === 'cron' ? 'cron/email-triage' : 'admin/email-triage',
      maxDrafts,
      deadline: startedAt + budgetMs,
    })
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  }

  const { count: remaining } = await admin
    .from('email_triage_threads')
    .select('id', { count: 'exact', head: true })
    .eq('connection_email', identity.address)
    .eq('status', 'needs_reply')

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
  route: 'admin/email-triage' | 'cron/email-triage'
  maxDrafts: number
  deadline: number
}): Promise<number> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('email_triage_threads')
    .select('id, gmail_thread_id, gmail_message_id, classification, client_intake_id, matter_id, sender_email, sender_name, subject, received_at')
    .eq('connection_email', args.connectionEmail)
    .eq('status', 'needs_reply')
    .order('received_at', { ascending: false })
    .limit(args.maxDrafts)
  if (error) throw error

  let drafted = 0
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
    } catch (err) {
      // A failed draft keeps its place in the queue with a Retry button. The
      // thread still needs a reply; only the drafting of one went wrong.
      await admin
        .from('email_triage_threads')
        .update({
          status: 'failed',
          draft_error: err instanceof Error ? err.message : String(err),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id as string)
    }
  }
  return drafted
}
