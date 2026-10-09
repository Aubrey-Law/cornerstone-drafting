# Intake form builder Phase 2C: activation readiness and next steps

Date: 2026-10-09

## Current status

Local HEAD includes Phase 2A (#757, `718f5089`) and Phase 2B (#760,
`155208ba`). The administrator builder is implemented at
`/admin/settings/intake-forms`: catalog authoring, conditions, ordering,
explicit saves, conflict recovery, synthetic preview, and version lifecycle.
The older specifications' release-pending wording predates the merged commit;
merge does not establish production migration or deployment status.

Client delivery and both client submission paths now use a shared server runtime
boundary. A non-NULL pin always resolves its exact published or retired version,
even under the legacy renderer setting. Client delivery strips staff-only
content; unavailable pins fail closed. NULL-pin rows retain the existing
legacy/compiled rollout behavior. New intakes are still not automatically pinned,
and the staff intake sheet now reviews saved pinned forms and validates saved
submissions. Staff and client Word exports also honor the saved version and
audience. A database pinning migration is prepared with rollout disabled;
creation-time track selection and conservative merge compatibility are now
implemented. The staff authoring, custom-section navigation/progress/readiness,
local migration replay, and both client-track browser submission work are now
implemented and tested. See the fifteenth step below for current acceptance
results and the release procedure. Production migration/deployment, provider
integration smoke tests, and owner-controlled activation remain separate.

## First implementation step in this checkout

The schema-driven interview previously passed bundled section selectors into
its Review modal even when rendering a custom compiled form. Review now uses
`CompiledIntakeReview`, shared with the builder preview, so section order,
labels, active items, and requirement issues match the interview evaluation.
Edit buttons navigate to the supplied section ID. Answer controls are disabled;
the live review preserves intake identity for existing-document reads, while
synthetic preview receives no identity. Legacy rendering retains its existing
review body. No persistence activation is included in this step.

## Implementation sequence status

1. **Staff authoring compatibility — implemented.** Scalar and address questions,
   financial/planning groups, uploads questions, household contacts, additional
   contacts/parents, appointment slots/review choices/excluded guardians, and
   restoration of removed additional contacts are available in the saved form.
   Drafting-only blocks link to the matter's drafting workspace. The legacy
   shared summary is read-only for pinned records.
2. **Database and browser acceptance — completed locally.** The evidence below
   covers complete migration replay, both tracks, staff edits, client autosave
   and submission, exports, lifecycle and immutable pins, request tampering,
   and isolated concurrency/rollback checks. R2 and external mail/calendar
   integrations are not configured in the disposable acceptance environment.
3. **Release preparation — documented below.** Production rollout remains off
   by default. No shared database or production deployment was changed.
   Arbitrary template keys still need a future explicit assignment mechanism;
   initial automatic selection uses only `estate` and `college_prep`.

Creation-time track selection, automatic pinning safeguards (disabled), immutable
pins/tracks, and conservative matter/lead merge compatibility are implemented in
the working tree. Separate pinned questionnaires cannot be merged until a future
explicit reconciliation workflow exists; there is no override in this release.

## Acceptance criteria

- Publishing a new version affects only subsequently created intakes.
- Retirement/archive cannot break existing pinned intakes.
- Every creation path pins consistently once activation is enabled.
- Review, progress, rendering, and server submission use the same definition.
- Rollback never substitutes a different questionnaire for a non-NULL pin.
- Existing NULL-pin intakes and drafting behavior remain compatible.

## Verification for this step

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- Builder, navigation, resolver, interview/autosave, and review regression suite:
  14 files passed; 217 tests passed, 12 skipped (database-backed builder tests
  require a separately configured local test database).
- `git diff --check`: passed.
- `npm test -- --maxWorkers=2`: 919 files passed, 2 skipped;
  10,230 tests passed, 27 skipped. The sandboxed run initially failed only the
  database RPC/column checks because binding loopback returned `EPERM`;
  both failures reproduced in a clean archive of `155208ba`. The complete
  rerun with local loopback access passed.
- Logs: `/private/tmp/form-builder-regression.log`,
  `/private/tmp/form-builder-lint.log`, `/private/tmp/form-builder-typecheck.log`,
  `/private/tmp/form-builder-full-unrestricted.log`, and
  `/private/tmp/form-builder-base.log`.
- Browser acceptance and production verification were not performed in this
  step. Phase 2C is not complete.


## Second implementation step: version-aware client runtime

Implemented `lib/intake/forms/runtime.ts`, wired `/intake` and both submission
branches of `/api/intake`, and kept legacy imports isolated from compiled
catalog initialization. The original API rollout preflight remains in place.
Request overlays cannot select another version or change the validation track.
Published title and description appear in the compiled interview, and custom
keys no longer imply estate rather than college behavior.

Verification:

- Targeted runtime, actual page/API, ownership, contact persistence, rollback,
  interview/autosave, resolver, and preview suite: 11 files / 216 tests passed.
- Lint and typecheck passed.
- Final `npm test` with loopback access: 922 files passed, 2 skipped;
  10,259 tests passed, 27 skipped. The first full run exposed an obsolete
  source-string test requiring bundled-only page compilation; its stale
  implementation assertions were removed in favor of the actual page behavior
  tests, and the complete rerun passed.
