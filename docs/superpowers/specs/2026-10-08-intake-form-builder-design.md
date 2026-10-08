# Canonical intake form builder and shared intake experience

**Date:** 2026-10-08

**Status:** approved; Phase 1, Phase 2A persistence, and Phase 2B visual builder implemented and verified locally; controller whole-branch review, Phase 2C activation/pinning, and Phase 3 detailed enhancements remain

**Scope:** architecture and staged delivery for schema-driven intake, an admin form builder, and the detailed intake experience

## Purpose

Cornerstone's intake experience is capable but structurally hard-coded. The
estate and college-preparation tracks define their sections, conditions,
completion rules, validation, and React step components in code. Routine
changes therefore require a code change and deployment, while staff and client
editing still use separate surfaces in important places.

The goal is to let authorized staff create and revise intake forms by composing
only Cornerstone-approved canonical fields and compound blocks. Routine changes
to section order, labels, explanatory text, requiredness, audience, and simple
visibility rules should not require a deployment. A genuinely new legal datum,
persistence mapping, validation rule, or drafting mapping remains a reviewed
code and schema change.

This work is one coordinated initiative delivered in independently releasable
phases:

1. A schema-driven renderer that reproduces the current estate and
   college-preparation intakes without changing their behavior.
2. A versioned administrative builder over the approved catalogs.
3. Detailed client and staff intake enhancements using the shared renderer.

The design does not port drafting code from `aubrey-law-app` and does not alter
Cornerstone's drafting internals. Intake continues to feed canonical data into
the existing intake-to-design-sheet boundary.

## Success criteria

- The current estate and college-preparation questionnaires can be represented
  without track-specific navigation or validation functions in the top-level
  renderer.
- Authorized staff can create a new form by arranging approved catalog entries,
  preview it, and publish an immutable version without deploying code.
- New intakes pin the published form version selected when the intake is
  created. Later edits never silently alter an in-progress or submitted intake.
- Client, public-link, and staff matter views use the same definition and
  renderer, with audience-specific capabilities layered on top.
- Form definitions never become an alternate store for answers and never
  redefine drafting mappings.
- The builder cannot create arbitrary fields, expressions, scripts, database
  columns, or document-generation mappings.
- Existing autosave, review, submit, public-link, intake-track, and
  intake-to-design behavior remains covered by regression tests throughout the
  transition.

## Current system and constraints

### Reusable foundation already present

`packages/estate-fields/src/core/registry.ts` defines a typed shared-field
registry. Its entries own stable IDs, control types, options, normalization,
intake keys, design-sheet keys, and intake-to-design mappings. The builder must
use this registry rather than inventing a parallel field catalog.

`components/intake/GuidedInterview.tsx` already supplies autosave, public-link
support, free section navigation, progress, client and attorney modes, review,
and explicit submission. It currently selects dynamically imported React step
components from hard-coded step IDs.

`lib/intakeSections.ts` and `lib/collegePrepSections.ts` currently own
code-defined section lists, conditions, completion functions, and issue
construction. `components/AdminIntakeSheet.tsx` is a separate staff editing
surface with its own form and submit validation.

Answers already belong to canonical domain records, including
`client_intake`, contacts and matter-contact membership, asset records, and
intake documents. Those stores remain authoritative.

### Constraints

- Drafting is the product center. A form definition may select an approved
  field, but it may not change that field's persistence or drafting meaning.
- A published questionnaire is a legal-workflow artifact. Published versions
  are immutable and auditable.
- Hiding or removing a question must not delete an existing answer.
- Existing intakes must continue working during mixed code/database deployment
  and must not be silently upgraded.
- Public intake tokens and client sessions must never provide builder access or
  expose staff-only definition content.
- Routine copy and layout changes should be no-code, but code review remains
  required for new canonical concepts.

## Chosen architecture

### Two approved catalogs

"Approved canonical field" includes two code-owned catalogs:

1. **Canonical scalar fields.** These extend the existing
   `SHARED_FIELD_REGISTRY`. Each field owns its stable ID, control, options,
   normalization, validation capabilities, persistence adapter, and any
   intake-to-design mapping.
2. **Canonical compound blocks.** A new `INTAKE_BLOCK_REGISTRY` contains
   reviewed components whose data is not a single scalar: children, people and
   matter contacts, fiduciary ranking, asset tables, document uploads, review
   and submit, and attorney-only execution details. Each block owns its data
   loader, persistence behavior, validation capabilities, supported audiences,
   and renderer.

The builder exposes only entries marked `builderEnabled`. Adding an entry to
either catalog is a normal code change with tests. A form definition can arrange
and configure an entry but cannot supply executable code or a storage key.

