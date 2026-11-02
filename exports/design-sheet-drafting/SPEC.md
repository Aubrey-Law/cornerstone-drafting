# Design sheet & drafting — specification

This describes the feature as it runs in Cornerstone today, which is the
behaviour the bundle in `source/` implements. File references are relative to
`source/`. `README.md` covers the bundle itself (inventory, seams, env vars);
`BUILD_PLAN.md` covers getting it running in a new app.

## 1. Overview

An estate-planning attorney meets a client, decides how the plan is
structured (who the trustees are, whether there is a trust, what happens to the
residue, which powers the agent gets), and then needs a matching set of signed
documents. Cornerstone splits that into two halves:

1. **The design sheet** is the single record of those decisions for one matter.
   It starts from the client's intake questionnaire, the attorney completes and
   corrects it, and it reports what is still undecided.
2. **Drafting** turns the design sheet into Word documents. Rendering is
   deterministic: a payload is built from the sheet, and the bundled Word
   templates are filled with it. A draft can be regenerated at any time, and
   identical input produces the same documents.

Staff then review each draft, convert it to PDF and share it with the client.

### Who uses it

| Role | Access |
|---|---|
| Attorney / admin (`users.role` in `attorney`, `admin`) | Everything below |
| Admin only | Publishing template overrides; permanently deleting records |
| Client (portal) | Reads their own matter's design sheet (RLS) and documents once shared. No drafting UI |

### Scope of this bundle

| In | Out (Cornerstone-only, see README "Seams") |
|---|---|
| Drafting hub, workspace, design sheet, generate, review, quick draft | Matter workspace shell, stage lifecycle, SLA tasks |
| Clause library, per-matter clause overrides, template overrides, style sets | Engagement letters, e-signature, billing |
| Real-estate transfer documents (deeds, trust certificates) | Matter chat assistant, tabular review, AI redline routes |
| AI autofill / import as proposals; optional LLM fallback generator | Client document upload, folders, prior plans, Word add-in |

## 2. Domain model

### 2.1 Entities

```
users ─┐
       │ staff actor
client_intake ──1:1── matters ──1:1── matter_details (practice_area)
                         │
                         ├──1:n── design_sheets (active = max(version))
                         │            └── decisions jsonb (namespaced)
                         ├──n:m── contacts  (via matter_contacts)   ← fiduciary slots hold contact_id
                         ├──1:n── draft_generation_runs (leased, idempotent)
                         ├──1:n── matter_documents ──1:n── document_versions
                         │                                     └──1:n── generated_document_clause_revisions
                         └──1:n── matter_estate_clause_overrides
estate_clauses ──1:n── estate_clause_revisions ──1:1── estate_clause_publications (current)
document_template_versions ──── document_template_publications (current override per template)
style_sets (one default)        custom_document_templates (quick-draft uploads)
```

### 2.2 The design sheet row

Table `design_sheets` (full DDL in `schema.sql`). Key points:

- **One active sheet per matter.** Rows are unique on `(matter_id, version)`; readers take the highest `version`. In practice every matter has `version = 1` and writers upsert on that key.
- **Two homes for a field.** The TypeScript type `DesignSheet` (`types/database.ts`) has far more fields than the table has columns.
  - `lib/designSheetPersistence.ts` `WRITABLE_DESIGN_SHEET_COLUMNS` is the allow-list of real columns.
  - On save, any other top-level field is folded into `decisions`. On load, `inflateDesignSheetRow` lifts it back out.
  - Namespaced objects in `DECISION_ONLY_TOP_LEVEL_KEYS` always stay under `decisions`.
  - The allow-list must match the real table exactly. PostgREST rejects unknown columns, so a stale entry breaks every save.
- **Columns** hold identity and the most-queried decisions: client and spouse identity (`client_name`, `client_dob`, `marital_status`, …), address, `plan_type`, `is_joint`, `trust_name`, distribution settings, signing date/county, and JSONB arrays for `children`, `assets`, `specific_bequests` and the ten fiduciary slot arrays (`trustee_slots`, `executor_slots`, `poa_slots`, `hcp_slots`, `guardian_slots`, `temporary_guardian_slots`, `spouse_*_slots`).
- **Fiduciary slots** are `{id, contact_id, is_co, order}`. A slot stores a contact id, never a name. Legacy scalar columns (`trustee_primary`, `executor_alt1`, …) are only a fallback.
- **`overrides`** maps a field to `{original, updated_by}` when the attorney changes a value that came from intake. Re-sync from intake skips overridden fields.
- **`updated_at` is maintained by the application, not a trigger.** It is the optimistic-concurrency token, so every writer must set it.