- `git diff --check`: passed.
- Logs: `/private/tmp/form-runtime-regression.log`,
  `/private/tmp/form-runtime-auth.log`, `/private/tmp/form-runtime-lint.log`,
  `/private/tmp/form-runtime-typecheck.log`, and
  `/private/tmp/form-runtime-full-final.log`.
- Read-only query against the configured local Supabase container
  `supabase_db_aubrey-law-portal-clean` found no `intake_form_templates`,
  `intake_form_versions`, or `client_intake.form_version_id`. No local migration
  was applied. A database/browser end-to-end activation test remains outstanding.
- No automatic pinning, existing-row repinning, remote migration, or deployment
  was performed.


## Third implementation step: staff review and saved submission

- `getAdminIntakeData` resolves a pinned form for the staff audience only after
  staff authorization. Unpinned rows retain the existing editor behavior.
- `AdminIntakeSheet` shows a read-only saved-form review, refreshes it after a
  successful save, and blocks submission while changes are unsaved. Loading
  failures block writes instead of showing a writable stale/blank editor.
- `submitSavedPinnedIntake` validates hydrated saved answers against the exact
  client-audience version. Its compare-and-swap update checks the stored pin,
  intake status, and `updated_at`, and updates only status/completion time.
  Contact-table changes are not covered by that row-level compare-and-swap;
  the broader submission transaction remains a rollout consideration.
- Shared post-submission handling preserves readiness flags, drafting seeding,
  matter stage progression, and the extended-data note. Pinned answers are not
  re-flattened or rewritten through the staff editor's smaller schema.
- Direct calls to the old staff submit action reject pinned rows. New rows in
  that path start as drafts before the submission guard runs.
- Pinned Word export is explicitly unavailable in both the sheet and API until
  an exporter can preserve custom sections, field order, and blocks. Existing
  unpinned export remains available.

Verification:

- Eight focused suites: 78 tests passed, including authorization, changed pin,
  missing answers, unavailable versions, row conflicts, saved
  contact answers, no answer overwrites, dirty-state guards, staff display, and
  pinned export refusal, hired-matter progression, drafting seeding, and pinned
  track behavior after practice-area changes. Existing export suites also passed.
- Lint, typecheck, and whitespace checks passed.
- Final `npm test`: 926 files passed, 2 skipped; 10,280 tests passed,
  27 skipped. The first full run exposed the old source assertion that practice
  area always overrides questionnaire track. Behavioral UI coverage now proves
  the unpinned fallback and pinned-track distinction; the full rerun passed.
- Logs: `/private/tmp/staff-intake-regression-final.log`,
  `/private/tmp/staff-intake-track.log`, `/private/tmp/staff-intake-lint.log`,
  `/private/tmp/staff-intake-typecheck.log`, and
  `/private/tmp/staff-intake-full-final.log`.
- The local database/browser activation check remains outstanding; this step
  does not apply migrations, enable automatic pinning, or deploy changes.


## Fourth implementation step: version-aware Word export

- Both authorized export routes resolve the exact saved pin, including retired
  versions and archived templates. Client exports compile the client audience;
  staff-only sections never appear in that copy. Missing or invalid versions
  return a generic 503 instead of silently using the bundled form.
- The exporter uses the shared evaluator for active sections/items and preserves
  custom section titles, field labels, block titles, and mixed field/block order.
  Code-owned projections cover every supported block. Saved JSON containers are
  unpacked, with hydrated contacts taking precedence over embedded snapshots.
- Catalog labels, dates, boolean answers, and blank placeholders are retained.
  Only selected asset details and active circumstance details are exported.
  Uploaded file contents remain separate; the document explains that limitation.
- The staff Export Word button is enabled for loaded pinned questionnaires.
  Dirty edits still save first; failed saved-form refresh now stops the export.
- Unpinned exports retain their existing behavior and do not read form versions.

Verification:

- Focused exporter, route, legacy export, and staff UI suite: 5 files / 70 tests
  passed, including actual DOCX XML, authorization, audience filtering, hidden
  sections/items, nested answers, contact precedence, order, and block coverage.
- Full suite: 927 files passed, 2 skipped; 10,305 tests passed, 27 skipped.
  Two additional export regression cases and the final spouse compatibility
  adjustment were verified in the focused rerun afterward.
- Lint, typecheck, and whitespace checks passed.
- A synthetic mixed-field/block Word export was rendered using the bundled
  LibreOffice renderer and its single page visually inspected; no clipping,
  overlap, or broken text was found.
- Logs: `/private/tmp/intake-export-focused-final.log`,
  `/private/tmp/intake-export-full.log`, `/private/tmp/intake-export-lint-final.log`,
  and `/private/tmp/intake-export-typecheck-final.log`.
- Automatic pinning, track/merge invariants, and database/browser activation
  verification remain outstanding. No migrations or deployment were performed.

## Fifth implementation step: database pinning safeguards (rollout disabled)

The new `20270203090000_intake_form_pinning_guards.sql` migration adds an
owner-controlled private rollout row, defaulting to `enabled = false`. It was
created with the Supabase CLI and moved after the existing future-dated builder
migrations so clean replay cannot encounter missing prerequisite tables.