The catalogs must be complete enough to express both current intake tracks
before the database-backed builder is released. Phase 1 therefore includes a
field audit and adds missing current fields to the appropriate catalog. This is
catalog consolidation, not a change to drafting semantics.

### Declarative form definition

A versioned TypeScript schema, validated at runtime, describes a form:

```ts
interface IntakeFormDefinition {
  schemaVersion: 1
  key: string
  title: string
  description?: string
  sections: IntakeFormSection[]
}

interface IntakeFormSection {
  id: string
  title: string
  subtitle?: string
  timeEstimateMinutes?: number
  audience: 'client_and_staff' | 'staff_only'
  condition?: IntakeCondition
  items: IntakeFormItem[]
}

type IntakeFormItem =
  | {
      kind: 'field'
      id: string
      fieldId: SharedFieldId
      labelOverride?: string
      helpText?: string
      requirement?: 'optional' | 'recommended' | 'required'
      condition?: IntakeCondition
    }
  | {
      kind: 'block'
      id: string
      blockId: IntakeBlockId
      titleOverride?: string
      helpText?: string
      config?: Record<string, unknown>
      condition?: IntakeCondition
    }
```

This illustrates the contract rather than prescribing final filenames. Runtime
validation rejects unknown properties, unknown field or block IDs, duplicate
section/item IDs, unsupported block configuration, cycles, invalid conditions,
and references to fields unavailable earlier in the form.

Builder labels and help text are plain text with documented length limits. V1
does not accept arbitrary HTML or Markdown.

### Conditions

Conditions are a small declarative expression tree, not JavaScript:

```ts
type IntakeCondition =
  | { op: 'equals'; fieldId: SharedFieldId; value: string | boolean }
  | { op: 'not_equals'; fieldId: SharedFieldId; value: string | boolean }
  | { op: 'is_set'; fieldId: SharedFieldId }
  | { op: 'all' | 'any'; conditions: IntakeCondition[] }
```

Values are checked against the referenced field's control and option set at
publish time. V1 has no arbitrary comparisons, formulas, dates, regular
expressions, cross-record queries, or user-authored code.

The renderer evaluates the same condition implementation for navigation,
display, progress, review, and submission. A hidden item is excluded from
form-level completeness and validation, but its stored answer is retained.
Changing a controlling answer never destructively clears hidden data.

### Validation and requiredness

Validation has two layers:

- **Catalog invariants** are code-owned. They cover normalization, allowed
  values, format rules, and core submission requirements. A builder cannot
  weaken or remove them.
- **Form requirements** may strengthen an active field to recommended or
  required. They may not make a catalog-required field optional.

Current semantics are preserved in the first conversion: only the client's
minimum contact fields block submission, while other unanswered or legally
notable questions can appear as warnings for review. Requirement behavior must
be explicit in the catalog rather than inferred from visual labels.

Compound blocks expose named, code-owned validation profiles. The form may
select an allowed profile; it cannot define validation code or database paths.

### Compilation boundary

Raw JSON from the database is never rendered directly. A server-side compiler:

1. Parses the definition with a strict versioned schema.
2. Resolves field and block IDs against the code-owned catalogs.
3. Validates conditions and configuration.
4. Applies immutable catalog requirements.
5. Removes staff-only content for client/public delivery.
6. Returns a typed compiled form to the renderer.

An invalid published definition fails closed: clients see a generic unavailable
message with a support path, staff see a diagnostic naming the invalid form
version, and no fallback silently substitutes a different questionnaire.
Draft preview reports compiler errors inline and cannot publish until they are
resolved.

### Shared renderer

`GuidedInterview` evolves into a shell around a shared form renderer rather
than a map of track-specific step components. The renderer receives:

- the compiled form definition;
- intake answers and canonical record collections;
- actor mode (`client`, `public_link`, or `staff`);
- capabilities such as edit, submit, upload, and view attribution;
- the existing persistence adapters and autosave status.

Audience and capability are independent. A staff-only section is not sent to a
client. A shared section can be editable by a client, editable by staff, or
read-only during review without duplicating its component.

Section status, progress, unanswered flags, review summaries, and submit checks
all derive from the compiled definition and the same validation result. This
prevents sidebar status from disagreeing with review or submission.

### Answer persistence

Form definitions contain presentation and orchestration metadata only. Answers
continue to write through catalog-owned adapters to existing canonical stores:

- scalar intake data to its existing intake or related canonical column;
- people to contacts with matter-scoped membership;
- fiduciary appointments to the existing role model;
- assets to canonical asset records;
- uploads to existing intake-document storage;
- drafting-relevant values through the existing intake-to-design-sheet process.

