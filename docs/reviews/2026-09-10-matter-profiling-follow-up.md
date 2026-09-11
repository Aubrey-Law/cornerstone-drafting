# Matter detail profiling and acceptance follow-up

Work began September 10 and completed its browser checks September 11, 2026 (Eastern time).

## Verified release

PRs #458 and #459 are merged. Main and the production alias matched `3bc6bb1a0d4d612fa64e72966acc9668e4d3cd73`; Vercel deployment `dpl_CrVp5o5SQatXCGm1JtFTCubyfpzv` was READY. Post-merge Application CI, schema checks, and migration drift passed. The corrected migration-deployment workflow completed successfully after #458.

## Read-only investigation

Six cycles invoked the existing identity, core matter, contacts, aging, design-sheet read, and intake-snapshot functions against the production database from local Node 24. The harness allowed only GET/HEAD requests to the configured Supabase origin and logged only phase/table names, durations, and HTTP status. No data mutation or draft generation occurred. All observed HTTP responses were 200. [Raw timing observations](2026-09-10-matter-read-profile.json) retain no record identifiers or returned values.

| Read function | Nearest-rank p50 | Maximum |
| --- | ---: | ---: |
| Identity | 100 ms | 347 ms |
| Core matter | 98 ms | 377 ms |
| Contacts | 246 ms | 481 ms |
| Aging | 102 ms | 377 ms |
| Design sheet | 99 ms | 380 ms |
| Intake snapshot | 300 ms | 623 ms |

The intake read made seven requests in the sampled record, with several dependent contact reads. This explains some ordinary waiting but does **not** establish the cause of the previously observed 4.9–6.4-second page loads. These are parallel function probes from the local host, not a full-page/Vercel trace; they omit layout/auth, several supporting page reads, browser rendering, and the page's actual identity-first schedule. No improvement or complete performance acceptance is claimed.

## Diagnostic change

The matter page now measures its existing read operations without changing their inputs, results, query scope, concurrency, or error handling. Requests taking at least 1,500 ms in the page loader, or throwing, emit one `[matter-detail-timing]` entry in existing server logs. Fast successful requests remain quiet. Each entry contains elapsed milliseconds, fixed phase names, phase start offsets, and completion outcomes only. It never records IDs, URLs, client values, query text, or exception messages. Logging failure cannot turn a successful page into an error.

After a rejected `Promise.all`, unfinished siblings are recorded as pending; the emitted snapshot cannot change when they later finish. A successful phase means its function returned; it does not override that function's own fallback/error semantics. The loader's total includes its synchronous shaping work, but excludes parent layout/proxy authentication, React client rendering, and network transfer. A not-found exception is recorded as an error outcome without its text.

On the next deployed slow request, compare total time with the phase offsets/durations in that request's Vercel logs. If intake dominates, investigate its dependent contact reads; if another phase dominates, inspect that query; if the page loader is fast but navigation is slow, investigate auth/layout, network, and rendering. Keep the two-second p95 target open until comparable live measurements pass. This PR prepares that evidence; it requires deployment before production timing entries exist.

No database migration or new monitoring service is needed. Revert the wrapper and timing helper to remove diagnostics without changing data compatibility.

## Browser acceptance

At a 390×844 viewport, the production Today menu opened, matters list and matter overview rendered, and tasks/billing exposed their principal controls. Matters list/detail, tasks, and billing each measured document width equal to the 390-pixel viewport. Matter detail uses a section selector on mobile instead of the desktop tab list. Screenshots confirmed the Today and matter overview layouts; no screenshot containing client information was committed. The viewport override was reset.

The live Calendar page reported Outlook disconnected; a read-only aggregate query confirmed zero saved calendar connections. Today retained recorded appointments and an unavailable/retry message. Therefore the deployed Outlook concurrency fix cannot receive a connected-mailbox smoke test until the owner restores the connection, if Outlook integration remains desired. No provider connection was added or deleted during this work.

A separate disposable local Supabase project replayed all repository migrations through `20261124000000` and seeded synthetic staff/client accounts. It used separate ports, no live communications credentials, and `EMAILS_ENABLED=false`. The browser checkout used the deployed release plus the Send-button accessibility correction below.

The synthetic portal roundtrip passed:

1. The client signed in, sent a synthetic message, and reloaded the conversation to confirm persistence.
2. The attorney signed in and saw one unread message in Today. Read & reply opened the matching matter and its Portal messages tab.
3. The attorney sent a portal reply; the saved conversation showed both messages. Returning to Today removed the unread-message item.
4. The client signed back in, saw one unread reply on the dashboard, and opened the conversation. Both messages rendered at 390×844 with the composer visible and no document overflow.
5. Returning to the dashboard cleared the client's unread badge. A local aggregate query confirmed exactly one client message and one attorney message, both with `read_at` populated.

The test tab was closed, the viewport restored, and only the test server and disposable database project were stopped. Synthetic data was retained locally. Realtime delivery to an already-open second session was not exercised; this stack excluded realtime, so this verifies persisted send/read/reply and unread behavior across navigation. Authenticated failure/retry browser checks remain a separate acceptance item.

The client composer had an icon-only Send button with no accessible name. It now exposes `Send message` to assistive technology. The regression assertion failed against the old markup, passed with the label, and the corrected name was verified in the mobile browser. Sending, keyboard shortcuts, and disabled-state behavior are unchanged.

## Local validation

The timing tests verify parallel work, quiet fast requests, fixed-label-only slow/error logs, preservation of returned values/rejections, pending-phase snapshots, and logger failure isolation. The existing page-loading tests confirm intake/upload work still overlaps the overview and failures do not render a false all-clear. A brittle source-string assertion was replaced with a real page execution asserting that `fetchMatter` receives only the canonical ID, retaining hired-only scope. The final focused runs passed 16 matter/portal tests and 13 timing/message-boundary tests. Final verification on Node 24: `npm run lint -- --max-warnings=10` passed with ten existing warnings; `npm run typecheck` passed; `npm test -- --reporter=dot` passed all 490 files and 5,042 tests with one skipped; `npm run build:ci` passed with synthetic credentials. The full suite was rerun after replacing the source-string assertion and after the Send label change. Focused lint on all changed application files also passed.