Once separately enabled, a `BEFORE INSERT` trigger selects the highest published
version for the intake's stored track (`estate` or `college_prep`). Missing
publications and archived templates fail closed. It uses the same template
transaction lock as lifecycle RPCs plus row locks against direct catalog writes.
The rollout row is locked against concurrent activation/rollback. Inserts cannot
supply a version themselves. Updates cannot assign, remove, or replace pins,
including assigning a pin to an existing legacy row; pinned tracks are immutable.
Turning rollout off affects only new inserts and does not weaken these guards.

The trigger's private security-definer lookup is needed for authorized intake
inserts to read otherwise inaccessible form catalogs. It does not change intake
RLS or give callers access to private configuration. There is no public activation
RPC; `service_role`, `authenticated`, and `anon` cannot change the rollout row.
The application track endpoint now explains the pinned-track conflict, and
matter practice-area reconciliation leaves pinned questionnaires unchanged.

### Creation-path inventory and activation blockers

| Path | Finding before activation |
| --- | --- |
| `lib/intake/getOrCreateClientIntake.ts` | Account-first inserts default to estate; decide track before insertion when a college invitation is intended. |
| `lib/leads/createLead.ts` | Writes practice area but must derive questionnaire track before insertion. |
| `lib/appointments/book.ts`, `lib/bookings/sync.ts` | Auto-created leads currently use the default track; audit booking context and track assignment. |
| `lib/leadFiduciaries.ts` | Auxiliary intake creation must participate in the same track policy. |
| `lib/lawmatics/importMatter.ts` | Separate creation-time track selection from updates so imports cannot change a saved questionnaire. |
| `app/actions/adminIntake.ts` | Matter-first and user-first inserts need creation-time track context; lead intake import delegates here. |
| `app/api/intake/route.ts` | Direct insertion reaches the guard; preserve server-owned version/track selection and existing ownership checks. |
| `create_matter_with_client`, `open_matter_for_person` SQL | Both currently omit the track on insert. College matter routes reconcile afterward, which is too late once pinned. Fix the insert itself before activation. |
| `lib/intake/standingLinks.ts` | Resolves/updates an existing intake; it does not create an intake or choose a new form version. |
| `merge_matters` SQL | Moves linked intake references; immutability alone does not prevent mixing contacts/answers from different questionnaires. A separate merge compatibility policy is still required. |

Do not enable the rollout until these creation-time track and merge concerns,
broader staff authoring compatibility, and authenticated browser acceptance are
resolved. No full-chain database reset or shared application migration was run.

### Verification

- `node scripts/testIntakeFormPinning.mjs` creates an isolated temporary database
  in the local Supabase Postgres container, loads the real foundation/audit/new
  migration against minimal prerequisite tables, runs SQL assertions, and drops
  its database in a `finally` block. An optional first argument selects another
  local Docker container. It never connects to a linked Supabase project.
- SQL checks passed: disabled rollout, newest published selection, both tracks,
  draft exclusion, immutable pins/tracks, legacy preservation, retirement/archive,
  missing publications, rollback, preserved answers, answer-only upsert, private
  permissions, and trigger lookup from an authorized non-owner insertion.
- Six real concurrent transaction checks passed: insert versus retire/archive
  in both directions, direct version retirement, and rollout change. These verify
  lock contention; full application transaction/browser acceptance remains open.
- Focused application suite: 3 files / 40 tests passed, including authorization,
  pinned-track refusal, same-track no-op, unpinned switching, and reconciliation.
- Logs: `/private/tmp/intake-pinning-db.log`,
  `/private/tmp/intake-pinning-focused.log`, `/private/tmp/intake-pinning-full.log`,
  `/private/tmp/intake-pinning-lint.log`, `/private/tmp/intake-pinning-types.log`.
- Final full suite passed: 928 files passed, 2 skipped; 10,312 tests passed,
  27 skipped. Lint, typecheck, script syntax, and `git diff --check` passed.

## Sixth implementation step: creation-time track selection

`20270203090100_intake_creation_track.sql` initializes the track in a database
`BEFORE INSERT` trigger ordered before `client_intake_form_pin`. Thus direct
inserts, imports, and both matter-creation SQL functions choose the track before
pinning and before any AFTER INSERT consumers see the row. No existing function
bodies or historical migrations were edited. The CLI-created file is ordered
after the repository's future-dated private-schema prerequisite.

A nonblank practice area is authoritative for a newly created row. CP (case
insensitive) and the existing College Preparation Plan/College Prep/College Prep
Plan aliases select `college_prep`; other practice areas select `estate`, matching
the application catalog. With no practice area, an explicitly supplied track is
retained, otherwise the existing estate default applies. This initialization also
works before pinning rollout is enabled. It never runs on an UPDATE, so practice
area reclassification and repeat imports do not reclassify saved questionnaires.

Staff matter-first and lead-first creation now load saved practice-area context
before their initial insert, as does auxiliary fiduciary intake creation. Query
failures stop creation instead of silently choosing estate. The server owns this
lookup; editor data cannot choose a pin. Existing-intake editing bypasses creation
context and retains its track. Lead intake import delegates to the same staff
creation path.