### 2.3 `decisions` namespaces

Each namespace has a typed reader that fills defaults, and a writer.

| Namespace | Holds | Code |
|---|---|---|
| `document_inclusions` | Which documents to draft: `trust`, `will`, `dpoa`, `healthcare`, `deed`, `young_adult_estate_plan`, `ferpa_release`, `education_poa`, `spouse_docs` | `lib/designSheetDocumentInclusions.ts` |
| `estate_plan_design` | Will title, signing type, health-care directive title, POA form/title, ancillary documents | same |
| `trust_planning_type` | Trust structure for an individual (non-joint) trust | same |
| `plan_track` | `estate` or `college_prep` | `lib/collegePrepDesign.ts` |
| `college_prep` | School, FERPA, POA scope, HIPAA, simple will, living will | same |
| `design_sheet_layout` | `essential` or `full` | `lib/designSheet/sheetLayout.ts` |
| `trust_details` | ~70 trust provisions: trustee nomination and pay, marital/bypass/QDOT, residuary method, distribution protections, incapacity, asset schedule format | `lib/designSheetTrustDetails.ts` |
| `dpoa_provisions` | Effective/springing, compensation, co-agents, gifting, trust powers, 13 basic powers | `lib/designSheetDpoaProvisions.ts` |
| `healthcare_provisions` | Per-person anatomical gifts, advance directive, HIPAA agents, disposition of remains | `lib/designSheetHealthcareProvisions.ts` |
| `will_provisions`, `will_pr_powers` | Testamentary powers of appointment; personal representative powers | `lib/designSheet/willProvisions.ts`, `lib/designSheetWillPowers.ts` |
| `execution_mechanics` | Acknowledgment type, signing city, notary, witnesses | `lib/designSheet/executionMechanics.ts` |
| `settlor_facts` | Gender, place of marriage, survivor designation, disabled veteran | `lib/designSheet/settlorFacts.ts` |
| `excluded_guardians`, `fiduciary_document_inclusions`, `contact_profiles` | Excluded guardians; per-contact entity and beneficiary type | `lib/designSheet/*` |
| `real_estate_transfer`, `deed` | Deed and transfer form state | `lib/designSheetRealEstateTransfer.ts` |
| `extras` | Attorney-defined variables, available to templates as `{{ extras.<key> }}` with no code change | `AdditionalVariablesSection.tsx` |
| `quick_draft` | Saved quick-draft answers per template | `lib/drafting/quickDraft.ts` |

Readers distinguish *decided* from *undecided* (`lib/designSheet/decisionReaders.ts`).
Readiness depends on that distinction, so don't collapse "unset" into a default.

### 2.4 Plan type, track and layout

- **`plan_type`**: `pour_over` (trust plus pour-over will), `outright_will`, or `testamentary_trust`. Changing it adjusts `document_inclusions` and the will title (`lib/designSheet/applyPlanType.ts`).
- **Plan track**: comes from the practice area (`CP` → `college_prep`, otherwise `estate`). It decides which section groups exist. It is reconciled on every workspace load (`lib/designSheet/reconcilePlanTrack.ts`).
- **Layout**:
  - `essential`: three condensed groups. Default for `EP` and `EP-LP`.
  - `full`: every group the plan uses.
  - `college_prep`.
  - Staff can switch between them; the choice is stored in `decisions.design_sheet_layout`.
- **Practice areas** `Probate` and `TA` return 404 from the drafting workspace.

## 3. Design sheet behaviour

### 3.1 Creation and seeding

On every workspace load, `app/admin/drafting/[matterId]/loadDraftingMatterContext.ts` does the following:

1. If there is no sheet, or it is unseeded (empty `client_name`), call `ensureDesignSheetSeededFromIntake`:
   - Only for `matters.relationship_status = 'hired'`.
   - Maps intake to columns (`buildIntakeSeedPayload`) and seeds `decisions.document_inclusions` from the intake plan.
   - Inserts a blank v1 row if the intake has no name yet.
