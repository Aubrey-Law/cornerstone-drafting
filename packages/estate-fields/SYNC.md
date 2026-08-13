# Syncing `@aubrey-law/estate-fields` across repos

## Source of truth

The package lives at `aubrey-law-app/packages/estate-fields/`. Field registry changes land here first, then both apps pick them up via the local `file:` dependency.

## Workflow

1. Edit registry/options/normalize in `packages/estate-fields/src/core/`.
2. Run portal tests: `npm test -- shared-fields` from `aubrey-law-app`.
3. In cornerstone-drafting: `npm install` (refreshes the linked package).
4. Smoke-test design sheet sections that use `DesignField` or shared options.

## Long-term options

| Approach | When |
|----------|------|
| `file:../aubrey-law-app/packages/estate-fields` | Local dev (current) |
| Git submodule at same path | Separate cornerstone clone without monorepo |
| Private npm (`@aubrey-law/estate-fields`) | CI/deploy without sibling checkout |

## Portal-only vs shared

| Module | Package path | Cornerstone |
|--------|--------------|-------------|
| Registry, options, assets, goals, fiduciaries | `core/` | Import |
| Intake validation (`validateIntakeField`) | `portal/` | Import — `lib/intakeSections.ts` validates client steps with it |
| `DesignField` / `IntakeField` | `react/` | Both — `IntakeField` renders `estate_value`, pronouns and marital status in the wizard |
| `citizenshipFromHousehold` | App `lib/sharedFields/syncPortal.ts` | N/A (no intake sync) |

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
3. Run CI guards in portal (`tests/shared-fields.test.ts`).
