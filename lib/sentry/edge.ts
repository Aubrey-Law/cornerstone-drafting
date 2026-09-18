import * as Sentry from '@sentry/nextjs'

import { redactEventLinkTokens } from '@/lib/sentry/redact'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
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

    // Transactions do not go through beforeSend, and HttpContext puts the full
    // href on the segment span as `url.full`, so this hook is not optional.
    beforeSendTransaction(event) {
      if (event.request) {
        delete event.request.headers
        delete event.request.query_string
      }
      return redactEventLinkTokens(event)
    },
  })
}