The creation-path inventory above is superseded as follows:

- `createLead`, Lawmatics inserts, `create_matter_with_client`, and
  `open_matter_for_person` already supply practice area; the initialization
  trigger now handles them without post-insert reconciliation.
- Staff and auxiliary intake creation now supply saved source context.
- Account-first creation checks for an existing/invited intake first and reuses
  it unchanged. A genuinely new context-free intake remains estate.
- Appointment/provider booking creation has no structured practice-area or
  questionnaire-track input; it remains estate. Free-text event titles are not
  treated as authoritative routing. Adding college-specific scheduling is a
  separate product capability rather than an inferred mapping.
- Public intake insertion also retains the estate default in the absence of
  staff-owned context; client answers cannot select a form version.

Verification includes real PostgreSQL assertions for every supported CP alias,
other practice areas, conflicting initial track/area, context-free creation,
explicit track with no area, UPDATE and upsert preservation, and disabled rollout.
The existing concurrency and pin-immutability tests run against both migrations.
The harness still uses an isolated database with minimal prerequisite tables;
full-chain application/browser acceptance remains outstanding.

Automatic pinning remains disabled. Merge compatibility, staff authoring gaps,
and end-to-end activation/release checks remain before activation.

Final checks for this step:

- Full suite: 929 files passed, 2 skipped; 10,321 tests passed, 27 skipped.
- Final focused context/staff creation suite: 2 files / 12 tests passed,
  including three action-boundary cases added after the full run began.
- Lint, typecheck, whitespace checks, and the final isolated SQL/concurrency
  rerun passed. The SQL rerun also verified both private triggers for an
  authorized non-owner insertion.
- Logs: `/private/tmp/intake-track-full.log`,
  `/private/tmp/intake-track-creation-tests.log`,
  `/private/tmp/intake-track-db-final.log`, `/private/tmp/intake-track-lint.log`,
  and `/private/tmp/intake-track-types.log`.
- No shared application database migration, rollout activation, or deployment.

## Seventh implementation step: atomic merge compatibility

The new `20270203090200_intake_merge_compatibility.sql` replaces only the merge
function, preserving its existing reference-moving, drafting, archive, and audit
behavior after a new preflight. Historical migrations are unchanged. The file
was created with the CLI and ordered after its future-dated prerequisites.

Merge policy:

- Matters sharing one intake may merge, including a shared pinned intake.
- Separate intakes cannot merge when either is pinned, even if their version
  IDs match. Equal definitions do not establish equal answers or appointments.
- Separate unpinned intakes may merge only when their tracks match.
- A pinned intake cannot merge with a matter that has no intake. Legacy
  unpinned/no-intake behavior is preserved.
- Missing referenced intake rows fail closed.

The function locks matter rows in the existing ID order, then locks their intake
rows in ID order before checking compatibility or moving anything. Rejection
uses SQLSTATE 22023, which the existing authenticated endpoint maps to HTTP 409.
The merge dialog displays the explanation and now describes the restriction
before submission. There is no override or automatic answer reconciliation.
This deliberately restrictive policy removes the risk of silently combining
separate pinned questionnaires; a future explicit reconciliation workflow would
need its own design and validation.

Verification:

- `node scripts/testIntakeMergeCompatibility.mjs` executes the original and new
  merge migrations against minimal prerequisites in a temporary isolated local
  Postgres database and drops it afterward.
- The real function passed nine compatibility scenarios plus missing-intake and
  service-role checks. Rejected merges left documents, uploads, answers, merge
  logs, activity, and archive state unchanged. Allowed merges retained document
  movement, archive state, and logging.
- Three concurrent transaction checks passed: intake-track mutation while merge
  holds its locks, merge while answers are being updated, and matter-intake link
  mutation during a merge.
- Endpoint/legacy merge tests passed: 2 files / 23 tests. They verify conflict
  reporting, authorization, successful result mapping, and existing behavior.
- Full-chain application migration and browser acceptance still remain; these
  isolated database fixtures do not replace that activation check.
- Automatic pinning is still disabled. No shared application database migration
  or deployment was performed.

- Final isolated SQL rerun additionally verified preservation of both intakes'
  answers, design sheets, and fiduciary appointments on rejected merges.
- Logs: `/private/tmp/intake-merge-db-final.log`,
  `/private/tmp/intake-merge-focused.log`, `/private/tmp/intake-merge-full.log`,
  `/private/tmp/intake-merge-lint-final.log`, and
  `/private/tmp/intake-merge-types-final.log`.
- Full suite passed: 931 files passed, 2 skipped; 10,327 tests passed,
  27 skipped. Final lint, typecheck, script syntax, and whitespace checks passed.


## Eighth implementation step: individual staff question editing

Staff can edit active college-prep scalar questions and additional notes directly
in the saved pinned review, in the form's section order and with its custom copy.
Each question has explicit Save/Cancel controls. Shared client/contact details
retain the existing editor. Grouped answers such as HIPAA recipient lists still
need dedicated staff editing support.