2. Reconcile the plan track with the practice area.
3. Write computed defaults once after seeding (`lib/designSheetDefaults.ts`):
   - `client_domicile` from `state`.
   - `trust_name` = "[Last] Family Trust" for a joint trust, otherwise "The [Initials] Trust".
   - `spouse_trust_name`.
   - Defaults only ever fill blanks.

`lib/designSheet/buildInitialSheet.ts` is the client-side, fully populated blank
sheet, including defaults like `utma_age = 21` and `bond = 'no_bond'`.

### 3.2 Editing contract

Every section edits through `onChange(field, value | updater)`
(`sections/shared.tsx`). `useDesignSheetState` (`lib/designSheet/useDesignSheetState.ts`)
owns the state:

- **`updateField`** commits a change. For intake-prefilled fields it records or clears an `overrides` entry.
- **Local draft:** every commit is written to `sessionStorage` under `cornerstone:design-sheet-draft:<matterId>`. On load an existing draft wins. If the draft's base `updated_at` differs from the server's, a conflict opens instead of the draft being discarded.
- **Autosave:** debounced 3 s after a change (5 s after an error).
  - Single-flight, with 3 attempts and exponential backoff.
  - A change counter catches edits made during a save.
- **Server refreshes** never overwrite local unsaved edits (`shouldApplyServerSheetProps.ts`).
- **`flushAndSave()`** is the barrier before generation. The Generate step will not open until it succeeds.

### 3.3 Save protocol (optimistic concurrency)

`PATCH /api/admin/matters/[id]/design-sheet`

```jsonc
// request
{ "sheetId": "uuid|null", "expectedUpdatedAt": "timestamptz|null", "sheet": { /* DesignSheet */ }, "decisions": { /* full blob */ } }
// 200
{ "id": "uuid", "updated_at": "timestamptz", "version": 1 }
// 409
{ "conflict": true, "updated_at": "timestamptz" }
```

1. Compare `expectedUpdatedAt` with the stored `updated_at` by parsed instant (`lib/designSheet/updatedAt.ts`). A mismatch returns 409.
2. Build the payload with `buildDesignSheetSavePayload`. The incoming `decisions` blob is authoritative.
3. Update with `.eq('updated_at', expected)` (compare-and-swap). Zero rows updated returns 409.
4. Children are not written to the sheet directly. They are saved as contacts (`saveHouseholdChildren`), and `design_sheets.children` is rebuilt from them.
5. If no row exists, seed and upsert v1.

On a 409 the client re-reads the server row and holds `{local, base, latest}`.
All edits freeze. `DesignSheetConflictDialog` lets staff pick local or latest
per changed path, where arrays count as one value (`lib/designSheet/designSheetConflict.ts`).
The resolution is saved against `latest.updated_at`.

**Writers that skip the compare-and-swap:** intake re-sync, plan-track
reconcile and defaults-on-load. Keep these rare and idempotent.

### 3.4 Sections and groups

Groups are shown one at a time as tabs, plus a final **Review & sign** tab.
Group membership (`designSectionCatalog.tsx`):

| Group | Track | Shown when |
|---|---|---|
| Intake Details | estate, college prep | always |
| College Preparation Plan | college prep | always |
| Fiduciaries | both | always |
| Estate Plan Details | estate | always |
| Trust; Trust provisions; Asset schedules | estate | `document_inclusions.trust` |
| Last Will and Testament | estate | `will` |
| Powers of attorney | both | `dpoa` |
| Health care | both | `healthcare` |
| Real property | estate | `deed` |

Section components live in `app/admin/drafting/[matterId]/design/sections/`:

- **People:** `PersonalSection`, `FiduciariesSection`/`FiduciaryGrid`, `ContactPicker`/`AddPersonDialog`, `ExcludedGuardiansSection`.
- **Plan:** `PlanDesignSection`, `EssentialEstatePlanDesignSection`, `TrustDetailsSection`, `MaritalBypassTrustOptions`, `TrustBeneficiariesSection`, `PlanStructureFactsSection`.
- **Documents:** `WillProvisionsSection`, `WillPersonalRepresentativePowersSection`, `DpoaProvisionsSection`, `HealthCareDesignSection`.
- **Property:** `AssetsSection`, `TransfersAssignmentsSection`.
- **Other:** `CollegePrepSection`, `SigningMechanicsSection`, `GoalsSection`, `AdditionalVariablesSection`, `IntakeSection` (read-only snapshot plus re-sync), `ResiduarySection` (EP-LP only).

