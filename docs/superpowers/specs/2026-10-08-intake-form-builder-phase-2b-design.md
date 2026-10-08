# Intake form builder Phase 2B visual editor and preview

**Date:** 2026-10-08

**Status:** approved by the user; implementation planning in progress

**Scope:** administrator-only visual authoring and synthetic preview over the
Phase 2A intake-form persistence and lifecycle foundation

## Purpose

Phase 2A established immutable published versions, a single optimistic-locking
draft per template, lifecycle services and routes, and the dormant persistent
resolver. Phase 2B adds the administrator-facing Settings experience for
composing those definitions without changing application code.

The builder is intentionally constrained. Administrators arrange and configure
only code-approved canonical scalar fields and compound blocks. The builder
does not create arbitrary questions, persistence keys, validation code,
drafting mappings, scripts, or generic answer storage.

Phase 2B does not activate database-backed intake rendering and does not pin
new or existing intakes. Those runtime changes remain Phase 2C. It also does
not replace `AdminIntakeSheet` or change drafting internals.

## Success criteria

- An administrator can create, duplicate, edit, preview, save, publish, retire,
  archive, restore, and discard intake form work from Settings.
- The editor exposes only entries approved by the canonical field and block
  catalogs.
- An incomplete or compiler-invalid definition can be saved as a draft but
  cannot be published.
- Preview compiles the current local definition for client and staff audiences
  against synthetic answers without writing intake data.
- Concurrent edits cannot silently overwrite one another, and an administrator
  can recover a local definition after a conflict.
- Every successful lifecycle mutation records its administrator and timestamp
  atomically without copying form definitions or client answers into the log.
- Published definitions remain immutable and all existing intake behavior is
  unchanged.

## Chosen experience

### Settings entry and routes

Add an administrator-only **Intake forms** route to the Workflow group in the
existing Settings navigation.

- `/admin/settings/intake-forms` is the template list.
- `/admin/settings/intake-forms/[templateId]` is the editor and version detail
  route.

The server route enforces administrator access before rendering. All reads and
mutations also continue to use the administrator-protected API boundary; hiding
the navigation item is not treated as authorization.

### Template list

The list shows active templates first and archived templates in a separately
labelled view. Each row shows:

- name and stable key;
- latest published version and status;
- whether a draft exists;
- last modification time;
- the lifecycle actions currently allowed.

Opening a row edits its draft when one exists. If only a published or retired
version exists, Edit creates the next draft from the selected immutable
version. A template with an existing draft cannot create a second draft.

The page provides two creation paths:

1. **New blank form** creates a structurally valid version-1 draft with no
   sections. It may be saved while compiler diagnostics are unresolved.
2. **Duplicate** copies a selected version into version 1 of a new template
   with a new key, name, and independent history.

Keys are chosen at creation, must satisfy the Phase 2A key contract, and are
not editable afterward because the definition key and template identity must
remain aligned.

### Build and Preview workspace

The editor has two top-level modes.

**Build** is the default. It uses a roomy form outline with a contextual
inspector:

- the outline contains form metadata, ordered sections, and ordered items;
- selecting the form, a section, or an item opens its editable properties in
  the inspector without route navigation;
- desktop uses outline and inspector side by side;
- narrow layouts stack the inspector beneath the selected outline item;
- destructive controls are kept out of the normal editing flow.

**Preview** gives the compiled form the full available width. It offers client
and staff audience tabs plus code-owned sample scenarios such as Empty, Single,
Married, and Family with children. The scenarios exist only to exercise
common conditional paths; Phase 2B does not add a general fake-data editor.

Preview always uses the latest local editor state, including unsaved changes.
It runs the same schema parser and compiler used by publication, followed by
the existing schema-driven renderer in an isolated preview adapter. The
adapter serves synthetic answers and no-op or in-memory capabilities. It never
creates an intake, calls an answer-persistence adapter, uploads a document, or
submits a form.

## Authoring model

### Approved catalog drawer

**Add item** opens a searchable drawer rather than an arbitrary field editor.
The drawer is grouped into approved canonical fields and approved compound
blocks. Each result shows its display name, concise description, control or
block type, baseline requirement, supported audience, and relevant placement
constraints.

