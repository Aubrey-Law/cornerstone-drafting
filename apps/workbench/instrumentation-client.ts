import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from './lib/sentry/scrub'

/**
 * Shadows the root app's client instrumentation for the reason given in
 * `instrumentation.ts`: Next resolves this convention file by walking up, and
 * inheriting the other app's would report this app's errors into the other
 * app's project under the other app's DSN.
 *
 * Session Replay is deliberately absent rather than configured off. It ships
 * ~50KB to every client and records the DOM of a page showing a client's
 * estate plan; if a recurring bug ever needs it, it should be a decision taken
 * then, with masking reviewed at the same time.
 *
 * `tests/convention-file-isolation.test.ts` fails if this file is removed.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) Sentry.init(sentryOptions(dsn))

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
