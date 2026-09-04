/**
 * What may leave this app in an error report, and what may not.
 *
 * Estate-planning data flows through the Workbench: intake answers,
 * design-sheet submissions, client names, addresses and asset values. An error
 * event that carries a request body carries privileged client material to a
 * third party, so nothing about a request is reported except where it went.
 *
 * Pure, and separate from the three Sentry entry points, so the rule is stated
 * once and tested directly rather than trusted in three near-copies.
 */

import type { ErrorEvent, EventHint } from '@sentry/nextjs'

export type ScrubbableEvent = {
  request?: {
    url?: string
    method?: string
    data?: unknown
    cookies?: unknown
    headers?: unknown
    query_string?: unknown
  }
  user?: unknown
  /** Kept: it is the reason the event exists. Listed so the type says so. */
  exception?: unknown
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    // A query string carries client identifiers in this app (matter ids, search
    // terms), so it goes with the body rather than being treated as metadata.
    delete event.request.data
    delete event.request.cookies
    delete event.request.headers
    delete event.request.query_string
  }
  delete event.user
  return event
}

export type SentryOptions = {
  dsn: string
  environment: string | undefined
  release: string | undefined
  tracesSampleRate: number
  sendDefaultPii: false
  beforeSend: (event: ErrorEvent, hint?: EventHint) => ErrorEvent
}

/**
 * The options every runtime shares. Traces are off unless asked for: errors are
 * captured regardless, and performance data is the part with a per-event cost.
 */
export function sentryOptions(
  dsn: string,
  env: Record<string, string | undefined> = process.env,
): SentryOptions {
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? env.VERCEL_ENV ?? env.NODE_ENV,
    release:
      env.SENTRY_RELEASE ??
      env.NEXT_PUBLIC_SENTRY_RELEASE ??
      env.VERCEL_GIT_COMMIT_SHA ??
      env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  }
}

/** The Workbench reports to its own Sentry project, not the root app's. */
export function serverDsn(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN
}
