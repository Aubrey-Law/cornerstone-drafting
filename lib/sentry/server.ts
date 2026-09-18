import * as Sentry from '@sentry/nextjs'

import { redactEventLinkTokens } from '@/lib/sentry/redact'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

function isStatularWebhook(url: string): boolean {
  return [process.env.STATULAR_CLIENT_WEBHOOK_URL, process.env.STATULAR_MATTER_WEBHOOK_URL].some(value => {
    if (!value?.trim()) return false
    try {
      // Match the exact canonical URL used by the server transport. The URL is
      // a credential: never attach it to integration options, spans, or errors.
      return url === new URL(value.trim()).href
    } catch {
      return false
    }
  })
}

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

    // Exclude before recording: beforeSend cannot scrub spans, and ordinary
    // outgoing-request breadcrumbs include URLs even with sendDefaultPii false.
    integrations(defaultIntegrations) {
      return [
        ...defaultIntegrations.filter(integration => integration.name !== 'NodeFetch' && integration.name !== 'Http'),
        Sentry.nativeNodeFetchIntegration({ ignoreOutgoingRequests: isStatularWebhook }),
        // Next.js already owns incoming request spans (the SDK default does this too).
        Sentry.httpIntegration({ disableIncomingRequestSpans: true, ignoreOutgoingRequests: isStatularWebhook }),
      ]
    },

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