There is no generic `answers jsonb` escape hatch and no custom-answer table in
this scope. Consequently, every question available in the builder has known
persistence and validation behavior.

Autosave batches changes as it does today. An adapter failure leaves that item
dirty, reports a visible save error, and does not advance it to a saved state.
Submission waits for pending saves and fails if any active answer remains
unsaved.

## Database model and version lifecycle

Phase 1 definitions remain bundled in code. Phase 2 adds two tables:

### `intake_form_templates`

- `id uuid primary key`
- `key text unique not null` — stable programmatic identity
- `name text not null`
- `description text null`
- `archived_at timestamptz null`
- `created_by uuid not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### `intake_form_versions`

- `id uuid primary key`
- `template_id uuid not null references intake_form_templates(id)`
- `version integer not null`
- `status text not null check (status in ('draft', 'published', 'retired'))`
- `definition jsonb not null`
- `definition_hash text not null`
- `lock_version integer not null default 0`
- `created_by uuid not null`
- `published_by uuid null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `published_at timestamptz null`
- unique `(template_id, version)`
- at most one draft per template through a partial unique index

`client_intake` gains a nullable `form_version_id` foreign key. Existing rows
with `NULL` continue to resolve through their bundled estate or college-prep
definition. This makes the migration additive and safe across deployment order.
Phase 2C will select a published version and pin its ID for newly created
intakes. Phase 2A adds the nullable column but leaves all creation paths unset
and current rendering on bundled definitions.

A draft is mutable with compare-and-swap on `lock_version`. Publishing is one
atomic status transition of a compiler-valid draft. A database guard prevents
updates to the definition of published or retired rows. The next edit creates a
new draft copied from the latest published version with the next version
number. Retirement removes a version from selection for new intakes but does
not invalidate pinned intakes.

The application resolves a pinned version by ID, never by "latest". Submitted
intakes cannot change versions. An in-progress intake also remains pinned by
default. A later staff migration tool may offer a diff and explicit upgrade,
but it is not required for the first builder release and must never clear data
for fields absent from the new version.

### Authorization

Both tables have RLS enabled and explicit least-privilege grants in the same
migration. V1 builder authoring, preview, publishing, retirement, and archive
actions require the existing admin authorization boundary. Clients, public
tokens, and ordinary browser requests receive no direct builder-table access.
Client and public forms are resolved server-side and receive only a sanitized,
compiled definition.

The service-role key remains server-only. Policies and grants receive allow and
deny database tests for anonymous, client, attorney, and admin actors. If a
database function is needed for an atomic lifecycle transition, it must not be
a public, broadly executable `SECURITY DEFINER` shortcut; its execution grant,
schema placement, caller authorization, and ownership checks must be explicit.

## Publishing workflow

1. An admin creates a template or opens its single draft.
2. Builder edits save with optimistic concurrency using `lock_version`.
3. Preview compiles the draft and renders both client and staff modes against
   synthetic data. Preview never writes client answers.
4. Publish runs the full compiler, verifies there is at least one section and a
   review/submit path, verifies catalog and condition references, and checks the
   definition hash.
5. Successful publication immutably marks the draft as published and records
   actor and timestamp.
6. New intakes may select the version; existing intakes remain pinned.

If two admins edit the same draft, the second stale save receives a conflict
and must reload or copy its unsaved changes. Last-write-wins is not acceptable
for a form definition.

Templates are archived, not deleted. Published versions referenced by an intake
cannot be deleted. Drafts may be discarded only through an explicit action.

## Detailed intake experience

The detailed enhancements are Phase 3 consumers of the shared contracts rather
than prerequisites bundled into the builder release.

### Unified intake tab

The matter workspace gains an Intake tab using the same compiled definition and
renderer as client and public-link views. Staff capabilities add:

- read-only client-answer review or explicit editing;
- staff-only sections, including execution, notary, and witness details;
- answer attribution where available;
- copy/intake-link management through existing token safeguards;
- unresolved warning and unanswered-item navigation.

`AdminIntakeSheet` is retired only after the shared staff renderer reaches
feature parity and its actions and tests have moved. There is no flag day.

### Shared people

The canonical people block adds a person once, records matter membership, and
lets fiduciary blocks rank/select that matter's people. `+ Add New Contact`
creates a canonical contact and matter membership before selection. A contact
belonging to another matter never appears merely because the underlying person
record is shared.

Child entry remains a reviewed compound block with relationship, adoption,
deceased, disability, disinheritance, and concern/notes capabilities as the
canonical data model permits. Unsupported concepts require a catalog/schema
change rather than being stored in block config.

