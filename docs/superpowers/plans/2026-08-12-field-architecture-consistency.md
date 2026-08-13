# Field Architecture Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make legally material fields consistent from Postgres through document generation while preserving existing data and migration provenance.

**Architecture:** Add explicit matter-participation and citizenship owners, route every consumer through canonical normalizers, and make unresolved legal facts fail visibly rather than being inferred. Introduce generated Supabase types and read-only reconciliation tooling, while leaving destructive legacy-column removal for a later audited migration.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, Supabase/Postgres, Vitest.

## Global Constraints

- Do not reset or write to the linked production database.
- Do not infer participant count from marital status.
- Do not fabricate citizenship or pronouns.
- Migrations are additive; legacy status columns are not dropped.
- Every production behavior change follows a failing-test then passing-test cycle.

---

### Task 1: Matter participation owner

**Files:**
- Create: `supabase/migrations/<generated>_matter_type_and_citizenship_status.sql`
- Create: `app/api/admin/matters/[id]/matter-type/route.ts`
- Modify: `types/database.ts`
- Modify: `types/matter-details.ts`
- Modify: `lib/matter/matterType.ts`
- Modify: `lib/queries/matterCore.ts`
- Modify: `lib/draftPayload/types.ts`
- Modify: `lib/draftPayload/assemble.ts`
- Modify: `app/admin/matters/[id]/page.tsx`
- Modify: `app/admin/matters/[id]/MatterDetailClient.tsx`
- Modify: `app/admin/matters/[id]/facts-panel/MatterFactsPanel.tsx`
- Test: `tests/build-draft-payload.test.ts`
- Test: `tests/matter-page-schema-coverage.test.ts`

**Interfaces:**
- Produces: `MatterType = 'individual' | 'couple'` stored on `matters.matter_type`.
- Produces: `resolveDraftComposition(matterType, isJoint)` returning existing generator tokens.

- [x] Write a payload test where a married client with `matter_type=individual` produces `individual`, and an unmarried client with `matter_type=couple` produces a couple composition.
- [x] Run the focused test and confirm it fails because the matter query/derivation ignores `matter_type`.
- [x] Generate the migration with `supabase migration new`; add the nullable constrained column and preserve the existing table grant model.
- [x] Add the dedicated admin route and update the matter page state/field control.
- [x] Update draft assembly to require/use `matter_type` and remove its marital-status participation branch.
- [x] Run the focused tests until green.

### Task 2: Citizenship status and unknown-safe defaults

**Files:**
- Modify: migration from Task 1
- Create: `packages/estate-fields/src/core/citizenship.ts`
- Modify: `packages/estate-fields/src/core/options.ts`
- Modify: `packages/estate-fields/src/core/normalize.ts`
- Modify: `packages/estate-fields/src/core/registry.ts`
- Modify: intake/contact persistence and hydration modules that currently read `is_us_citizen`
- Modify: `lib/designSheet/seedFromIntake.ts`
- Modify: `lib/designSheetDefaults.ts`
- Test: `tests/intake-pronouns.test.ts`
- Test: `tests/design-sheet-seed-from-intake.test.ts`

**Interfaces:**
- Produces: `CitizenshipStatus` and `citizenshipStatusFromLegacyBoolean`.
- Produces: `citizenshipDesignLabel` and `citizenshipStatusFromDesignLabel`.

- [x] Add literal table tests for true, false, null, permanent resident, nonresident alien, and unknown.
- [x] Run them and confirm false/unknown cases fail under the existing boolean normalizer.
- [x] Implement canonical conversions and additive status columns with conservative backfill.
- [x] Replace citizenship defaults with null/unknown preservation and prefer status columns during seeding.
- [x] Update intake/admin controls and persistence to round-trip the status while retaining compatibility reads.
- [x] Run focused intake, seed, and drafting tests until green.

### Task 3: Remove generated pronoun assumptions

**Files:**
- Modify: `lib/drafting/projectDesignSheet.ts`
- Modify: preflight mapping only if an existing required variable does not surface the missing value
- Test: `tests/project-design-sheet.test.ts`
- Test: `tests/draft-preflight.test.ts`

**Interfaces:**
- Produces: projected pronoun strings that are empty/missing when the source is unknown.

- [x] Add tests proving missing client and spouse pronouns do not become gendered values.
- [x] Run and observe failures containing the current `he/him` or `she/her` defaults.
- [x] Remove the defaults; existing missing-variable handling remains authoritative.
- [x] Run projection, preflight, and generator tests until green.

### Task 4: Canonical options and dormant lead cleanup

**Files:**
- Modify: `lib/leads/fieldDefinitions.ts`
- Modify: `app/admin/matters/[id]/facts-panel/MatterFactsPanel.tsx`
- Modify: `lib/intakeImport/leadIntakeImport.ts`
- Test: `tests/lite-intake-import.test.ts`
- Test: matter facts tests

**Interfaces:**
- Consumes: `MARITAL_STATUS_OPTIONS` and `estateValueMidpoint` from estate-fields.

- [x] Add behavior tests that canonical marital values and estate ranges remain available.
- [x] Run and confirm the local option array and dormant lead writer diverge from the canonical model.
- [x] Import canonical options and retain the canonical midpoint conversion.
- [x] Remove every exported path that calls `.from('leads')`.
- [x] Run focused tests until green.

### Task 5: Generated Supabase types and drift gate

**Files:**
- Replace: `types/supabase.ts`
- Modify: `package.json`
- Create: `scripts/checkSupabaseTypes.mjs`
- Test: `tests/supabase-types-drift.test.ts`

**Interfaces:**
- Produces: generated `Database` type used by every Supabase client.
- Produces: `npm run db:types` and `npm run check:db-types`.

- [x] Add a test that fails when the checked-in generated file contains the permissive `AnyTable` placeholder.
- [ ] Replay migrations locally (blocked here because Docker is unavailable); refresh linked types only after the migration is deployed.
- [x] Add deterministic atomic generation/drift commands without exposing credentials.
- [ ] Migrate historical clients from the compatibility adapter to `GeneratedDatabase` table by table; the new field-owner route is strict now.
- [x] Run typecheck and the drift test until green.

### Task 6: Reconciliation and lifecycle deprecation

**Files:**
- Create: `scripts/reconcileFieldConsistency.ts`
- Modify: `package.json`
- Modify: canonical matter query types/readers that still prefer `matter_details.matter_status` or `client_status`
- Test: `tests/field-consistency-reconciliation.test.ts`

**Interfaces:**
- Produces: a read-only report with `matterId`, `field`, `sourceValue`, `designValue`, and `hasOverride`.

- [x] Add fixture-driven tests for matching, overridden, and unexplained differences.
- [x] Implement pure comparison logic, then a read-only Supabase adapter.
- [x] Keep new field-owner code off legacy lifecycle shadows; retain the legal-plan `client_status` field pending a separately named migration.
- [x] Run the reconciliation test and confirm the script performs no writes.

### Task 7: Verification and handoff

- [x] Run all focused field, payload, migration, and reconciliation tests.
- [x] Run `npm run typecheck` and `npm run lint`.
- [x] Run the complete Vitest suite and distinguish the four clean-main template-reference failures and transient worker timeouts from regressions.
- [ ] Run linked migration drift and local migration replay/type generation (blocked here by missing credentials and Docker).
- [x] Inspect `git diff`, confirm no unrelated files or generated secrets, and report the migration/deployment steps that still require explicit authorization.