The authenticated server action reloads the exact saved version and evaluates
visibility before accepting an answer. A code-owned allowlist restricts this
path to single-row answers with no contact synchronization side effects. Input
types, catalog choices, dates, and size limits are checked; incomplete drafts
remain valid. Submitted/approved questionnaires are read-only in this path.
Only the requested leaf in `college_prep_details` (or `special_notes`) and the
update timestamp are written. Unknown JSON keys and grouped answers survive.
The update checks the original version, timestamp, and status and rejects stale
or concurrently changed snapshots.

The sheet disables shared inputs, draft save, submission, export, and closing
while a question is being edited. After saving, it reloads the saved review and
resets the shared form baseline before unlocking. A refresh failure disables
further writes and asks staff to reopen the intake. The common review renderer
remains read-only unless its staff wrapper explicitly supplies an editor.

Tests cover authorization, hidden/unknown fields, malformed answers and dates,
missing/changed versions, concurrent changes, submitted locks, JSON preservation,
incomplete drafts, editor save/cancel/errors, and parent-sheet lock/refresh paths.
Full database migration and authenticated browser acceptance remain outstanding;
this step introduces no schema changes or rollout activation.

Validation: 45 focused tests passed. Full suite passed: 933 files passed,
2 skipped; 10,357 tests passed, 27 skipped. Lint, typecheck, and whitespace
checks passed. Logs are
`/private/tmp/intake-question-focused-final.log`,
`/private/tmp/intake-question-full.log`, and
`/private/tmp/intake-question-types.log`, and
`/private/tmp/intake-question-lint.log`.


## Ninth implementation step: staff HIPAA recipient editing

The saved pinned review now displays and edits the nested HIPAA recipient list
using the same add/remove/name/relationship/phone/email controls as the client
questionnaire. The form's block title and help text remain intact. Save and
Cancel use the existing question-edit lock and refresh behavior.

The server accepts this one explicitly supported block only when it is active
in the exact saved staff form. Its list schema rejects duplicate/missing IDs,
invalid email addresses, unexpected properties, malformed entries, and excessive
sizes. Blank draft recipients and an empty list remain allowed. Existing
recipient metadata is merged from the saved row by ID, rather than trusted from
the request; removed entries are removed intentionally. Other college answers
are preserved. Malformed stored lists fail closed rather than being silently
rewritten. Version, timestamp, status, staff authorization, and submitted locks
are shared with individual question saves. No contact rows are written.

Focused validation: 64 tests passed, including nested review display, addition,
editing, cancellation of removal, preservation of metadata and unrelated answers,
request tampering, hidden blocks, malformed saved lists, and concurrent updates.
The remaining grouped-answer work includes contact-backed and other structured
blocks. Full migration-chain and authenticated browser acceptance are still
required before activation. No deployment or automatic assignment activation.

Final validation: lint, typecheck, and whitespace checks passed. Full suite:
933 files passed, 2 skipped; 10,376 tests passed, 27 skipped. Logs:
`/private/tmp/intake-recipients-focused.log`,
`/private/tmp/intake-recipients-types.log`,
`/private/tmp/intake-recipients-lint.log`, and
`/private/tmp/intake-recipients-full.log`.


## Tenth implementation step: staff planning objectives

Staff can edit the three planning-objective answers in the pinned questionnaire,
using the form's title/help and existing client controls. The saved review now
unpacks historical serialized planning answers, so those answers are visible
before editing. Staff notes remain in the shared editor below.

The authenticated save path accepts only the three text keys, with per-answer
size limits, and requires the planning-objectives block to be active in the
saved version. It merges into the original saved value, preserving legacy free
text as notes, serialized/object staff notes, unknown keys, and nested metadata.
Malformed existing questionnaire answer types fail closed. The text database
column receives explicit JSON serialization. Clearing an answer leaves the
other saved fields intact. Existing version/status/timestamp guards, edit locks,
cancellation, and refresh failure handling also apply here.

The three textareas now have properly associated visible labels. Tests exercise
serialized review display, edit/save/cancel, strict request keys, incomplete
answers, legacy preservation, absent blocks, and malformed stored data.
Remaining work includes financial and contact-backed grouped answers, followed
by full migration-chain and authenticated browser acceptance. Automatic pinning
remains disabled; no schema change or deployment was included.

Validation: 79 focused tests passed. Lint, typecheck, and whitespace checks
passed. The initial full run found only a new test assertion expecting "needs"
instead of "need"; after correcting that assertion, the full confirmation run
passed: 933 files passed, 2 skipped; 10,391 tests passed, 27 skipped. Logs:
`/private/tmp/intake-objectives-focused.log`,
`/private/tmp/intake-objectives-types.log`,
`/private/tmp/intake-objectives-lint.log`, and
`/private/tmp/intake-objectives-full-final.log`.


## Eleventh implementation step: staff financial groups

Staff can edit financial assets in the saved pinned questionnaire with the
existing property/business/liability lists, account-total dialogs, descriptions,
and special-circumstance controls. Nested saved answers are expanded for display.
The editor tracks changed groups and sends only those groups; opening and closing
a dialog does not rewrite its answers. Cancel restores the saved snapshot and
resets dialog state. Malformed stored financial groups show a review message
instead of crashing the controls or being silently discarded.

