import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,

    // No traces by default — opt in via env if perf monitoring is wanted.
    // Errors are always captured regardless of this setting.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),

    // Estate-planning data flows through this app. Do NOT let Sentry attach
    // request bodies, cookies, headers, IPs, or user identifiers automatically.
    sendDefaultPii: false,

    beforeSend(event) {
      // Strip request data that may carry client PII (intake payloads,
      // design-sheet form submissions, etc.) before the event leaves the server.
      if (event.request) {
        delete event.request.cookies
        delete event.request.data
        delete event.request.headers
        delete event.request.query_string
      }
      delete event.user
      return event
    },
  })
}
