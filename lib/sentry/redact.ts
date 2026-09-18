/**
 * Keep client-facing link tokens out of Sentry.
 *
 * Three surfaces hand a URL to someone outside the firm, and in each of them
 * the URL *is* the credential:
 *
 *   /sign/<token>                    executes a fee agreement, valid 30 days
 *   /book/manage/<token>             cancels or moves an appointment, 60 days
 *   /intake/auth?invite=<token>      opens a client's intake questionnaire
 *
 * The `beforeSend` hooks in the three Sentry configs already delete cookies,
 * headers, bodies and `query_string`. None of that touches `request.url`, which
 * the SDK sets from `location.href` — see the HttpContext integration, which
 * calls `getHttpRequestData()` and assigns `url: getLocationHref()`. The href
 * carries the query string, so deleting `query_string` removes the copy and
 * leaves the original.
 *
 * Errors are not the only path. The browser SDK samples transactions, and
 * HttpContext's `processSegmentSpan` writes the same href onto the segment span
 * as `url.full` — that leaves on a page load, with nothing having gone wrong.
 * So this scrubs the whole event rather than a list of fields, and is wired
 * into `beforeSendTransaction` as well as `beforeSend`.
 *
 * The redaction is deliberately narrow — two anchored patterns, not a search
 * for anything that looks secret — which is what makes it safe to run over
 * every string in an event.
 */

/** `/sign/<tok>` and `/api/sign/<tok>`. */
const SIGNING_PATH = /(\/(?:api\/)?sign\/)(?!\[)[^/?#\s"'\\]+/g

/** `/book/manage/<tok>` and `/api/scheduling/manage/<tok>`. */
const MANAGE_PATH = /((?:\/book|\/api\/scheduling)\/manage\/)(?!\[)[^/?#\s"'\\]+/g

/** `?invite=<tok>` / `?token=<tok>`, the two names /intake/auth reads. */
const INVITE_QUERY = /([?&](?:invite|token)=)[^&#\s"'\\]+/gi

export const REDACTED = '[redacted]'

/**
 * Replace link tokens in one string, leaving everything else alone.
 *
 * The `(?!\[)` guards keep Next's own route patterns intact: a server
 * transaction is named `/sign/[token]`, and rewriting that to `/sign/[redacted]`
 * would split the grouping in Sentry for no gain — there is no secret in it.
 */
export function redactLinkTokens(value: string): string {
  return value
    .replace(SIGNING_PATH, `$1${REDACTED}`)
    .replace(MANAGE_PATH, `$1${REDACTED}`)
    .replace(INVITE_QUERY, `$1${REDACTED}`)
}

/**
 * Walk an event and redact every string in it.
 *
 * Enumerating fields was the first attempt and it is the reason this bug
 * existed: `request.url` was simply not on the list, and neither were
 * breadcrumb URLs, span attributes or the message of a `TypeError: Failed to
 * fetch /api/sign/…`. A walk cannot be incomplete in that way. It mutates in
 * place, which is what the SDK expects of a `beforeSend` hook, and stops at a
 * fixed depth so a cyclic or pathological event cannot hang the hook.
 */
function redactDeep(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactLinkTokens(value)
  if (depth <= 0 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = redactDeep(value[i], depth - 1)
    return value
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) record[key] = redactDeep(record[key], depth - 1)
  return record
}

const MAX_DEPTH = 12

export function redactEventLinkTokens<T>(event: T): T {
  return redactDeep(event, MAX_DEPTH) as T
}