### Asset tables and estate total

Asset categories use canonical asset-table blocks. Category-specific editors
own their fields and uploads. The running gross-estate total is a derived
read-only presentation from canonical asset records, not another answer. The
Massachusetts estate-tax threshold is displayed with its effective tax year and
comes from a code-owned, reviewed tax configuration rather than builder text.

### Review and submission

Review mode is a capability of the shared renderer. It is read-only, groups
unanswered required/recommended items by section, and links back to the relevant
section. Client submission remains an explicit action, waits for autosave, and
records the pinned version that was submitted.

Hidden answers are retained and are not counted as missing. If a controlling
answer changes and leaves potentially contradictory hidden values, staff review
receives a stale-answer warning rather than silently deleting or ignoring the
data for legal review.

### Answer attribution

Attribution is separate from form definitions. A later additive table records
the latest writer for a canonical answer without duplicating the answer value:

- intake ID;
- canonical field or block-record target;
- source enum (`client`, `staff`, `ai_import`, `system_import`);
- actor user ID when applicable;
- timestamp.

Badges report the last recorded source, not authorship of the underlying fact.
Compound blocks attribute individual records or fields at the granularity their
adapter supports. Historical value-by-value audit logging is outside this
scope; if later required, it needs a separate retention and confidentiality
design.

## Delivery phases

### Phase 1 — catalog and schema-driven renderer

- Audit both current tracks against the scalar and block catalogs.
- Add missing approved catalog entries and declarative validation profiles.
- Define and test the strict form-definition schema and compiler.
- Encode the current estate and college-preparation forms as bundled fixtures.
- Make navigation, progress, review, and submission consume compiled fixtures.
- Move one section/block at a time behind parity tests; preserve the existing
  renderer as a temporary rollback path until both tracks pass.
- Do not add builder tables or an administrative builder UI.

Exit criterion: both current tracks produce equivalent active sections,
validation issues, completion, persistence, review, and submission behavior for
the regression matrix.

### Phase 2 — persistent builder and versioning

- Add template/version tables, the nullable pinned-version foreign key, RLS,
  grants, constraints, and policy tests.
- Build admin template list, section/item composer, condition editor, dual-mode
  preview, conflict handling, publish, retire, duplicate, and archive actions.
- Install the bundled forms as initial published versions through a deterministic
  and idempotent release step; test their definitions against the bundled
  fixtures.
- Pin new intakes to a published version while retaining bundled fallback for
  legacy rows.

Exit criterion: an admin can reproduce and publish both existing form tracks
using only approved catalog entries, and new intakes remain pinned to their
starting version.

Phase 2 ships in three slices: Phase 2A adds the persistence/lifecycle
foundation and dormant resolver; Phase 2B adds the visual builder and preview;
Phase 2C activates persistent selection and pins every intake creation path.
The full Phase 2 exit criterion is not met by Phase 2A alone.

### Phase 3 — detailed intake enhancements

Deliver in small vertical releases rather than one branch:

1. Matter Intake tab and shared staff renderer.
2. Link management, review/unanswered navigation, and explicit submit polish.
3. Shared people, child, and fiduciary workflows.
4. Canonical asset tables, deed/document uploads, gross-estate total, and
   tax-threshold context.
5. Answer attribution and source badges.

Each release uses the catalogs and compiled definition. A feature that needs a
new legal datum first adds and tests that canonical entry; it does not add a
builder-only field.

## Testing strategy

### Definition and compiler tests

- Accept valid estate and college-preparation fixtures.
- Reject unknown fields, blocks, config keys, and schema versions.
- Reject duplicate IDs, invalid option values, cycles, and forward condition
  references.
- Verify staff-only content is absent from client/public compiled output.
- Verify builder requirements cannot weaken catalog invariants.
- Snapshot compiled fixtures so catalog changes are intentional.

### Behavioral parity tests

Use representative rows for single, married, children, minor children, legacy
options, college-preparation, public-token, submitted, and attorney modes.
Compare old and new active sections, issues, completion, progress, persistence,
review, and submit eligibility until the rollback renderer is removed.

### Persistence tests

- Scalar and block adapters write only their canonical stores.
- Autosave errors remain visible and block submission until resolved.
- Hiding an item retains its stored value.
- Contact selection stays matter-scoped.
- Drafting seed/resync behavior is unchanged for the same canonical answers.

### Builder and version tests

- Stale draft updates fail compare-and-swap.
- Published definitions cannot be mutated.
- New intakes pin the current published version.
- Publishing a later version does not change existing intakes.
- Retiring or archiving a form does not break pinned intakes.
- Invalid drafts cannot publish.