The server requires the financial-assets block to be active in the exact saved
form, and retains staff authorization plus version/status/timestamp guards.
A code-owned schema checks field names, control types, selection values, unique
row IDs, maximum list lengths, and text lengths. Approximate amounts and partial
draft entries remain text, matching the client questionnaire. Existing list
metadata is merged by ID; totals and circumstance metadata are preserved.
Unchanged groups and unknown stored keys remain untouched. Removing an asset
selection does not delete its saved detail list. Intentional row removal is
supported. Contact records and drafting data are not written.

Focused verification: 109 tests passed, covering selective writes, metadata,
unknown-key rejection, malformed saved structures, draft blanks, account dialogs,
cancellation, and the action's pinned-version checks. Remaining work includes
contact-backed groups and full migration-chain/authenticated browser acceptance.
Automatic assignment is still disabled; this step includes no schema deployment
or activation.

Final validation: lint, typecheck, whitespace checks, and the full suite passed.
934 test files passed, 2 skipped; 10,421 tests passed, 27 skipped. Logs:
`/private/tmp/intake-financial-focused.log`,
`/private/tmp/intake-financial-types.log`,
`/private/tmp/intake-financial-lint.log`, and
`/private/tmp/intake-financial-full.log`.


## Twelfth implementation step: existing parent/additional-contact edits

The pinned review now edits one existing parent/additional contact at a time.
Staff may update name, suffix, pronouns, email, phone, and address fields. The
editor deliberately has no add/remove controls yet, and does not edit fiduciary
appointments or relationship classification. It submits only changed fields.
Staff-only hydration supplies the exact raw editable-field snapshot alongside
the displayed contact; ordinary client hydration is unchanged.

The authorized action checks the active block in the saved form, validates input,
and invokes the service-role-only, SECURITY INVOKER function
`edit_pinned_intake_contact`. That function locks the intake then contact,
checks intake version/status/timestamp and the raw contact snapshot, verifies
the contact belongs to this intake's additional-contact source and is not merged,
and updates the contact plus intake timestamp in one transaction. It rejects
identity/scope changes and empty names. Unchanged contact fields, IDs, metadata,
and appointment links are preserved. A failure of either write rolls back both.
The published/retired version resolver still runs before mutation.

The CLI created the migration, which was then ordered as
`20270203090300_intake_staff_contact_edit.sql` after this repository's future-dated
prerequisites. No historical migration was edited. Current Supabase function
permissions documentation and the changelog were reviewed; the listed database
minor-upgrade changes do not alter the SQL operations used here.

`node scripts/testIntakeStaffContactEditing.mjs` applied the function in a new,
disposable local database and dropped that database afterward. It verified
successful service-role editing, denied anon/authenticated execution, wrong
intake/source/merged contact rejection, stale version/intake/contact rejection,
submitted locks, malformed input, preservation of metadata and appointments,
and rollback after an injected intake-update failure. Three lock checks passed:
contact updates and submissions wait on an editing transaction, and editing
waits on an ongoing contact update. This isolated schema test does not replace
the remaining full migration-chain and authenticated browser acceptance.

Focused tests: 98 passed, including staff-only snapshot hydration, input
validation, atomic-RPC dispatch/error handling, UI save/cancel and baseline
refresh guards. Next: contact creation/removal and the remaining appointment/
household groups. Automatic pinning remains disabled. The migration has not
been applied to the shared application database and nothing was deployed.

Final checks passed: lint, typecheck, script syntax, whitespace, and full suite.
935 files passed, 2 skipped; 10,435 tests passed, 27 skipped. Logs:
`/private/tmp/intake-contact-focused.log`, `/private/tmp/intake-contact-types.log`,
`/private/tmp/intake-contact-lint.log`, and `/private/tmp/intake-contact-full.log`.
Database guidance checked: https://supabase.com/docs/guides/database/functions
and https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes.


## Thirteenth implementation step: contact creation and questionnaire removal

The staff editor can add a parent/additional contact, or stage an existing
contact for removal and explicitly save that removal. Keep contact and Cancel
leave the saved record unchanged. New contacts have a stable client-generated
UUID; the server uses INSERT, never an upsert into an existing identity.

`change_pinned_intake_contact_membership` is a service-role-only, SECURITY INVOKER
RPC. It retains the intake version/status/timestamp guards and validates all
request fields. Creation locks existing matter links before the intake, checks
that the links stayed unchanged, rejects ambiguous multiple-matter links, and
creates the contact plus its matter membership atomically. Lead-only intakes
may create contacts without a matter link. Same-intake duplicate names and any
existing-ID collision fail closed. Concurrent additions serialize on the intake.

Removal checks the exact contact snapshot, intake/source scope, merged status,
and absence of any contact_roles appointment while holding the contact row lock.
It marks the source `client_intake_additional_removed`; it does not delete the
contact or its matter memberships. Directory information is retained. Assigned
people must have their appointments reviewed before removal. Restoring a removed
contact through this editor is not yet implemented; duplicate-name protection
also prevents silently recreating that retained identity.

Hydration now emits an explicitly empty additional-contact list when the last
contact was removed. Unpacking respects an authoritative hydrated list instead
of replacing it with older embedded `fiduciary_entries.additional_contacts`.
Legacy embedded lists still work when no authoritative list is present.