The drawer obtains its data from a serializable, code-owned builder catalog
projection. It does not receive persistence adapters, renderer functions, or
other executable catalog internals. Entries not marked `builderEnabled` never
appear and are rejected again by the server compiler if submitted manually.

Already-used single-use fields are disabled with an explanation. Entries that
cannot support the selected section audience are disabled rather than inserted
into an invalid location. Search matches the approved display name,
description, and stable ID; it does not create new catalog entries.

### Editable properties

At form level, an administrator may edit title and plain-text description.
The stable key is read-only.

At section level, the builder exposes:

- title, optional subtitle, and time estimate;
- client-and-staff or staff-only audience;
- optional-section behavior supported by the schema;
- one supported visibility condition tree;
- remove section.

At field level, the builder exposes:

- label override and plain-text help text;
- optional, recommended, or required, subject to the catalog baseline;
- one supported visibility condition tree;
- remove item.

At block level, the builder exposes title override, plain-text help text,
catalog-declared configuration controls, one supported visibility condition
tree, and remove item. The builder renders only controls described by the
approved block configuration projection; it never provides a raw JSON editor
as the ordinary authoring path.

Text limits and all schema constraints come from the versioned definition
schema. The V1 editor accepts neither HTML nor Markdown.

### Conditions

The condition editor supports only the existing declarative operations:

- equals;
- not equals;
- is set;
- all;
- any.

The field selector contains only eligible fields placed earlier in the form.
Values come from the referenced field's approved options or boolean control.
Moving a controlling field after a dependent item does not delete the
condition; it creates a compiler diagnostic that must be resolved before
publication. There are no formulas, scripts, regexes, dates, arbitrary
comparisons, or cross-record queries.

### Ordering and identifiers

Sections and items use drag handles for pointer reordering and explicit Move up
and Move down actions for keyboard and assistive-technology access. Dragging is
not the only way to reorder content.

New section and item IDs are generated by the application and remain stable
when content is moved or edited. Duplicate IDs and unsupported references are
compiler errors. The UI does not expose IDs as mutable routine settings.

## Draft state and diagnostics

The editor keeps one local definition snapshot and the last successfully saved
server snapshot. Any difference produces a visible **Unsaved changes** state.
There is no debounced or background draft save in Phase 2B.

**Save draft** sends the definition, version ID, and expected `lock_version` to
the Phase 2A compare-and-swap service. Successful saves replace the saved
snapshot, update the lock version and definition hash, and retain any returned
compiler diagnostics. Save failures retain all local edits and offer retry.

The compiler runs locally or through a side-effect-free server boundary as the
definition changes. A persistent diagnostics panel groups messages by form,
section, and item. Selecting a diagnostic returns to Build mode, selects the
affected node, and focuses the relevant control when possible. Diagnostics do
not prevent saving an incomplete draft.

Navigation away from a dirty editor requires confirmation. This covers links,
in-app navigation, closing or reloading the tab, and lifecycle actions that
would replace the local definition. A successful save clears the warning.

### Concurrent-edit conflicts

A `409 INTAKE_FORM_CONFLICT` never replaces local state. The editor displays a
persistent conflict banner with:

- **Reload latest**, which first warns that the current local snapshot will be
  replaced; and
- **Copy local definition**, which copies or downloads canonical JSON so the
  administrator has a recovery artifact before reloading.

Phase 2B does not attempt automatic or field-by-field merging. Publish also
uses the saved lock version and definition hash, so a stale editor cannot
publish a definition it did not most recently save.

## Lifecycle actions

### Publish

Publish is enabled only when the editor is clean and the saved draft compiles
for both client and staff audiences with no diagnostics. The confirmation names
the template and version and states that the version becomes immutable.

The API remains authoritative: it recompiles the saved definition, checks the
expected lock version and hash, and performs the atomic Phase 2A transition.
Client-side readiness is guidance, not a security or integrity boundary. A
failed publish leaves the draft unchanged and shows returned diagnostics or an
actionable server error.

### Create next draft and discard

Editing an immutable published or retired version creates the next numbered
draft through `createNextIntakeFormDraft`. Phase 2B adds only the narrow admin
read/action route needed to expose the existing service where the Phase 2A API
surface does not yet expose it.

Discard draft requires confirmation, sends the expected lock version, and
returns the editor to the latest immutable version or template list. It never
removes published or retired history.