### Authorization tests

Database tests cover positive and negative access for anonymous, client,
attorney, and admin actors across select, insert, update, and delete. Application
tests verify public tokens receive sanitized compiled forms and can affect only
their intended intake through existing token rules.

### Acceptance tests

- Rebuild the current estate form in the builder without application code.
- Rebuild the college-preparation form without application code.
- Start an intake on version 1, publish version 2, and demonstrate that the
  first intake remains on version 1 while a new intake receives version 2.
- Complete and submit through client, public-link, and staff modes with the same
  definition.
- Open a matter's Intake tab and verify its answers, section status, warnings,
  people, assets, uploads, and submission state match the client experience.

Standard repository lint, typecheck, and test baselines apply. Any drifting
pre-existing failures must be distinguished from regressions with a clean
checkout comparison.

## Rollout and recovery

- Phase 1 ships with bundled definitions and a temporary path to the old
  renderer. No database dependency is introduced.
- Phase 2 schema is additive. `form_version_id` is nullable, and legacy rows use
  bundled definitions, so code and migration can deploy in either order.
- Database-backed form selection can be disabled while bundled definitions
  remain available for legacy and recovery use.
- New published versions are rolled back by retiring them and selecting a prior
  published version for future intakes; pinned intakes do not move.
- No rollback deletes answers, contacts, assets, uploads, templates, or versions.
- `AdminIntakeSheet` remains until shared staff-renderer parity is verified in
  production and is removed in a later cleanup release.

## Explicitly out of scope

- Arbitrary or custom questions.
- Generic custom-answer JSON storage.
- User-authored scripts, formulas, regular expressions, or SQL.
- Builder-controlled database keys, drafting keys, document-template mappings,
  AI prompts, or legal clauses.
- AI-generated and automatically published forms.
- Changing drafting internals or estate document generation.
- Automatically migrating existing in-progress or submitted intakes.
- Full historical answer-value audit logging.
- A public marketplace or cross-firm form sharing.

## Decisions recorded

- Only approved canonical fields and approved canonical compound blocks are
  available in the builder.
- The renderer foundation, builder, and detailed enhancements share one
  architecture but ship in separate phases.
- Form configuration can strengthen but not weaken code-owned legal and
  submission invariants.
- Published versions are immutable; every intake is pinned.
- Answers remain in canonical domain stores, not in form-definition JSON.
- Hidden questions retain their data.
- Client/public delivery is server-compiled and excludes staff-only content.
- Phase 1 implemented the catalog, bundled definitions, compiler/evaluator,
  shared renderer, compatibility selectors, and explicit legacy rollback mode.
  The Phase 2A persistence foundation is also implemented in this branch; its
  verification record follows the Phase 1 record below. Phase 2B's visual builder,
  Phase 2C's runtime activation and intake pinning, and Phase 3 are not included.

## Phase 1 verification record — 2026-10-08

The estate and college-preparation bundled definitions compile. Automated
old/new parity compares ordered active and required sections, completion,
issue messages/severity/submission blocking, progress, and submission errors.
The historical-answer policy preserves presence-only validation for the exact
legacy select questions that never checked option membership; county, marital
status, estate value, missing required questions, and approved retired-value
handling keep their existing validation. Definitions still reject unapproved
condition values and cannot configure this catalog policy.

Verification commands use Node 24.20.0:

```sh
npx vitest run tests/intake-*.test.ts tests/intake-*.test.tsx tests/college-prep-intake.test.ts tests/lead-intake-progress.test.ts tests/lead-intake-contact-progress.test.ts tests/public-intake-start-form.test.tsx tests/admin-intake-sheet-form.test.tsx
npm run lint
npm run typecheck
npm test
git diff --check origin/main...HEAD
```

The intake-focused run passed 43 files / 502 tests. Lint, typecheck,
touched-file lint, and diff checks passed. The full run passed 893 files /
9,565 tests (22 skipped) with only the two established sandbox loopback-listener
failures in `db-columns-check` and `db-rpc-check` (`listen EPERM 127.0.0.1`).
Both suites passed separately with approved local-listener permission: 2 files /
21 tests. No new failing test was observed.

Manual compiled-mode browser acceptance was completed against fresh local
Supabase fixtures at `127.0.0.1:3002`. For the estate track, changing marital
status hid and restored the spouse sections, retained a spouse answer while the
section was hidden, persisted that answer across refresh, produced the expected
review issues, and completed client submission. For the college-preparation
track, no estate sections appeared; FERPA and HIPAA dependent questions showed
and hid from their canonical answers, the HIPAA selections persisted across
refresh, the college-specific review summary appeared, and client submission
completed. The submitted college intake also produced the expected review flags
in the attorney matter workflow.

