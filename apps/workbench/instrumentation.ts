import * as Sentry from '@sentry/nextjs'

/**
 * This file must exist, even when it registers nothing.
 *
 * Next resolves its convention files (instrumentation, instrumentation-client,
 * proxy) by walking UP from the app directory. With no local copy the workbench
 * compiles the ROOT app's `instrumentation.ts` — reporting this app's errors
 * into the other app's Sentry project, from a dependency this app may not
 * declare. That failure is invisible locally, because npm hoists the dependency
 * into the shared node_modules; Vercel installs scoped to this directory, so it
 * fails only in production. It did, on the first deploy of main.
 *
 * `tests/convention-file-isolation.test.ts` fails if this file is removed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/sentry/server')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./lib/sentry/edge')
  }
}

export const onRequestError = Sentry.captureRequestError
