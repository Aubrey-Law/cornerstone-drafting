import * as Sentry from '@sentry/nextjs'
import { redactEventLinkTokens } from '@/lib/sentry/redact'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

// Replay ships ~50KB of extra JS to every client. Keep it off by default
// for this PII-heavy legal app and let Scott flip the env flag if a
// recurring bug ever needs replay context. The static `=== '1'` check is
// inlined at build time so the Replay code can be tree-shaken when off.
const REPLAY_ENABLED = process.env.NEXT_PUBLIC_SENTRY_REPLAY === '1'

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV,
    release:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    tracesSampleRate: 0.1,

    // Replay sampling — only relevant when REPLAY_ENABLED. Keep modest so
    // we capture a useful sample of error sessions without drowning the
    // quota or paying CPU cost on every error.
    replaysOnErrorSampleRate: REPLAY_ENABLED ? 0.25 : 0,
    replaysSessionSampleRate: 0,

    integrations: REPLAY_ENABLED
      ? [
          Sentry.replayIntegration({
            // Estate-planning data flows through this app — mask all text
            // and block all media to avoid capturing client PII.
            maskAllText: true,
            blockAllMedia: true,
          }),
        ]
      : [],

    // Do not attach cookies, user identifiers, or request bodies automatically.
    sendDefaultPii: false,

    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        delete event.request.data
        delete event.request.headers
        delete event.request.query_string
      }
      delete event.user
      // request.url survives all four deletes above, and on the signing,
      // booking-manage and intake-invite pages it is the credential itself.
      return redactEventLinkTokens(event)
    },

    // Transactions do not go through beforeSend, and the browser SDK samples
    // them on an ordinary page load — no error required. HttpContext puts the
    // full href on the segment span as `url.full`, so this hook is not optional.
    beforeSendTransaction(event) {
      if (event.request) {
        delete event.request.headers
        delete event.request.query_string
      }
      return redactEventLinkTokens(event)
    },
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