The acceptance pass exposed a missing accessible description on the shared
review dialog. A focused regression test reproduced the Radix accessibility
warning, and the dialog now supplies a semantic description for assistive
technology. This was the only intake-specific browser warning found. Follow-up
verification passed the focused accessibility test, lint, typecheck, and the
full suite (900 files / 9,717 tests passed; 2 files / 15 tests skipped).

These checks verify the local compiled renderer, not a production deployment or
a production mode change. The server flag retains legacy as its default and
rollback mode.

At the Phase 1 verification boundary, the Phase 2 database/UI and Phase 3
enhancements remained unimplemented. The subsequent Phase 2A evidence follows.

## Phase 2A foundation verification record — 2026-10-08

Phase 2A implements `intake_form_templates`, immutable published/retired
`intake_form_versions`, and nullable `client_intake.form_version_id` in
`20270130090001_intake_form_builder_foundation.sql`. Seven lifecycle RPCs and
table CRUD are service-role-only; the RPCs verify an explicit administrator
actor, use empty search paths, and enforce optimistic locks and publication
immutability. The server repository strictly parses stored definitions and
verifies deterministic hashes. Administrator-only lifecycle APIs permit
structurally valid drafts with compiler diagnostics but reject publication
until both audiences compile without diagnostics.

The deterministic bundled installer defaults to dry-run, requires explicit
`--apply --actor-id` for writes, and refuses known drift before any mutation.
The dormant resolver uses bundled fallback only for a literal null pin; a
non-null pin selects its exact published/retired version, validates its
owning-template identity and definition/hash, compiles the requested audience,
and fails closed on an unavailable or invalid version. Client output excludes
staff-only content.

Current intake creation and rendering still use bundled definitions and do
not set `form_version_id`. Source checks found no runtime resolver import or
call and no pin write in `app`, `components`, `lib`, or `hooks`; the automated
dormancy guard covers those runtime directories. `INTAKE_RENDERER_MODE` retains
its existing default and rollback behavior. No drafting internals,
design-sheet generation, estate generator, or `AdminIntakeSheet` changed.

Verification used Node 26.7.0 and pinned Supabase CLI 2.114.0:

```sh
npx vitest run tests/intake-form-*.test.ts tests/intake-form-*.test.tsx tests/intake-rollback-entry.test.tsx
npm run lint
npm run typecheck
npm test
npm run check:db-types
git diff --check origin/main...HEAD
```

The focused source run passed 14 files / 401 tests, with six opt-in database
tests skipped. After isolated replay and repository seed grants, the complete
focused command with `VITEST_INTAKE_FORM_TEST_DB_URL` targeting only the
disposable database passed all 14 files / 407 tests, with no skips. These
database tests exercise positive service-role lifecycle operations, negative
actor/table/RPC permissions, stale locks/hashes, immutable published/retired
rows, one-draft uniqueness, and pinned foreign-key behavior. No accessibility
or compiler warning was observed; Node emitted its established
`module.register()` deprecation and unavailable-localStorage runtime warnings.
Lint, typecheck, generated-type checks, and branch/working diff checks passed.

The full suite exited 1: 898 files / 9,889 tests passed, 8 files / 77 tests
failed, and 2 files / 21 tests skipped. All 77 failing file/test names exactly
match the pre-Task-7 baseline; no failure was added or removed. They are the
existing unavailable-localStorage failures under unsupported Node 26 (the
package requires Node `>=22 <26`). The approved run had no filesystem or
loopback-listener `EPERM` failures. This is baseline-only failure evidence,
not a claim that the full repository suite is green on a supported runtime.

After review, the controller reran the final full `npm test` under supported
Node 22.22.2. It passed cleanly with 906 files passed and 2 skipped, 9,966 tests
passed and 21 skipped, and exit code 0. The Node 26 result above remains
historical, environment-specific baseline evidence. This supported-runtime
result verifies the local suite; it does not establish deployment or runtime
activation.

Database verification used only disposable project
`intake-form-foundation-phase2a` at
`/private/tmp/intake-form-foundation.rXIikw`, with API `127.0.0.1:55421` and
database `127.0.0.1:55422`:

```sh
npx supabase db reset --local --workdir /private/tmp/intake-form-foundation.rXIikw --no-seed
psql -X --no-password --set ON_ERROR_STOP=1 postgresql://postgres:postgres@127.0.0.1:55422/postgres --file supabase/seed.sql
npx supabase migration list --local --workdir /private/tmp/intake-form-foundation.rXIikw
npm run intake:forms:install -- --dry-run
npm run intake:forms:install -- --apply --actor-id 10000000-0000-4000-8000-000000000001
npm run intake:forms:install -- --apply --actor-id 10000000-0000-4000-8000-000000000001
```

The installer commands received local credentials privately from validated
disposable-project status; no credentials were printed. A synthetic local
administrator was seeded after the transactional database tests. Full replay
completed with all 289 migration entries aligned through `20270130090001` and
the superseded timestamp absent. Dry-run selected two creates; first apply
created exactly two published version-1 rows; second apply reported two
no-ops. Catalog queries confirmed two templates, two versions, no drafts,
enabled RLS, no `anon`/`authenticated` table or lifecycle execution privileges,
service-role CRUD/execute only (no TRUNCATE/REFERENCES/TRIGGER), empty RPC search
paths, and the nullable noncascading pin foreign key. A direct service-role
definition update of an installed publication was rejected inside a rolled-back
transaction. Estate and college hashes matched their committed snapshots.

The installer preflight and separate lifecycle RPCs are not one transaction
spanning both bundles. A mid-run operational failure can leave a draft that
requires explicit review. Concurrent competing database sessions were not
stress-tested. This verification does not add a live resolver caller, browser
builder acceptance, or production acceptance.

The visual composer, template/preview UI, production bundled installation,
persistent runtime activation and intake pinning, all Phase 3 work (including
the staff matter Intake tab), and drafting changes remain outside this slice.
Migration deployment is separately authorized and was not performed. No linked
reset, seed, push/apply, repair, or deployment occurred during this verification.
Task 1's read-only linked dry-run selected exactly
`20270130090001_intake_form_builder_foundation.sql`, with no seeds or roles;
that earlier observation was not refreshed here. Merging migration changes to
`main` triggers the repository's migration deployment workflow, so that merge
also requires the separately authorized deployment/reconciliation path.

## Phase 2B local verification record — 2026-10-08

Implemented the administrator-only list, visual editor, synthetic preview,
optimistic-lock recovery, lifecycle history, and transactional audit log.
The final accessibility pass added selected-node semantics and stable,
contextual drag/move names when editable labels repeat. It did not change
ordering behavior or visible editable copy.

All commands used Node **24.20.0** from
`/Users/scottaubrey/.nvm/versions/node/v24.20.0/bin`:

```sh
VITEST_INTAKE_FORM_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:55422/postgres npx vitest run tests/intake-form-builder-schema.test.ts tests/intake-form-admin-service.test.ts tests/intake-form-admin-routes.test.ts tests/intake-form-builder-catalog.test.ts tests/intake-form-editor-state.test.ts tests/intake-form-preview-scenarios.test.ts tests/settings-nav.test.ts tests/intake-form-builder-pages.test.tsx tests/intake-form-builder-list.test.tsx tests/intake-form-builder-editor.test.tsx tests/intake-form-builder-save.test.tsx tests/intake-form-builder-lifecycle.test.tsx tests/intake-form-builder-preview.test.tsx tests/intake-compiled-sections.test.tsx tests/intake-form-legacy-parity.test.ts
npm run lint
npm run typecheck
npm test
git diff --check origin/main...HEAD
git diff --check
```

The exact focused suite passed **15 files / 421 tests**, including real local
database tests, with no accessibility warning. Lint and typecheck exited 0.
The full suite exited 0: **916 files passed, 2 skipped; 10,151 tests passed,
26 skipped** (266.84 seconds). It emitted seven jsdom
`Not implemented: navigation to another Document` notices, with no failed
tests. Both diff checks passed. No failure was classified as pre-existing;
a clean-baseline failure comparison was therefore not needed.
The compared `origin/main` SHA was
`718f5089e6bfd2a2319fa9e1015007ca38bcea88`.

The five Review Focus cases were rerun in their owning suites: stale save and
publish recovery; saving a structurally valid missing-review draft while
publication remains blocked; retaining a moved condition and focusing its
diagnostic target; zero preview network/auth writes, including disabled
compound controls; and exactly one surviving actor/time/version discard audit
event after the draft row is deleted.

### Local database and browser acceptance

Only disposable project `intake-form-foundation-phase2a` was used:
API `http://127.0.0.1:55421`, database `127.0.0.1:55422`.

```sh
SUPABASE_AUTH_SITE_URL=http://localhost:3002 npx supabase db reset --db-url 'postgresql://postgres:postgres@127.0.0.1:55422/postgres?sslmode=disable' --yes
npm run seed:browser-fixture
npm run dev
```