The CLI-created migration was ordered after prerequisites as
`20270203090400_intake_staff_contact_membership.sql`. No historical migration
changed. The isolated SQL harness verifies service-role execution, denied public
execution, create/link behavior, lead-only creation, snapshot and version guards,
malformed input, name/ID collisions, ambiguous matter links, appointment blocking,
record retention, and rollback of creation/removal after injected failures.
Four concurrency checks cover assignment during removal, matter relinking,
submission, and duplicate additions. All passed.

110 focused tests passed, including UI add/staged-remove/keep/error paths,
operation validation and RPC dispatch, and prevention of old-contact resurrection.
Remaining work includes the remaining appointment and household groups, optional
restoration of retained removed contacts, and full migration-chain/browser
acceptance. No shared database migration, deployment, or pinning activation.

Final validation passed: lint, typecheck, script syntax, whitespace, isolated SQL,
and the full suite. 935 files passed, 2 skipped; 10,447 tests passed, 27 skipped.
Logs: `/private/tmp/intake-membership-focused.log`,
`/private/tmp/intake-membership-types.log`, `/private/tmp/intake-membership-lint.log`,
`/private/tmp/intake-membership-db.log`, and `/private/tmp/intake-membership-full.log`.

## Fourteenth implementation step: preserve current household and appointment answers

Reviewing the remaining appointment editors exposed a prerequisite read/write
bug: `unpackInitialIntakeData` replaced hydrated child and fiduciary arrays with
older copies in `fiduciary_entries`. The compiled interview could then autosave
those stale copies when the user changed an unrelated field. Word export already
had a separate precedence safeguard, so the interview and export could disagree.

The shared unpacker now uses embedded child, additional-contact, and fiduciary
arrays only when the corresponding root property is absent. An explicit empty
list stays empty; absent root data still falls back to legacy snapshots. This
does not infer deletion from missing database rows or modify contact/role data.
Current contact identity, details, and appointment priority survive hydration
and interview initialization.

Regression coverage exercises all household/appointment keys, explicit empty
lists, legacy fallback, repeat unpacking, and the actual compiled interview
autosave boundary after an unrelated field edit. 56 focused tests passed.
Full appointment editing remains next: it needs an atomic, matter-scoped write
and concurrency checks, rather than the legacy multi-request role writer.
Full migration-chain and authenticated browser acceptance also remain open;
pinning stays disabled by default.

Final validation passed: lint, typecheck, whitespace, and the full suite.
935 files passed, 2 skipped; 10,462 tests passed, 27 skipped.
Logs: `/private/tmp/intake-precedence-focused.log`,
`/private/tmp/intake-precedence-types.log`, `/private/tmp/intake-precedence-lint.log`,
and `/private/tmp/intake-precedence-full.log`.


## Fifteenth implementation step: finish staff editors and local acceptance

The saved staff questionnaire now edits every catalog scalar and the remaining
address, existing-document questions, spouse/children, and appointment groups.
Appointment edits select one role/party/order/co-agent slot and compare the exact
saved snapshot; they preserve unrelated appointments and contact identity.
Staff can record an intentionally incomplete appointment choice and excluded
guardian names without deleting other answers. Removed additional contacts can
be restored under the same contact ID.

Migrations `20270203090500`–`20270203090700` add service-only, transaction-safe
appointment, restoration, and household writers. They enforce the saved version,
status, intake timestamp, contact snapshot and matter membership. Removing an
appointed household contact is rejected. Removing a child/spouse retains the
contact and membership. The child writer updates the existing design-sheet
children projection in the same transaction, preserving unrelated decisions;
this is necessary to match the authoritative household writer used by drafting.
Full-schema rollback coverage verifies that a projection failure also rolls back
the contact mutation. No other drafting internals were changed.

Full-schema acceptance caught that the earlier pending contact migrations used
text parameters against UUID intake IDs. All five pending contact/household RPCs
now coerce through `public.client_intake.id%TYPE`, preserving the text RPC boundary
and supporting both the real UUID schema and isolated fixtures.

Pinned appointment hydration now reads the actual matter scope and all priorities
and co-agents. Ambiguous matter linkage fails closed. Client hydration does not
include staff edit snapshots. Both hydrated empty household arrays and current
appointment arrays win over historical embedded snapshots.

Staff creation establishes the persisted questionnaire before collecting answers,
so a newly pinned intake never starts in the smaller legacy editor. The server
also rejects legacy bulk saves/submission for pinned rows. Progress and readiness
use actual saved sections, and navigation supports custom section IDs. List
answers retain their array shape when saved; canonical names, citizenship,
address aliases and referral details use their proper storage adapters.

HTTP acceptance exposed a pre-existing cookie-only proxy gate that prevented
standing-link and bearer credentials from reaching the intake handlers. Only the
explicit intake answer/contact/document/export endpoints now delegate these
credentials to their existing route authentication. Staff routes, pages, and
unknown endpoints keep the cookie gate. Invalid tokens and cross-owner access
remain rejected at the route boundary.

### Local evidence

- A separate disposable Supabase project, `cornerstone-form-acceptance-c583`,
  used ports 56321/56322 and a local app at port 3007. The existing user stack
  was not reset or migrated. All fixture users and answers were synthetic.
