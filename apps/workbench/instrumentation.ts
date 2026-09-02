/**
 * This file must exist, even empty — the same trap as `proxy.ts`.
 *
 * Next resolves its convention files (instrumentation, instrumentation-client,
 * proxy/middleware) by walking UP from the app directory. With no local copy,
 * the workbench compiles the ROOT app's `instrumentation.ts`, which imports
 * `@sentry/nextjs` — a dependency this app does not declare.
 *
 * That failure is invisible locally: npm hoists @sentry/nextjs into the shared
 * node_modules, so the import resolves on a developer machine and the build
 * passes. Vercel installs scoped to this directory, so it does not, and the
 * build fails only in production. It did, on the first deploy of main.
 *
 * The workbench has no error reporting configured yet. When it gets some, it
 * goes here — not by deleting this file and inheriting the other app's.
 * `tests/convention-file-isolation.test.ts` fails if this file is removed.
 */
export async function register() {
  // No instrumentation registered yet.
}
