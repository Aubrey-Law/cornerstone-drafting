# Task 1 Report: Guided Navigation Helpers

Status: DONE

Commit: `4e6fa20` (`Add guided design sheet navigation helpers`)

## Implementation

- Added `groupGuidedSections`, which classifies sections into attention, remaining, and complete groups while retaining the input catalog order within each group.
- Added `findNextUnresolvedBlocker`, which selects the blocker after the active section and wraps to the first blocker.
- Added focused tests for stable grouping order and blocker navigation wraparound.

## TDD Evidence

1. RED: `npm test -- tests/design-sheet-guided-navigation.test.ts` failed because `@/lib/designSheet/guidedNavigation` did not exist.
2. GREEN: the same focused command passed after the minimal implementation.
3. Final verification: `npm test -- tests/design-sheet-guided-navigation.test.ts` passed with 1 test file and 2 tests passing.

## Scope

The commit contains only:

- `lib/designSheet/guidedNavigation.ts`
- `tests/design-sheet-guided-navigation.test.ts`

No schema, drafting payload, clause, generator, or legal-default files were changed.

## Concerns

None affecting Task 1. The test runner emits the existing Node `DEP0205` deprecation warning for `module.register()`.

## Review Fix: Multiple Active-Section Blockers

- Updated `findNextUnresolvedBlocker` to skip all blockers belonging to the active section and return the first blocker from a different section; if no other section has a blocker, it wraps to the first blocker.
- Added a regression test with two blockers in the active section plus a blocker in another section, including wraparound back to the first blocker.
- RED command: `npm test -- tests/design-sheet-guided-navigation.test.ts` — 1 failed, 2 passed; expected `trust:name`, received `client:address`.
- GREEN/final command: `npm test -- tests/design-sheet-guided-navigation.test.ts` — 1 test file passed, 3 tests passed, exit code 0. The existing Node `DEP0205` deprecation warning remains.