### 3.5 Readiness

`computeDesignSheetReadiness` (`lib/designSheetReadiness.ts`) returns a list of
items, each `{sectionId, label, targetField, category, blocking}`.

- **Categories:** `required`, `client-decision` or `approval`.
- **Blocking items:**
  - matter type (individual or couple)
  - client name
  - children when there are minors
  - `plan_type`
  - at least one document
  - joint vs separate trust
  - a primary fiduciary for every included document (and the spouse's when `spouse_docs`)
  - DPOA and health-care decisions
- **Non-blocking:** signing details.
- The essential layout hides some fields, and college prep has its own list.

Readiness drives the group badges, the "next group" button, `?focus=section:field`
deep links, and the hub's "setup" action.

### 3.6 Proposals: AI autofill and import

| Route | Input | LLM | Writes |
|---|---|---|---|
| `POST …/design-sheet/autofill` | open blockers, or pasted text | yes | nothing: returns `{proposed, preview, rejected, fiduciaries}` |
| `POST …/design-sheet/import-docx` | a prior plan DOCX (mammoth → text) | yes | nothing |
| `POST …/design-sheet/import-text` | text | yes | nothing |
| `POST …/design-sheet/apply-proposal` | accepted fields | no | yes, compare-and-swap; creates contacts and `matter_contacts` for new fiduciaries |

Autofill first runs a deterministic pass with no AI: computed defaults, the
attorney's saved preset, and a client→spouse mirror. It then asks the model
section by section, and only about open fields (`lib/designSheetCompletion/*`).
The provider is chosen per user (Anthropic, OpenAI or Gemini) by
`lib/llm/resolve.ts`.

### 3.7 Other design-sheet endpoints

- `GET …/design-sheet/export?format=json|json-docx|statular|summary|<default>`: generator data as JSON, the same JSON wrapped in Word, Statular Markdown, an internal Q&A summary, or (default) the rendered `design-summary` package.
- `POST …/design-sheet/clause-preview`: renders the clauses an unsaved sheet would produce.
- `GET/POST …/design-sheet/resync-intake`: per-field preview, then copy selected intake fields and clear their overrides.
- `POST/PATCH/DELETE …/design-sheet/contacts`: create, edit or detach people.
- `PATCH /api/admin/matters/[id]/plan-type`, `PATCH /api/admin/matters/[id]/matter-type`.
- `GET /api/admin/design-sheets/sources`: other matters whose plan structure can be cloned (`lib/designSheet/planStructureClone.ts`).

## 4. Drafting behaviour

### 4.1 Hub

`/admin/drafting` → RPC `drafting_hub_page(search, action, practice, sort, page, page_size)`
returns `{rows, total, page, pageSize, actionCounts, practiceCounts}`. Page
size is 50. The next action per matter (`lib/drafting/hubUtils.ts`):

```
stage = revision                   → revise
stage = client_review | drafts_approved → review
no design sheet                    → design
setup blockers or no documents     → setup
no drafts                          → generate
otherwise                          → review
```

A matter with no activity for 10 days is flagged as quiet.

### 4.2 Workspace

`/admin/drafting/[matterId]?step=design|generate|review` (`DraftingWorkspace.tsx`).

- Moving to Generate calls `flushAndSave()` first.
- Generation is blocked while a save conflict is open.
- Progress: Generate is complete when drafts exist. Review is complete when every current draft has `reviewed_at`.

### 4.3 Draft payload

`buildDraftPayload(matterId, options)` (`lib/draftPayload/assemble.ts`) is the
only input to rendering.

- Reads the matter, details, latest sheet, and matter contacts (to resolve slot `contact_id`s).
- Requires `hired` and a sheet unless `allowPartial` is set (quick draft uses it).
- Overlays computed defaults. `designSheetOverride` lets clause preview render unsaved edits.
- **The sheet is the source of truth for identity, not intake.**
- Output `DraftPayload` (`lib/draftPayload/types.ts`):
  - parties: `matter`, `client`, `spouse`, `marriage`, `children`, `family_provisions`, `settlor_facts`
  - trust: `trust`, `trust_provisions`
  - fiduciaries: `fiduciaries` (+ `_display`, `_details`), `excluded_guardians`
  - `documents.include_*`: which documents to draft, from `deriveDocuments()`
  - provisions: `will_provisions`, `dpoa_provisions`, `hcp_provisions`, `hipaa_provisions`, `healthcare_provisions`
  - college prep: `ferpa_release`, `will_cp`, `college_prep`
  - property: `assets`, `funding_plan`, `homestead`
  - signing: `execution`, `execution_mechanics`
  - `extras`
  - notes: `goals_notes`, `concerns`, `notes`

`toEstateGeneratorData` (`packages/drafting-engine/src/estateGenerator/toGeneratorData.ts`)
reshapes the payload into the template namespaces: `client`, `spouse`, `trust`,
`will`, `pour_over`, `dpoa`, `healthcare`, `hipaa`, `guardians`, `assets`,
`execution`, `extras`, and so on. Empty groups are dropped so that
`{% if trust.marital_trust %}` stays false. The field dictionary is
`tools/aubreylaw-docgeneration/schemas/` plus `docs/*-placeholder-map.md`.

### 4.4 Package selection

`deriveEstateGeneratorPackages(payload)` maps the `include_*` flags to package
manifests in `tools/aubreylaw-docgeneration/packages/*.json`. Each manifest is
`{name, description, required_fields[], documents:[{id,title,template,output}]}`.

| Plan | Packages |
|---|---|
| Trust | `joint-trust` / `joint-trust-simplified`, `indv-disclaimer-trust`, or `trust-individual-single` |
| Wills | `simple-will`, `pourover-will`, `testamentary-trust-will` (+ `spouse-*` when `spouse_docs`) |
| Incapacity | `incapacity-documents` (+ `spouse-incapacity-documents`); college track: `college-financial-poa`, `college-education-poa`, `college-health-care-documents`, `college-advance-directive` |
| Ancillary | `personal-property-memorandum`, `parental-guardian-appointment`, `temporary-delegation-parental-powers`, `certificate-of-trust`, `assignment-of-personal-property`, `funding-instructions`, `trust-funding-plan`, `homestead-trustee`, `young-adult-estate-plan` (one per eligible child), `ferpa-release`, `will-cp` |
| Always | `estate-plan-summary` (unless turned off) |

Deeds and trustee certificates come from `lib/realEstateTransfer` and are
appended to the run.

### 4.5 Rendering

For each package:

1. Build the context: package data, plus a spouse-as-client swap for `spouse-*` packages, defaults, and `states/<ST>/rules.json`.
2. For each document, resolve the template: a published override from `document_template_publications` (bytes in the `document-template-versions` bucket, sha256-checked) if one exists, otherwise the bundled DOCX.
3. Preprocess each `word/*.xml` part:
   - hoist `{%tr %}` row controls
   - move paragraph-level `if`/`endif` outside `<w:p>` so a false block leaves no blank line
   - strip control-only paragraphs
   - re-join tags Word split across runs
4. Render with Nunjucks.
   - Filters: `name`, `NAME`, `orMissing`, `optional`.
   - Global: `include_clause(id)`.
   - Simple `{{ path }}` expressions become `orMissing("path")`, so an empty value renders as `[[ MISSING: path ]]` instead of throwing.
5. Replace static markers (`[CLIENT FULL NAME]`, `[TRUST NAME]`).
6. Apply the style set: the firm default `style_sets` row, or the built-in default.
7. Record per file: owner, title, template id/version/sha, clause source and clause manifest.

**Clauses** (`include_clause`, `packages/drafting-engine/src/estateGenerator/node/clauses.ts`):

- A clause is skipped when:
  - its document type doesn't match
  - its `condition` field is falsy (unless a matter override forces it in)
  - a `force_omit` override applies
- Nested includes work.
- Overrides can target only conditional clauses.
- The clause source is chosen by `ESTATE_CLAUSE_SOURCE`:
  - `file`: the corpus JSON.
  - `database`: RPC `load_estate_clause_generation_snapshot`, which returns published revisions plus this matter's applied overrides.

### 4.6 Preflight

`GET /api/admin/matters/[id]/draft/preflight` returns
`{documentsToGenerate:[{packageName,title,filename}], missingFields, warnings, canGenerate, sourceRevision}`.

- **Missing fields don't block.** They are listed (attributed to client, spouse or young adult) and mapped to design-sheet "Fix" links (`lib/estateGenerator/missingFieldDesignMap.ts`).
- **Blocking:**
  - no packages
  - a missing manifest
  - a missing template file
  - a published override that can't be resolved
- `sourceRevision` = sha256 of the canonical JSON of the payload, the sheet row (minus workflow columns), contacts, the clause snapshot and doc selections (`lib/drafting/sourceSnapshot.ts`).

### 4.7 Generation request

`POST /api/admin/matters/[id]/draft`

```jsonc
{ "documents": ["<packageName>/<docId>", ...], "mode": "save" | "download", "runId": "uuid", "sourceRevision": "sha256" }
```

1. Rebuild the snapshot. If its revision differs from `sourceRevision`, return **409 `SOURCE_CHANGED`**.
2. In save mode, claim the run: RPC `claim_draft_generation_run`.
   - Per-matter advisory lock.
   - The same `runId` with the same request hash returns the existing run: 200 if completed, 202 if running.
   - Another live run on the matter is refused.
   - Expired runs are marked failed.
   - The new run gets a 6-minute lease and a worker token.
3. Render (§4.5) and filter to the selected documents.
4. **Download mode**:
   - Respond with a ZIP of the DOCX files plus `clause-manifest.json`.
   - Metadata goes in the `X-Draft-Meta` header (base64 JSON).
   - The browser caches the ZIP in `sessionStorage` (up to 12 MB).
5. **Save mode**, for each file:
   1. Name it `YYYY-MM-DD_Owner_Title.docx` (date in America/New_York).
   2. Scan for markers (`[TODO:`, `[[ MISSING ]]`, leftover `{{ }}`/`{% %}`/`[ALLCAPS]`).
   3. Upload to R2 at `matters/<id>/draft-runs/<run>/<worker>/<file>` with a presigned PUT.
   4. Register it:
      - With a database clause source: RPC `persist_generated_estate_document` inserts the document, version 1 and the clause-revision manifest atomically.
      - Otherwise: insert into `matter_documents`, then `ensureInitialVersion`.
   5. The `guard_draft_run_output` trigger refuses the insert if the lease has expired or the worker token doesn't match.
   6. Record each file's outcome in the run.
6. After the run:
   - **Supersede.** A full-set run supersedes all earlier firm drafts. A subset run supersedes only drafts with the same owner and title. Superseded files stay in R2.
   - Set `matters.stage = 'drafting'`.
   - Return per-document reports.
7. `GET …/draft` returns the latest run (with the worker token stripped) and `draft_generation_metrics`. While a run is going the browser polls this every 2 s. A response lost mid-run is recovered from the `(generation_id, draft_run_output)` unique index.

### 4.8 Review

Review works on current (not superseded) drafts.

| Action | Endpoint | Rule |
|---|---|---|
| Open | `GET /api/documents/[id]` | Signed URL plus `reviewRevision` |
| Eligibility | `GET /api/documents/[id]/review` | Re-reads the current R2 bytes and refuses sharing while any `MISSING` marker remains. For PDFs it uses the recorded `missing_count` |
| Mark reviewed | `PATCH /api/documents/[id] {reviewed, reviewRevision}` | Pinned to the revision that was opened. A newer version invalidates the review |
| Share | `PATCH /api/documents/[id] {shared:true}` | The share gate is rechecked on the server. Sets `shared_at`, so the client portal can see it (RLS) |
| Convert | `POST /api/documents/[id]/convert-pdf` | DOCX → PDF through the LibreOffice worker |
| Versions / preview / DOCX | `GET /api/documents/[id]/{versions,preview,docx}` | |

### 4.9 Quick draft

`GET/POST /api/admin/matters/[id]/quick-draft` with
`{templateId, overrides, mode: analyze|download|save}`.

- Renders one template from a partial payload.
- Overrides are dot-paths restricted to an allow-list of roots (`client`, `spouse`, `trust`, …), and `__proto__` is blocked.
- Saved answers go in `decisions.quick_draft[templateId]`.
- Custom templates (`custom-<uuid>`) are uploaded DOCX files (≤15 MB) stored in `document-template-versions/custom/`.

**Differences from a full run:** quick draft uses the bundled clause snapshot
(no database clauses or matter overrides) and the built-in style set.

### 4.10 Clause library and overrides

- **Lifecycle:** working draft → submitted revision (immutable) → published (one current publication per clause) → retired or reverted. Every step is an RPC that checks the actor is an attorney or admin and takes advisory locks (`schema.sql`, `lib/estateClauses/*`).
- **Matter overrides:** `PUT/DELETE /api/admin/matters/[id]/estate-clause-overrides {clauseKey, action: force_include|force_omit, reason}`.
  - The reason must be at least 10 characters.
  - The override is pinned to the current publication.
  - Only conditional clauses that a selected template references can be overridden.

### 4.11 Template overrides and style sets

- **Template overrides:**
  1. Upload a DOCX for a registry template id.
  2. Validate it against a chosen matter; this renders it and reports unresolved markers.
  3. Publish (admin; the confirmation text must equal the template id), or roll back. Cancelled uploads are removed from storage.
- **Style sets:**
  - Settings are fonts, body, title, numbering and page, each of which can be `preserve`.
  - One default set.
  - A set can be extracted from an uploaded DOCX.
  - The set is applied to every rendered document part.

## 5. Invariants

These are what the tests and the database protect. A port must keep them.

1. **Deterministic drafting.** The same sheet, contacts, clause snapshot and templates produce the same documents. No LLM on the default path.
2. **Missing is visible.** An empty value renders as `[[ MISSING: path ]]`, never a blank. A document with a marker cannot be shared.
3. **No lost edits.** Design-sheet saves are compare-and-swap on `updated_at`. Conflicts are resolved explicitly, never by last-write-wins. Local edits survive a reload through `sessionStorage`.
4. **Generation matches the preview.** The run is refused if the source changed since preflight (`sourceRevision`).
5. **One run at a time per matter, idempotent per `runId`.** Output is accepted only under a live lease from the worker that owns it.
6. **Provenance.** Every saved draft records engine, template id/version/sha, marker and missing counts, and (for database clauses) the exact clause revisions used.
7. **Supersede, don't delete.** Old drafts are marked superseded and stay retrievable.
8. **Review is pinned** to the revision that was read.
9. **Service role only.** Drafting RPCs cannot be called from the browser. Clients see only their own matter's sheet and shared documents (RLS).
10. **Proposals never write.** AI output is a proposal until staff accept it through `apply-proposal`.

## 6. Security

- Every route is guarded with `requireAdmin` (bearer token, `users.role` attorney/admin). Pages use `requireStaffPage`.
- All writes go through the service-role client. RLS is enabled on every table. `schema.sql` restates the exact grants: RPCs are executable by `service_role` only, and `ensure_user_profile` also by `authenticated`.
- User text sent to a model is quoted and wrapped with `PROMPT_INJECTION_GUARDRAIL` (`@aubrey-law/citations/prompt`).
- Uploaded DOCX files are validated by structure and extension, and are size-capped.
- Template bytes are sha256-checked when resolved.
- `rate_limit_consume` throttles the clause AI drafting route.
- Quick-draft overrides are allow-listed by root key, and prototype keys are rejected.

## 7. Non-functional

- `/api/admin/matters/[id]/draft` has `maxDuration = 300` s. A typical full trust plan is a few dozen DOCX files rendered in-process.
- Templates are read from disk at runtime. The server needs the corpus in its file trace (README "Next.js configuration"), or `ESTATE_GENERATOR_ROOT` pointing at it.
- The legacy engine (`ESTATE_GENERATOR_ENGINE=supabase`) and the LLM fallback (`ESTATE_DRAFT_LLM_FALLBACK_ENABLED`) are off by default and can be removed.

## 8. Extending

- **New template variable:** add it to `decisions.extras` from the design sheet (no code), or add a field to the payload (`lib/draftPayload/*`) and to `toEstateGeneratorData`. Then document it in `schemas/data-dictionary.json`. The bundled Claude Code skill `.claude/skills/aubreylaw-doc-templates/` describes the template conventions and QA checklist.
- **New document:** add a DOCX under `templates/`, a manifest under `packages/`, and an inclusion rule in `deriveEstateGeneratorPackages`. Then add an example payload under `examples/` and render it with `npm run estate:render -- --package <name> --example <file> --out <dir>`.
- **New state:**
  - add `states/<ST>/rules.json` and clauses
  - write state-appropriate templates
  - relax the `estate_clauses.jurisdiction = 'MA'` check
  - extend `estateClauses/source.ts`, which currently supports MA only
