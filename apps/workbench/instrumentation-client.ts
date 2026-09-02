/**
 * Shadows the root app's client instrumentation for the reason given in
 * `instrumentation.ts`: Next resolves this convention file by walking up, and
 * inheriting the other app's would pull in its Sentry client setup and DSN.
 *
 * `tests/convention-file-isolation.test.ts` fails if this file is removed.
 */
export function onRouterTransitionStart() {
  // No client instrumentation registered yet.
}