Reset, fixture seed, and development-server startup succeeded. The local
database contains **290 migrations through 20270130090002**, including the
audit migration. The reset removed only reproducible disposable fixture data.
The CLI's generic explicit-URL output calls this target “remote”; its actual
address was loopback. No `--linked` operation was used.

Actual Chrome acceptance passed at **1440×1000** and **390×1000**, with only
the documented local fixture accounts. The attorney fixture was temporarily
made an administrator for builder acceptance, then restored to attorney for
fresh non-admin sign-ins. Temporary intake-track and standing-link fixture
changes were restored after smoke checks.

At both widths, acceptance covered blank creation, approved fields/blocks,
real pointer drag and move-button reordering, incomplete-draft save and
blocked publication, diagnostic repair, Married/Family conditional preview,
client/staff preview, disabled answer controls and zero preview writes,
save/publish, immutable published state, and creation of the next draft.
Two browser sessions demonstrated HTTP 409 conflict, retained local edits,
valid local JSON export, and confirmed reload of the winning definition.
Duplicate, retire, archive, restore, and discard all passed with live version
and audit queries. Catalog/dialog focus return, cancelled dirty navigation,
native beforeunload dismissal, and narrow inline inspector placement passed;
narrow build/preview screenshots were visually inspected without document
horizontal overflow.

Exact successful editor URLs:

- `http://127.0.0.1:3002/admin/settings/intake-forms/fa5ece71-9cd4-44de-8e9d-0cefc3f4183b` (desktop).
- `http://127.0.0.1:3002/admin/settings/intake-forms/f602c0bc-621f-4931-8739-dbd6d8801f2e` (narrow).
- `http://127.0.0.1:3002/admin/settings/intake-forms` (list and creation).

Each original template had exactly ten successful lifecycle events, plus one
event on its independent duplicate. Only retired version 1 remained on each
original. Each discarded version 2 retained exactly one event with actor
`303720e7-a784-4516-b729-d6b858d7b179`, version number 2, and a null
version foreign key. Discard timestamps were
`2026-10-08 22:11:09.339056+00` (desktop) and
`2026-10-08 22:12:05.872671+00` (narrow).

At both widths, fresh attorney sessions saw the custom not-found page on both
builder routes. List/detail GET, create POST, and metadata PATCH returned
403. Existing estate and college client, public-invitation, and staff intake
smoke checks passed, as did clicking the existing Drafting entry:

- `http://127.0.0.1:3002/intake`.
- `http://127.0.0.1:3002/intake/auth?invite=<local-fixture-token>`.
  This registered-account fixture correctly showed “Continue your intake”
  and the sign-in link; no anonymous questionnaire completion is claimed.
  The full ephemeral URL is retained only in local acceptance evidence.
- `http://127.0.0.1:3002/admin/crm/opportunities/170d0332-63bb-4328-8802-86f706ea8803?tab=intake`.
- `http://127.0.0.1:3002/admin/drafting/26aa73dd-3954-43dc-890e-d8ce9906afe4`.
  The existing Quick draft entry was visible; drafting internals were not edited.

Before and after builder/preview and final smoke, `client_intake` contained
exactly `060369b8-45e6-4753-a402-29a56a8cb43b` and
`170d0332-63bb-4328-8802-86f706ea8803`, both with
`form_version_id = null`. No intake was created or repinned.

Observed console notices were unused local font/CSS preloads, a favicon
aspect-ratio warning, and a loopback realtime WebSocket handshake returning
503 on matter/drafting surfaces. The server also logged the optional local
Google Calendar connection as unavailable. No uncaught page error occurred;
these notices did not prevent the required assertions. They are recorded as
observations, not asserted to be proven pre-existing defects. Early harness
selectors and pre-hydration navigation timing were corrected before the
successful acceptance runs.

Local evidence is retained at
`/private/tmp/intake-phase2b-task9-browser-evidence.json`,
`/private/tmp/intake-phase2b-task9-guards-evidence.json`, and
`/private/tmp/intake-phase2b-task9-smoke-evidence.json`.
The complete full-suite log is
`/private/tmp/intake-phase2b-task9-final-full-test.log`.

### Remaining release boundaries

Whole-branch review (Task 9 Step 6) is pending with the controller after the
Task 9 implementation/review handoff. Phase 2C runtime activation and intake
pinning, Phase 3 detailed intake enhancements, production bundled-form
installation, and all drafting changes remain excluded. No push, pull
request, linked migration deployment, shared-database mutation, or
authenticated production QA was performed or is claimed by this record.
