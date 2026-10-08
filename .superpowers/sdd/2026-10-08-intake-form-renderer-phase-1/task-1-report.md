# Task 1 report: legacy intake parity matrix

## Implementation

Added the reusable fixture contract and eight representative legacy intake cases in `tests/fixtures/intakeFormParity.ts`. The cases cover blank and contact-only estate rows, married/minor-child estate intake, the legacy `under_1m` value, complete estate intake, and blank, under-eighteen, and complete college-prep intake. Added `captureLegacyIntakeResult` with the requested active/required IDs, completion flags, normalized issue details, and submission errors.

Added `tests/intake-form-legacy-parity.test.ts` with fixed assertions for conditional spouse and spouse-fiduciary/guardian visibility, track isolation, optional-step exclusion, contact-only submission, and the college under-eighteen warning. Every fixture is also evaluated by the capture helper and checked for internally consistent active/required/completion/issue IDs.

## RED and GREEN evidence

- RED: Before creating the test, `PATH="/Users/scottaubrey/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run tests/intake-form-legacy-parity.test.ts` exited 1 with `No test files found` for the requested new test path.
- GREEN: After implementation, the same command passed: 1 test file, 13 tests passed.
- `git diff --check` passed during self-review.

## Files changed

- `tests/fixtures/intakeFormParity.ts`
- `tests/intake-form-legacy-parity.test.ts`
- `.superpowers/sdd/2026-10-08-intake-form-renderer-phase-1/task-1-report.md` (this report)

## Self-review

Confirmed the required named exports and the fixture values match the brief. Assertions inspect behavior directly rather than relying on serialized snapshots. The test uses only the existing legacy section APIs and does not modify production code.

## Concerns

No blocking concerns. The under-eighteen fixture uses a fixed 2010 birth date, which remains below 18 for the current 2026 baseline; it is intentionally a characterization case rather than a boundary-date test.

## Round 1 fixes

Added negative visibility assertions confirming the contact-only estate case excludes `spouse_fiduciaries` and `children`, alongside the existing spouse and guardian exclusions. The under-eighteen test now freezes the clock at `2026-10-08T12:00:00` and restores real timers after every test, so its result no longer changes with the date the suite runs.

Coverage evidence: the fixed assertions now check both sides of each relevant estate visibility condition: the married/minor-child case includes spouse, spouse fiduciaries, children, and guardian; the contact-only case excludes all four. The under-eighteen check is evaluated against the explicit 2026 characterization date.

Test command and output:

```text
PATH="/Users/scottaubrey/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run tests/intake-form-legacy-parity.test.ts

Test Files  1 passed (1)
Tests       13 passed (13)
```

`git diff --check` also passed. No outstanding concerns remain.