### Retire, archive, and restore

Retiring a published version requires confirmation and removes it from future
selection without breaking historical or pinned references. It does not create
a replacement version automatically.

Archiving removes a template from the normal active list but preserves its
draft, versions, and history. Restoring clears the archive marker. Both actions
use the existing Phase 2A archive endpoint and do not alter version status.

The interface describes consequences in confirmations and never labels these
recoverable lifecycle actions as deletion.

### Durable lifecycle audit

Phase 2A passes an explicit administrator actor into every lifecycle function,
but only creation and publication currently retain that actor on the affected
row. Phase 2B therefore adds an append-only `intake_form_audit_events` table so
the approved audit requirement is not inferred from mutable timestamps.

Each event records:

- template ID;
- version ID when the version still exists, with deletion setting the
  reference to null rather than deleting the event;
- the version number when applicable, retained even after draft discard;
- action: `create`, `save`, `create_next_draft`, `publish`, `retire`,
  `archive`, `restore`, `duplicate`, or `discard`;
- administrator actor ID;
- occurrence timestamp; and
- minimal action metadata, such as the duplicate source template/version,
  without copying a form definition or client answers.

The event is written in the same database transaction as its lifecycle
mutation. Existing lifecycle RPCs are extended rather than relying on a later
best-effort browser or application insert. Duplicate uses an atomic lifecycle
operation that can record both the source and new identity. A failed or rolled
back mutation creates no success event.

The table has RLS, no client/public direct access, and server-side admin-only
reads. Audit rows are append-only to application roles. The first builder UI
does not need a full audit-log screen, but the template detail read model may
show a concise recent activity list. Retention or export policy beyond normal
database retention is outside Phase 2B.

## Data and component boundaries

Phase 2B should introduce a small client-side editor state module whose pure
operations cover:

- add, remove, and update section;
- add, remove, and update item;
- reorder sections and items;
- condition construction;
- selection repair after deletion;
- dirty-state comparison;
- mapping compiler diagnostic paths back to editor nodes.

React components dispatch these operations rather than mutating nested
definition objects ad hoc. Server modules continue to own raw-row parsing,
authorization, hashing, optimistic locking, lifecycle transitions, and durable
audit recording.

The list and editor need read models containing template metadata, ordered
version metadata, the current draft when present, and the selected source
definition. Existing repository/service functions remain the source. If a new
read endpoint or a create-next-draft endpoint is required, it must be a thin
administrator-authorized wrapper over those existing functions, not a second
lifecycle implementation.

No browser code receives a service-role credential. Raw database JSON never
bypasses the Phase 2A parser, and preview never becomes an answer store.

## Authorization and failure behavior

- The Settings route and every API handler require the existing administrator
  boundary.
- Attorneys who are not administrators, clients, public-link users, and
  anonymous callers cannot list or mutate definitions.
- A malformed stored version fails closed and produces a staff-facing error;
  the UI does not silently substitute a bundled definition.
- A failed list or load presents retry without fabricating empty state.
- A failed save, publish, retire, archive, restore, duplicate, or discard keeps
  the last known screen state and reports whether retry is safe.
- No lifecycle response is treated as successful until the server returns the
  updated, parsed resource.
- Published and retired definitions cannot be edited in place even if browser
  requests are forged.
- Successful lifecycle mutations record their actor and timestamp atomically;
  failed mutations do not create success events.

## Testing strategy

### Unit tests

- Editor reducers preserve stable IDs while adding, editing, deleting, and
  reordering sections and items.
- Selection moves to a sensible sibling or parent after deletion.
- Catalog filtering, grouping, search, used-entry disabling, and
  audience-placement rules derive from the approved projections.
- Requirement controls cannot weaken catalog baselines.
- Condition controls offer only earlier eligible fields and approved values.
- Diagnostic paths select and focus the corresponding editor node.
- Dirty-state comparison changes only when the definition changes.
- Preview scenarios create deterministic synthetic answers without mutation.

### Component and route tests

- Settings navigation and both pages are administrator-only.
- The template list distinguishes active, archived, draft, published, and
  retired states and offers only valid actions.
