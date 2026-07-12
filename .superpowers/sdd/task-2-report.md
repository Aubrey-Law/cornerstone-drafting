# Task 2 Report

Status: DONE

## Implemented

- Rebuilt the lead detail workspace as a single-column page with top actions followed by Details, Notes, and Activity.
- Added read-only/edit modes with a complete client/spouse form, cancel-to-server-snapshot behavior, client-side email validation, spouse deletion confirmation, and retained form state on save errors.
- Reworked PATCH to validate the Task 1 details contract, persist through `update_lead_details`, return `{ lead, spouse, matterId? }`, convert Hired leads idempotently, and retain Lost leads without conversion.
- Added rendered interaction coverage and focused route contract coverage; enabled `.test.tsx` discovery in Vitest.

## TDD evidence

- RED: `npx vitest run tests/lead-detail-interactions.test.tsx tests/lead-detail-route.test.ts` — route expectations failed because validation/RPC/new response contract were absent; rendered test discovery exposed the existing `.tsx` include gap.
- GREEN: focused lead suites passed after implementation.

## Verification

- `npx vitest run tests/lead-detail-interactions.test.tsx tests/lead-detail-route.test.ts tests/lead-details-persistence.test.ts tests/leads.test.ts tests/lead-workflow.test.ts` — 5 files, 51 tests passed.
- Scoped ESLint — 0 errors, 7 pre-existing-style `no-explicit-any` warnings in the lead UI boundary.
- `git diff --check` — passed.

## Final Hired-flow correction

- Removed route-level matter deletion and status compensation. Hired requests send the prior non-Hired status to the details RPC, then delegate conversion and the Hired transition exclusively to `createMatterFromIntake`.
- Moved the conversion helper's intake link/Hired update until after required `matter_details` persistence succeeds, so a failed conversion does not publish Hired.
- Handler coverage now proves conversion failure performs no cleanup/update, success returns the linked Hired row and spouse, and repeated Hired returns the existing matter and spouse.
- RED: focused handler suite failed 2 tests because the route performed success/failure status updates and cleanup.
- GREEN: exact focused suite passed 5 files and 61 tests; scoped ESLint reported 0 errors and 15 existing `no-explicit-any` warnings; diff check passed.

## Transactional conversion boundary

- Added the service-role-only `convert_lead_to_matter` SECURITY DEFINER RPC to the pending migration. It locks the intake, idempotently finds or creates the matter, upserts required matter details, and links/marks the intake Hired in one PostgreSQL transaction.
- The RPC accepts precomputed identity and matter-detail inputs and has no caller-supplied actor/provenance input. Execute is revoked from public, anon, and authenticated and granted only to service_role.
- Refactored `createMatterFromIntake` to perform the core conversion through exactly one RPC while preserving its return contract; design-sheet seeding and activity remain best-effort after commit.
- RED: `npx vitest run tests/create-matter-from-intake-rpc.test.ts tests/lead-details-persistence.test.ts` failed 4 expected tests because the helper used separate writes and the RPC was absent.
- GREEN: `npx vitest run tests/lead-detail-interactions.test.tsx tests/lead-detail-route.test.ts tests/create-matter-from-intake-rpc.test.ts tests/lead-details-persistence.test.ts tests/leads.test.ts tests/lead-workflow.test.ts` passed 6 files and 65 tests.
- Scoped ESLint: 0 errors, 19 `no-explicit-any` warnings in existing UI/test boundaries. `git diff --check` passed.

## Scope review

- No drafting internals changed.
- Task 1 validation/RPC interfaces were consumed without contract changes.

## Review fixes

- Replaced route source-string assertions with direct `PATCH` handler tests covering authorization, missing and converted leads, spouse RPC payloads, Lost retention, Hired success/failure, and repeated-Hired response completeness.
- Hired edits now persist details under the prior non-Hired status, convert next, and mark Hired only after success. Conversion failures compensate partial matter/link state and restore the prior status.
- Repeated Hired requests now return the existing spouse with the stable response contract.
- Spouse removal confirmation now derives from current form values, including newly entered spouses.
- Added semantic form submission, labeled Select controls for enumerations, explicit button types, and announced errors.

### Review TDD evidence

- RED: `npx vitest run tests/lead-detail-route.test.ts tests/lead-detail-interactions.test.tsx` — 6 expected failures covering Hired ordering/compensation, idempotent spouse response, populated-new-spouse confirmation, selects, and alert semantics.
- GREEN: `npx vitest run tests/lead-detail-interactions.test.tsx tests/lead-detail-route.test.ts tests/lead-details-persistence.test.ts tests/leads.test.ts tests/lead-workflow.test.ts` — 5 files, 61 tests passed.
- Scoped ESLint — 0 errors; warnings are limited to existing boundary/test `no-explicit-any` usage.
- `git diff --check` — passed.
