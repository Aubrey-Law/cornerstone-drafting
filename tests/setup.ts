import { config } from 'dotenv'

// jsdom implements no layout, so `Element.prototype.scrollIntoView` does not
// exist. Any component that calls it — 20-odd of ours do, to keep a keyboard
// cursor on screen — throws a TypeError from inside its event handler. Vitest
// surfaces that as an unhandled error, and depending on when it lands relative
// to the file finalising its results, sometimes fails the file too: hence a
// test that looked flaky while throwing on every single run.
//
// A no-op is the honest stand-in. There is no viewport in jsdom, so there is no
// scrolling to assert on; a test that cares which row is on screen would have to
// spy on this itself.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// Tests load `.env.test` if present; fall back to `.env.local`.
config({ path: '.env.test', override: false })
config({ path: '.env.local', override: false })

// Static analysis tests do not need a live Supabase project. Integration tests
// that require real credentials should skip when env is missing.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service-role-key'
}
