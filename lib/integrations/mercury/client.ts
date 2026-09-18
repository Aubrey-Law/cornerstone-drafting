import 'server-only'
import type { z } from 'zod'
import { IntegrationError } from '@/lib/integrations/errors'
import type { IntegrationFailureKind } from '@/lib/integrations/types'
import { getMercuryConfig } from './config'
import {
  mercuryAccountSchema, mercuryInvoiceSchema, mercuryListSchema, mercuryTransactionSchema,
  type MercuryAccount, type MercuryInvoice, type MercuryRequestInit, type MercuryTransaction,
} from './types'

const REQUEST_TIMEOUT_MS = 30_000

/**
 * Every Mercury path in one place.
 *
 * Mercury's own reference mixes singular and plural for single-resource routes
 * (`/ar/invoices/{id}` against `/ar/invoice/{id}`) and the published docs and
 * their mirror disagree. Holding the paths here makes a correction one line
 * rather than a search across call sites.
 */
export const MERCURY_PATHS = {
  accounts: '/accounts',
  transactions: '/transactions',
  transaction: (id: string) => `/transaction/${id}`,
  invoices: '/ar/invoices',
  invoice: (id: string) => `/ar/invoices/${id}`,
} as const

/**
 * How many pages a single call will follow.
 *
 * A misconfiguration must not turn one page view into unbounded hammering of
 * the provider, so the follower stops and returns what it has.
 */
const MAX_PAGES = 5

function failure(kind: IntegrationFailureKind, code: string, safeMessage: string, retryAfterMs: number | null = null) {
  return new IntegrationError({ provider: 'mercury', kind, code, safeMessage, retryAfterMs })
}

function retryAfter(value: string | null): number | null {
  if (!value) return null
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) ? delay : null
  }
  // Do not let Date.parse interpret negative seconds as a calendar date.
  if (!/^[A-Za-z]{3}, /.test(value)) return null
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function responseFailure(response: Response): IntegrationError {
  if (response.status === 429) {
    return failure('retryable', 'rate_limited', 'Mercury rate limit reached. Try again later.', retryAfter(response.headers.get('Retry-After')))
  }
  if (response.status >= 500) return failure('retryable', 'provider_unavailable', 'Mercury is temporarily unavailable.')
  switch (response.status) {
    // Mercury deletes a token after 45 days of no activity, so 401 is as likely
    // to mean "expired" as "wrong" — both need a person, not a retry.
    case 401: return failure('attention', 'authentication_required', 'Reconnect Mercury to continue reading bank activity.')
    case 403: return failure('attention', 'permission_denied', 'The Mercury token does not have permission for this operation.')
    case 404: return failure('attention', 'not_found', 'The Mercury record could not be found.')
    case 422: return failure('attention', 'validation_failed', 'Mercury rejected the supplied request fields.')
    default: return failure('attention', 'request_rejected', 'Mercury rejected the request.')
  }
}

async function mercuryRequest<S extends z.ZodTypeAny>(path: string, schema: S, init: MercuryRequestInit): Promise<z.output<S>> {
  // Paths are built here, never passed in from a caller's data.
  if (!path.startsWith('/') || path.includes('..') || path.includes('//')) {
    throw failure('attention', 'invalid_request', 'The Mercury API path is invalid.')
  }
  const cancelled = () => failure('retryable', 'timeout', 'The Mercury request timed out.')
  if (init.signal?.aborted) throw cancelled()

  const { token, baseUrl } = getMercuryConfig()
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  if (init.signal?.aborted) controller.abort()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    if (controller.signal.aborted) throw cancelled()
    const response = await fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    })
    if (controller.signal.aborted) throw cancelled()
    // Never read or log provider error bodies: they can echo the token back, and
    // they carry customer detail that has no business in a log line.
    if (!response.ok) throw responseFailure(response)

    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw failure('retryable', 'invalid_response', 'Mercury returned an invalid response.')
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw failure('attention', 'invalid_response', 'Mercury returned an unexpected response shape.')
    return parsed.data
  } catch (error) {
    if (error instanceof IntegrationError) throw error
    // Never attach the transport cause; it can carry the request URL and headers.
    throw controller.signal.aborted ? cancelled() : failure('retryable', 'connection_failed', 'Mercury could not be reached.')
  } finally {
    clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abort)
  }
}

/** Follow `page.nextPage` up to MAX_PAGES, then stop and return what we have. */
async function listAll<S extends z.ZodTypeAny>(
  path: string,
  resource: string,
  item: S,
  query: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<z.output<S>[]> {
  const schema = mercuryListSchema(resource, item)
  const rows: z.output<S>[] = []
  let startAfter: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const parsed = await mercuryRequest(path, schema, { method: 'GET', query: { ...query, start_after: startAfter }, signal })
    const body = parsed as Record<string, unknown> & { page?: { nextPage?: string | null } | null }
    rows.push(...((body[resource] as z.output<S>[] | undefined) ?? []))
    const next = body.page?.nextPage
    if (!next) return rows
    startAfter = next
  }
  return rows
}

export function listMercuryAccounts(signal?: AbortSignal): Promise<MercuryAccount[]> {
  return listAll(MERCURY_PATHS.accounts, 'accounts', mercuryAccountSchema, { limit: 100 }, signal)
}

/**
 * Transactions in a settlement window.
 *
 * `postedStart`/`postedEnd` filter on settlement; `start`/`end` filter on
 * creation and silently miss transactions that posted days after they were
 * authorized, which is most of them.
 */
export function listMercuryTransactions(
  input: { accountId?: string; postedStart: string; postedEnd: string; limit?: number },
  signal?: AbortSignal,
): Promise<MercuryTransaction[]> {
  return listAll(MERCURY_PATHS.transactions, 'transactions', mercuryTransactionSchema, {
    accountId: input.accountId,
    postedStart: input.postedStart,
    postedEnd: input.postedEnd,
    limit: input.limit ?? 500,
    order: 'desc',
  }, signal)
}

export function getMercuryTransaction(id: string, signal?: AbortSignal): Promise<MercuryTransaction> {
  return mercuryRequest(MERCURY_PATHS.transaction(id), mercuryTransactionSchema, { method: 'GET', signal })
}

export function listMercuryInvoices(signal?: AbortSignal): Promise<MercuryInvoice[]> {
  return listAll(MERCURY_PATHS.invoices, 'invoices', mercuryInvoiceSchema, { limit: 100, order: 'desc' }, signal)
}

export function getMercuryInvoice(id: string, signal?: AbortSignal): Promise<MercuryInvoice> {
  return mercuryRequest(MERCURY_PATHS.invoice(id), mercuryInvoiceSchema, { method: 'GET', signal })
}
