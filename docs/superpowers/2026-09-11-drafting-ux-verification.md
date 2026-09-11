# Drafting reliability and efficiency delivery

Implemented on `codex/drafting-ux` in `/private/tmp/cornerstone-drafting-ux`, based on `b7109878`. The original shared checkout and its unrelated work were preserved.

## Delivered behavior

- Design saves drain outstanding requests and edits before draft checks. Lifetime Planning actions participate in the same barrier, retain failures, and cannot overwrite a newer queued patch with an older retry. Save/conflict state stays visible across steps.
- Draft checks capture data, deed inputs, contacts and clause overrides; generation validates the source revision. The legacy Supabase renderer can consume the same captured payload and selections. Workflow status/timestamp updates do not invalidate source identity.
- Durable draft runs provide atomic ownership, leases, immutable output identity, per-document results, partial retries, and recovery after interrupted requests. Successful outputs survive response loss and renames. Results stay visible until the attorney chooses to review.
- Review is an explicit action against the version actually opened. New content clears review metadata. PDF conversion creates unreviewed, unshared output. Live missing-field eligibility takes precedence over old generation counts; sharing still checks the server safeguard.
- Review includes a document sidebar, next-unreviewed navigation, selected conversion with retained failures, optional assistant, grouped history, and authenticated version comparison. Historical private Word versions remain staff-only.
- Design uses a clause drawer when a third column would constrain the form, with a next-unresolved-decision action and grouped issues. Generate preserves document choices during fix/navigation round trips and collapses secondary source details.
- Hub search, filters, sorting, facet counts and pagination run against the full server result. Saved views and return context remain intact. Responses contain at most 50 matters and five draft previews per matter.
- Matter-level activity summaries use existing run/review timestamps. Labels distinguish elapsed time from active work and send no client content to external telemetry.

## Verification

- Node 24 is the supported local runtime. An initial Node 26 run exposed unrelated jsdom/localStorage failures and was replaced with a supported-runtime run.
- Full lint: no errors; 10 warnings in unchanged lead notes, engagement and task files.
- Full TypeScript check: passed. Final changed-file checks recorded with delivery.
- Full Vitest suite: 531 files passed, one skipped; 5,356 tests passed, two skipped. The final save-race follow-up also passed its 16-test focused suite. Source-text tests were updated where the approved behavior changed; behavioral tests cover save races, source mismatch, partial persistence, renamed-output retry, expired-run recovery, version review, sharing and selected conversion.
- Disposable PostgreSQL 17 tests passed for migration replay, service access, RLS, simultaneous claims, hash mismatch, immutable uniqueness after rename, partial resume, expired/old-worker fencing, legacy output and metrics. Fixture uses the repository's text `matter_documents.matter_id` type.
- Hub SQL tested with 1,203 synthetic matters and 3,102 TypeScript/SQL inclusion-parity cases, including matches beyond 1,000 rows, exact facets, stable ties, preview limits and page clamping.
- Actual React components and production CSS rendered in an isolated Vite fixture at 390, 768 and 1280-pixel widths. Verified phone/tablet clause drawers and no page-width overflow, one-action generation with retained results, search controls, real Word rendering, explicit review controls, selected conversion failure feedback, and optional assistant.
- Independent reviews covered review/version authorization, run recovery and hub semantics; identified issues were corrected. No production client data was used in browser verification.

## Release requirements and limits

Apply the two additive migrations before deploying the application, after normal linked-history/catalog reconciliation:

1. `supabase/migrations/20260911191300_drafting_runs.sql`
2. `supabase/migrations/20260911192500_drafting_hub_page.sql`

The new hub deliberately reports a missing migration instead of falling back to an incomplete first page. Generation remains request-driven with a five-minute execution budget and a six-minute recovery lease; interrupted runs recover on status checks and can be retried. It is not a separate background worker. Retry preserves completed outputs but the existing package renderer can still render a full package internally before only outstanding outputs are persisted.

Local database fixtures represent the relevant production schema; they do not replay every historical migration. Browser services and conversion results were synthetic. Live conversion, storage, application deployment and authenticated application smoke tests remain release-time checks. No shared database changes, client sends, deployment or remote push were performed during the initial implementation verification.

## Production migration deployment — September 11, 2026

Both migrations above were applied to the verified `cornerstone` Supabase project (`qifunlovuwaryzsyfbnh`) following explicit deployment authorization. Before deployment, the live catalog confirmed their objects were absent and all 208 prior local migration versions matched remote history. The dry run listed only these two files; `--include-all` was required because existing remote history contains later version timestamps. No history repair, seed, role, or vault changes were needed.

Post-deployment verification:

- All 210 migration versions match; the final dry run reports the remote database is up to date.
- The run ledger, output identity column/index, matter index, registration trigger, and five functions are present. Ledger RLS is enabled. The ledger and functions deny access to `anon` and `authenticated` and grant their intended service-role access; all five functions use invoker security and a fixed empty search path.
- Read-only service-role SQL and actual Data API requests passed for the hub and metrics. The live hub returned one requested row from 31 eligible matters with at most five preview documents. Anonymous hub access returned HTTP 401 / PostgreSQL `42501`.
- Security advisors reported no new errors or warnings. The only new informational finding is the deliberately policy-free, service-only run ledger. Existing unrelated findings remain unchanged.
- Regenerated public-schema types include the deployed drafting objects and previously deployed email-triage definitions. Generated-type checks and application typecheck passed.

The application was not deployed or merged as part of this database deployment. No production documents or matter records were changed by verification.