- Blank creation and duplication produce independent drafts.
- Pointer and Move up/Move down ordering produce the same definition.
- Incomplete drafts save while Publish remains unavailable.
- Preview uses unsaved local changes for both audiences and its capabilities
  cannot persist, upload, or submit.
- A successful save updates the lock version and clears the dirty indicator.
- Save and publish failures retain local state and render diagnostics.
- A conflict retains local edits; Reload latest confirms replacement; Copy
  local definition produces valid canonical JSON.
- Unsaved-change protection covers in-app and browser navigation.
- Publishing, retiring, archiving, restoring, duplicating, and discarding show
  accurate confirmations and resulting state.

### Service and integration tests

- Non-admin requests are rejected for every new and existing builder route.
- Any new read endpoint returns parsed definitions and template-scoped version
  history.
- Any create-next-draft endpoint preserves the Phase 2A single-draft and
  immutable-version rules.
- Compiler-invalid drafts save but fail publication for both audiences.
- Stale locks and stale hashes return conflicts and never overwrite data.
- Published and retired definitions remain immutable.
- Lifecycle actions retain all historical versions and do not update
  `client_intake.form_version_id`.
- Create, save, create-next-draft, publish, retire, archive, restore,
  duplicate, and discard each create exactly one append-only audit event in the
  same transaction as the mutation.
- Discard retains its audit evidence after the draft row is deleted, and
  unauthorized callers cannot read or write audit rows.

### Browser acceptance

Using an administrator fixture:

1. Create a blank form, add sections and approved catalog entries, reorder them
   with pointer and keyboard controls, and save the incomplete draft.
2. Resolve diagnostics, exercise spouse and child visibility through the
   Married and Family preview scenarios, and compare client and staff preview.
3. Save and publish, confirm the immutable version appears in the list, then
   create the next draft.
4. In two sessions, cause an optimistic-lock conflict and demonstrate that the
   second session retains and exports its local definition before reloading.
5. Duplicate a version, retire a published version, archive and restore a
   template, and discard a draft while confirming history remains intact.
6. Confirm a non-admin cannot open the pages or call the APIs.
7. Confirm no intake row is created or pinned and existing client, public-link,
   staff intake, and drafting regression suites remain unchanged.

Standard `lint`, `typecheck`, focused tests, the full test suite, and diff checks
apply. Browser acceptance is required because component tests do not establish
real drag, focus, unload-warning, responsive, or dual-session behavior.

## Rollout and recovery

Phase 2B can deploy independently after Phase 2A. Its database change is an
additive audit table plus transactional audit writes in the existing lifecycle
functions; its product change is the administrator UI over that lifecycle.
Until Phase 2C, published database definitions remain dormant for live intake
selection.

If the builder UI must be rolled back, remove or disable its Settings entry and
routes. Previously published versions remain immutable in the database, bundled
forms continue to render current intakes, and no answer or pinned-intake data is
changed. A UI rollback does not require deleting templates or versions.

## Explicitly out of scope

- Database-backed runtime activation or intake version pinning.
- Changes to client, public-link, or staff intake rendering behavior.
- Replacing `AdminIntakeSheet`.
- Detailed Intake tab enhancements, shared-people improvements, asset tables,
  estate totals, tax-threshold context, or answer-attribution badges.
- Arbitrary questions, generic answer JSON, raw schema editing, or custom
  persistence mappings.
- User-authored code, formulas, regular expressions, HTML, or Markdown.
- Automatic conflict merging.
- Changes to drafting internals, draft payloads, or document generation.

## Decisions recorded

- Phase 2B is a separate release from detailed intake enhancements and Phase
  2C runtime activation.
- The editor uses a Build/Preview workspace rather than an always-split live
  preview.
- Add item uses a searchable approved-catalog drawer.
- Draft saving is explicit, with a dirty indicator; preview uses unsaved local
  changes and publish requires a successful save.
- Reordering supports drag handles and accessible Move up/Move down controls.
- Preview uses code-owned synthetic scenarios and never writes client data.
- Conflicts preserve local edits and offer reload plus JSON recovery; V1 does
  not merge concurrent edits.
- Invalid drafts may be saved, but both audience compilations must pass before
  publication.
- Every successful lifecycle mutation leaves a durable actor-and-time audit
  event; mutation and event commit or roll back together.
- Published versions and existing intakes are never silently changed.
