# Lead Detail Design 2a — Final Review Fix Report

Date: 2026-07-25
Worktree: `/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.worktrees/lead-redesign-2a`
Branch: `codex/lead-redesign-2a`

## Outcome

All eleven final-review findings and the four closure-review follow-ups were
reproduced and remediated in coordinated TDD waves. The new database migration
is authored but was not applied to local or hosted Supabase. No dependency file
was changed, and nothing was pushed.

## Findings closed

1. **Disjoint inline edits could lose updates.** Partial PATCH requests now
   validate only the requested field and call the service-role-only
   `update_lead_opportunity_field` RPC. The RPC locks the lead and linked
   opportunity rows, updates only the requested column(s), serializes spouse
   writes behind the same lock, and returns the committed lead, spouse, and one
   activity row.
2. **A mutation response discarded hydrated intake projections.**
   `mergeHydratedLead` preserves `_children`, fiduciary projections, and other
   hydrated keys while updating the saved lead and `_spouse`. Snooze writes use
   the same projection-preserving merge.
3. **Last-touch state was static after successful actions.** Returned activity,
   locally committed notes/meetings, intake sends, calls, and loader sources now
   contribute to one newest effective touch timestamp. Successful writes update
   the header and next-action decision immediately.
4. **A failed activity refresh made a committed write look failed.** Primary
   mutations and best-effort timeline refreshes now have separate error paths.
   Committed state remains visible; refresh failure is a muted timeline warning.
5. **A post-write spouse read failure could return a false `null`.** The legacy
   full-payload path now returns the validated committed spouse projection when
   its best-effort spouse reread fails and includes a non-fatal refresh warning.
6. **Snooze had no clearing path.** The route and atomic snooze RPC accept
   `null`, write a distinct clear activity, and the header overflow exposes
   **Clear snooze**, restoring the next action immediately.
7. **Day math used elapsed milliseconds / host-local dates.** A shared
   firm-timezone calendar-day helper now powers lead age, last touch,
   appointment boundaries, follow-up age, and dynamic appointment date copy.
   DST and UTC-midnight boundaries are covered.
8. **Admin intake asset flags did not satisfy Assets completion.** The actual
   `has_real_property`, `has_retirement`, `has_investments`, `has_business`, and
   `has_life_insurance` shape is normalized to the canonical asset selection
   expected by the intake completion rules.
9. **New timeline entries could display `System` for the current attorney.**
   The loader includes the authenticated user in the same batched actor lookup
   and passes the resulting display name to the timeline.
10. **A missing first/last name produced duplicate add affordances.** The
    completeness chip is now the single missing-name action; populated name
    components and optional middle/preferred-name add actions remain inline.
11. **Calls with no duration rendered a dangling dash/separator.** Both the call
    row and normalized timeline body build metadata from present values only;
    real durations retain `m:ss` formatting.
12. **Status changes could replay a stale full lead/spouse snapshot.** The UI
    now sends exactly `{ status }` for Lost and Reactivate. The route dispatches
    those requests to a service-role-only `update_lead_opportunity_status` RPC
    that locks the intake and linked opportunity, updates only lifecycle state,
    preserves concurrent scalar/spouse edits, attributes the existing
    relationship-status audit trigger, and returns committed lead, spouse, and
    activity rows. Hiring remains a single direct call to the existing
    conversion route, including its lost-to-hired guard. The legacy complete
    PATCH contract remains available.
13. **A successful timeline refresh cleared a lead/spouse reread warning.**
    Lead-data and timeline-refresh warnings now have separate state, props, and
    labels. Clearing one warning cannot clear the other.
14. **The atomic field RPC did not fail closed for null field/address input.**
    The SQL allowlist now explicitly rejects a null `p_field`, and the address
    branch rejects SQL/JSON null and non-object values before inspecting keys.
    Route and migration-contract regressions cover both cases.
15. **A missing lead from the partial RPC returned 500.** PostgreSQL `P0002`
    and the canonical `Lead not found` message now map to HTTP 404 while
    converted/hired conflicts remain 409.

## TDD evidence

The remediation was developed from observed failures:

- Atomic route/persistence tranche: **15 expected RED failures**, then
  **71/71 GREEN**.
- Client hydration, committed-write, and refresh-warning tranche:
  **6 expected RED failures**, then the corrected focused regressions passed.
- Timezone/intake/name/actor/duration tranche: **8 expected RED failures**
  among 103 tests, then **103/103 GREEN**.
- Clear-snooze UI: one focused expected RED for the absent menu item, then
  **1/1 GREEN**.
- Final route/persistence/interaction rerun after clear-snooze:
  **126/126 GREEN**.
- Closure-review follow-up: **12 expected RED failures** covering exact
  status-only payloads, status concurrency boundaries, warning separation, SQL
  null guards, and partial-RPC 404 mapping; then **138/138 GREEN** in the
  affected route/persistence/interaction subset.

## Verification

### Focused matrix

The original twelve-file matrix plus the direct-loader tests and all added
regressions passed:

```text
Test Files  13 passed (13)
Tests       221 passed (221)
```

The affected interaction/route/persistence subset passed **138/138**.

### ESLint and whitespace

- Changed TypeScript/TSX files: **0 ESLint errors**.
- The only lint output was 17 pre-existing `no-explicit-any` warnings in the
  lead-detail route test harness.
- `git diff --check`: clean.

### Typecheck

`npm run typecheck` reported only the same six documented diagnostics in three
unchanged test files:

- four readonly-array fixture diagnostics in
  `tests/appointment-availability.test.ts`;
- one incomplete `AppointmentRow` fixture in
  `tests/appointment-booking.test.ts`;
- one `ProcessEnv.NODE_ENV` fixture diagnostic in
  `tests/firma-engagement-poc.test.ts`.

No changed implementation or test file appears in the diagnostics.

### Full repository suite

The final full suite reported:

```text
Test Files  161 passed | 3 failed (164)
Tests       1,442 passed | 6 failed (1,448)
```

The six failures are the exact established baseline:

- `node-estate-generator`: 4
- `estate-clause-parity`: 1
- `drafting-hub`: 1

There was no feature-scope regression.

### Builds

- `npm run build`: passed.
- `npm run build:next`: passed after rerunning outside the filesystem sandbox;
  the first attempt was blocked when `tsx` could not create its IPC socket.

## Boundaries

- `supabase/migrations/20260812000000_lead_atomic_field_updates.sql` is authored
  only; it was not applied locally or to hosted Supabase.
- The existing snooze migration was updated in source but not applied.
- No browser verification was repeated in this remediation wave.
- No package-lock or other dependency file changed.
- No drafting-internal code changed.
- No push or hosted migration was performed.