- All 300 migrations replayed from scratch through `20270203090700`, followed
  by the local seed. A CLI reset hit a Realtime initialization race; a fresh
  disposable stack without the unused Realtime service replayed successfully.
- Both estate and college-prep clients logged in through the browser, loaded
  staff-saved answers, autosaved an edit, reviewed the exact questionnaire,
  submitted successfully, and saw the locked thank-you screen. Staff browser
  editing and Word download also succeeded. No external messages were sent.
- `scripts/verifyPinnedIntakeAcceptance.ts` passed both tracks after the fresh
  replay: scalar/group edits, contact add/edit/remove/restore, alternate
  appointments, stale/role guards, household changes and export projections.
- `tests/sql/intake-staff-household-acceptance.sql` passed against the full schema,
  including duplicate spouse rejection, contact retention, child projection,
  appointed-contact protection and rollback after an injected failure.
- Isolated pinning, contact editing, membership, appointment and merge SQL
  harnesses passed their assertions and concurrent-lock checks.
- The optional lifecycle database suite passed all 30 tests.
- `scripts/verifyPinnedIntakeLifecycle.ts` passed both tracks against the live
  local API: publish/retire/archive, unchanged old-pin delivery, new-version
  assignment, immutable version/track, client-vs-staff access, cross-owner
  rejection, valid and forged standing tokens, and session/invite Word exports.
  Legacy NULL-pin delivery still honors rollback mode.
- Final full suite: 939 files passed, 2 skipped; 10,499 tests passed, 27 skipped.
  The subsequent custom review-section navigation fix passed all 31 focused
  navigation/progress/proxy tests. Lint, typecheck and whitespace checks passed.
- Current logs: `/private/tmp/intake-all-final-suite.log`,
  `/private/tmp/intake-final-navigation.log`, `/private/tmp/intake-final-lint.log`,
  `/private/tmp/intake-final-types.log`, `/private/tmp/intake-lifecycle-http.log`,
  `/private/tmp/intake-full-migration-replay.log`,
  `/private/tmp/intake-replay-real-acceptance.log`,
  `/private/tmp/intake-replay-household-db.log`, and
  `/private/tmp/intake-replay-schema-db.log`.
- Browser proof: `/private/tmp/intake-estate-submitted.png` and
  `/private/tmp/intake-college-submitted.png`. The downloaded staff Word file
  also contains the saved preferred-name edit and pinned notes. The local
  replay recreated those synthetic fixtures afterward; screenshots document
  the successful browser runs before that replay.
- Local dev remains on port 3007 with a gitignored `.env.local` pointing only
  to the disposable acceptance stack. It is not a production configuration.
  To stop that stack, use `supabase stop --workdir
  /private/tmp/cornerstone-form-acceptance-c583`; do not stop/reset the existing
  user stack. These local operational paths are evidence, not release inputs.

### Release and activation procedure

1. Review and commit the code and pending migrations as one scoped release.
   Apply schema migrations with the private rollout disabled, then deploy this
   pin-aware code. Do not enable pinning while older application instances remain.
2. Against the intended environment, run `npm run intake:forms:install` in its
   default read-only mode. For a fresh catalog, use the reviewed apply command
   with an explicit administrator UUID. The installer rejects drift; it does
   not silently overwrite a published form. Existing customized catalogs must
   instead be reviewed through the builder. Do not run synthetic fixture scripts
   against a shared environment.
3. Verify both active track templates have a published version. Read their
   definitions through the repository/runtime so schema, compiler and canonical
   hashes are checked, not just SQL metadata. Verify an existing NULL-pin intake,
   both authenticated and standing-link flows, and provider-backed uploads in
   the deployment. Confirm all deployed code supports saved retired pins.
4. Activation is an explicit database-owner operation. Neither ordinary clients,
   staff UI nor service-role RPCs can change the private rollout row. Review the
   selected IDs/hashes before running the owner transaction:

   ```sql
   BEGIN;
   SELECT enabled FROM intake_private.form_pinning_rollout
     WHERE singleton FOR UPDATE;
   DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM (VALUES ('estate'), ('college_prep')) required(key)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.intake_form_templates t
         JOIN public.intake_form_versions v ON v.template_id = t.id
         WHERE t.key = required.key AND t.archived_at IS NULL
           AND v.status = 'published'
       )
     ) THEN RAISE EXCEPTION 'Both tracks need an active published questionnaire';
     END IF;
   END $$;
   UPDATE intake_private.form_pinning_rollout SET enabled = true WHERE singleton;
   COMMIT;
   ```

5. Verify a newly created intake in each track receives the expected version;
   an old NULL pin remains NULL. Publishing another version must leave the
   first record's pin unchanged. Monitor failed intake creation, exact-version
   resolution, submission and export errors during the initial rollout.
6. Roll back new assignments by setting `enabled = false` as database owner.
   Keep the pin-aware application deployed: existing pins still require their
   original definitions. `INTAKE_RENDERER_MODE=legacy` applies only to NULL pins.
   Never clear pins, rewrite retired definitions, or downgrade to code that
   substitutes the current bundled questionnaire. Rollback does not alter
   saved answers or existing NULL-pin records.

Production deployment/activation and provider-backed verification were not
performed in this local implementation session. No migration backfills old pins.
