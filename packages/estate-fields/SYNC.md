# Syncing `@aubrey-law/estate-fields` across repos

## Source of truth

**This repository owns the package.** It lives at `packages/estate-fields/` in
`cornerstone-drafting` and is a workspace member here. Field registry changes
land here first and propagate outward.

This reverses the earlier arrangement, in which `aubrey-law-app` held the
original and this repo carried a mirror kept in step by hand. That was the weak
point: two writable copies of the same vocabulary, no version boundary between
them, and a reconciliation step that only ran when somebody remembered. Owner
decision, 2026-09-02; scope-reduction plan task 8.5.3.

## Workflow

1. Edit registry/options/normalize in `packages/estate-fields/src/core/`.
2. Run the guards in this repo: `npm test -- shared-fields citizenship-status design-sheet-seed-from-intake`.
3. Smoke-test the design sheet sections that use `DesignField` or shared options.
4. Bump `version` in `packages/estate-fields/package.json` for anything a
   consumer can observe — a new field, a renamed `SharedFieldId`, a changed
   option `value`. The version is the only signal another app gets.

No `npm install` step is needed for this repo: the workspace link means an edit
is live immediately.

## Consuming it from another application

The retired arrangement pointed a sibling checkout at a relative path
(`file:../aubrey-law-app/packages/estate-fields`). Do not reintroduce that in
either direction. It requires both repos to sit side by side on one disk, which
is true on a developer laptop and false in CI and on Vercel.

Publish outward instead, as a versioned private package:

| Approach | When |
|----------|------|
| Private npm registry, `@aubrey-law/estate-fields@x.y.z` | The intended path. Survives CI and deploy with no sibling checkout. |
| Git dependency pinned to a tag | Acceptable interim if no registry is set up. Pin a tag, never a branch. |
| Relative `file:` path across repos | **Retired.** Breaks anywhere the two repos are not siblings. |

**Outstanding:** `aubrey-law-app` still holds its own copy and still needs to be
pointed at this one. That change belongs in that repository and is not done.
Until it is, the two copies can still drift — the ownership question is settled,
the mechanism is not.

## Portal-only vs shared

| Module | Package path | Cornerstone |
|--------|--------------|-------------|
| Registry, options, assets, goals, fiduciaries | `core/` | Import |
| Intake validation (`validateIntakeField`) | `portal/` | Import — `lib/intakeSections.ts` validates client steps with it |
| `DesignField` / `IntakeField` | `react/` | Both — `IntakeField` renders `estate_value`, pronouns and marital status in the wizard |
| `citizenshipFromHousehold` | Consuming app | N/A here (no intake sync) |

## Cornerstone Lite intake seed

`lib/designSheet/seedFromIntake.ts` maps intake columns to design keys via
`syncFieldToDesign`, `syncGoalsNotesFromIntake`, and `syncConcernsFromIntake`,
and `lib/designSheet/buildInitialSheet.ts` derives its override-tracking set
from `SHARED_PREFILLED_DESIGN_KEYS`. Fiduciary slot arrays are seeded from
`contact_roles` via `lib/contacts/intakeFiduciarySnapshot.ts`. CI guard:
`tests/design-sheet-seed-from-intake.test.ts` (`covers registry prefilled
design keys`).

## Breaking changes

If you rename a `SharedFieldId` or change option `value` strings:

1. Add a normalize alias in `core/normalize.ts` for legacy DB values.
2. Update any Supabase seed/migration only if storage vocabulary changes.
3. Bump the package version and tell the consuming app what changed.

## Still open

Scope-reduction task **8.5.4** asks a separate question this decision does not
answer: whether the registry should be genuinely canonical — driving schema, UI,
persistence, validation and payload generation — or removed. Ten files import it
today. A registry that does not drive those things is one more representation
rather than a solution. Ownership is now unambiguous; whether the thing owned
earns its keep is undecided.
