# Build plan: design sheet & drafting in a new app

The goal is to bring a working, already-tested feature into a new Next.js +
Supabase app with as few behavior changes as possible. Most of the work is at
the edges: auth, the host data model, storage and branding. The engine, payload
builder and design-sheet logic move as they are.

Each phase ends in something you can run and check. Commit at the end of each
phase and keep lint, typecheck and tests green. Phases 1–5 are the core and must
be done in order. Phases 6–9 can each be done or skipped on its own.

```
0 Decide ─► 1 Schema ─► 2 Infra ─► 3 Engine ─► 4 Design sheet ─► 5 Generate + Review  ← usable product
                                                       │
                                                       ├─► 6 Hub + Quick draft
                                                       ├─► 7 Admin: clauses, template overrides, style sets
                                                       ├─► 8 AI assist (autofill / import)
                                                       └─► 9 Real-estate transfer docs
                                                    10 Branding, deploy, end-to-end  (last)
```

## Phase 0: Decisions (before any code)

Answer these first. Each answer changes what the later phases do.

| # | Question | Default if undecided |
|---|---|---|
| D1 | What is a "matter" in the new app (case, engagement, client file)? What is its id? | A `matters` table as in `schema.sql` |
| D2 | Where do client identity and the intake questionnaire live? Does the app have something like `client_intake`? | Seed the sheet from whatever intake exists. If there is none, start from a blank sheet (`buildInitialSheet`) |
| D3 | How are people (spouse, children, fiduciaries) stored? | `contacts` + `matter_contacts`, as bundled |
| D4 | How are staff and clients told apart? | `users.role` in (`attorney`, `admin`) = staff |
| D5 | Which surfaces are in scope? Hub, quick draft, clause library, template overrides, style sets, AI assist, real-estate transfer, client portal sharing | Core (phases 1–5) only, then add phases one at a time |
| D6 | Jurisdiction and templates: use the bundled Massachusetts forms as they are, or swap in the new firm's own? | Bundled MA forms, rebranded |
| D7 | File storage for drafts: Cloudflare R2 (bundled), or S3 / Supabase Storage? | R2. `lib/r2.ts` is the only S3 client to change |
| D8 | Clause source: bundled JSON (`file`) or the database library (`database`)? | `file`. Move to `database` in phase 7 if needed |
| D9 | Which LLM provider, if any? | None. The core flow uses no AI |

**Output:** a short decision record in the new repo, and a column map from each
host-contract table (README, "Host contract") to the new app's tables.

## Phase 1: Schema

1. Turn `schema.sql` into a migration in the new app's format.
   - **Section 1 (host contract):** if D1–D4 point at existing tables, do not create Cornerstone's copies. Change the foreign keys in sections 2–4 to point at the app's tables, and give drafting a compatibility view or columns where names differ. The two views that matter most are `v_matter_pipeline`, read by the hub and the clone-plan picker, and `matter_details.practice_area`.
   - **Sections 2–4** go in unchanged, except for renames that D1 forces.
   - **Keep the "Privileges (explicit)" block.** Without it Supabase's default privileges make every drafting RPC callable from the browser.
2. Apply it locally. Regenerate DB types and replace `packages/db-types` (or point `types/supabase.ts` at the app's generated types).
3. Seed: `npm run styleSets:seed`.

**Done when:**
- The migration applies to a fresh local database.
- `select has_function_privilege('authenticated','public.claim_draft_generation_run(uuid,uuid,uuid,text,text,text[],uuid)','execute')` returns `false`.
- Inserting two `design_sheets` rows with the same `(matter_id, version)` fails.
- The tests that read `supabase/migrations/*` are either pointed at the new migration or deleted along with the files they check.

## Phase 2: Infrastructure adapters

Point each of these at the new app's own version. Use the bundle's copy only
when the app has nothing equivalent.

| Bundle file | Contract to keep |
|---|---|
| `lib/supabaseAdmin.ts`, `lib/supabaseServer.ts`, `lib/supabaseBrowser.ts` | `getAdminClient()` is the service-role client; `getCachedClaims()` / `getCachedUserRole()` |
| `lib/apiAuth.ts` | `requireAdmin(req) → { err, userId, user }`, where `err` is a ready `NextResponse` |
| `lib/review/staff.ts` | `requireStaffPage() → { userId }`; redirects otherwise |
| `lib/auth/AuthTokenProvider.tsx` | `useAccessToken()` for browser `fetch` bearer headers. Mount the provider above the drafting pages |
| `lib/r2.ts` | Presigned PUT/GET, delete, bucket name (D7) |
| `components/ui/*`, `lib/utils.ts` (`cn`) | Use the app's shadcn components if it has them; delete the bundled copies |
| `lib/firmDate.ts` | Firm time zone for draft file names |
| `app/admin/drafting/[matterId]/layout.tsx` | Wrap in the app's record shell. Pass `embeddedInWorkspace` to `DraftingWorkspace` when the shell has a header |

**Done when:** the app builds with the bundle's `lib/` in place, and an
unauthenticated request to any `/api/admin/matters/[id]/design-sheet` route
returns 401 (403 for a client user).

## Phase 3: Engine and template corpus

1. Add `packages/drafting-engine`, `packages/estate-fields`, `packages/citations` (trimmed) and `tools/aubreylaw-docgeneration` as workspaces, or as folders with path aliases.
2. In `next.config`: add `transpilePackages`, and add `outputFileTracingIncludes` for every route that renders (README, "Next.js configuration").
3. Prove rendering works without the database:

   ```bash
   npm run estate:render -- --package joint-trust --example tools/aubreylaw-docgeneration/examples/client-ma-joint-trust.json --out /tmp/render
   ```

4. Move the engine tests: `node-estate-generator`, `estate-generator`, `docx-template-integrity`, `template-xml-well-formed`, `style-set-*`, `draft-marker-scan`, `template-variable-catalog`.

**Done when:**
- Those tests pass.
- The rendered joint trust opens in Word with no `[[ MISSING` and no `{{`.

## Phase 4: Design sheet

Order inside the phase: data layer → API → UI.

1. **Data layer:**
   - `lib/designSheet*`, `lib/designSheet/*`, `lib/draftPayload/*`, `lib/buildDraftPayload.ts`, `lib/contacts/*`, `lib/queries/matterCore.ts`, `lib/intakeSeed.ts`, `lib/intakePlanType.ts`, `lib/collegePrepDesign.ts`, `types/database.ts`.
   - Adapt `seedFromIntake.ts` to D2.
   - Check `WRITABLE_DESIGN_SHEET_COLUMNS` against the real table. This is the most common way to break saves.
2. **Context loader:** `loadDraftingMatterContext.ts`.
   - Drop the SLA resync call (already a stub).
   - Adapt the `relationship_status = 'hired'` gate to the app's equivalent of an active client.
   - Adapt the practice-area 404s.
3. **API:**
   - `GET/PATCH /api/admin/matters/[id]/design-sheet`, `…/contacts`, `…/resync-intake`, `…/export`, `…/clause-preview`.
   - `/api/admin/matters/[id]/plan-type`, `…/matter-type`.
   - `/api/admin/design-sheets/sources`.
4. **UI:**
   - `app/admin/drafting/[matterId]/design/**`, `components/design-sheet/*`, `components/guided/*`, `app/intake/guided.css`.
   - Map theme tokens (`text-micro`, `text-compact`) into the app's Tailwind config.
5. **Tests:** every `design-sheet-*`, `design-plan-type`, `apply-design-plan-type`, `build-draft-payload`, `draft-payload-*`, `fiduciary-*`, `project-design-sheet` and `statular-export` test.

**Done when:**
- In two browser tabs on the same matter, an edit in tab A autosaves.
- Editing in tab B then opens the conflict dialog instead of overwriting.
- Reloading mid-edit restores unsaved changes.
- Readiness lists the right blockers for an empty sheet.

## Phase 5: Generate and review (core complete)

1. **Generate:**
   - `GET …/draft/preflight`, `GET/POST …/draft`.
   - `lib/drafting/{runStore,runState,sourceSnapshot,persistGeneratedDocument,supersede,buildDraftDownloadZip,draftDownloadMeta,draftDownloadCache}.ts`.
   - `GenerateStep.tsx`, `components/drafting/DraftRunStatus.tsx`.
2. **Review:**
   - `/api/documents/[id]` (GET/PATCH/DELETE), `…/review`, `…/preview`, `…/docx`, `…/versions`, `…/convert-pdf`.
   - `lib/documents/shareGate.ts`, `ReviewStep.tsx`, `components/documents/*`.
3. **Remove or build** each UI call listed in README "UI calls with no route". The usual choice:
   - Hide the assistant, tabular review, redline and signature panels.
   - Keep "upload shared PDF" only if the app has a client document upload.
4. **Workspace shell:**
   - `DraftingWorkspace.tsx` and `app/admin/drafting/[matterId]/page.tsx`.
   - `lib/matterActivity.ts`: point at the app's activity log, or make it a no-op.
5. **PDF conversion (optional):** deploy `tools/docx-pdf-worker` (Fly.io or Railway) and set `DOCX_PDF_CONVERT_URL` / `DOCX_PDF_CONVERT_SECRET`.
6. **Client notice:** `lib/portalNotifications.ts`. Wire it to the app's notifications if sharing should email the client.
7. **Tests:** `draft-*`, `drafting-*` (except hub), `document-version-*`, `edit-protocol`, `estate-clause-provenance`.

**Done when**, on one test matter:
- Preflight lists documents and missing fields.
- Download gives a ZIP.
- Save puts files in storage and rows in `matter_documents` / `document_versions`.
- Double-clicking Generate produces one set, not two.
- Editing the sheet between preflight and generate returns `SOURCE_CHANGED`.
- A document with a `MISSING` marker cannot be shared.
- Mark reviewed works, and a second full run supersedes the first set.

## Phase 6: Hub and quick draft

- **Hub:**
  - `app/admin/drafting/page.tsx`, `DraftingHubClient`, `MatterPipelineTable`, `SavedDraftingViews`, `lib/queries/drafting.ts`, `lib/drafting/hub*.ts`.
  - The `drafting_hub_page` RPC reads `v_matter_pipeline`, `matters.stage` and `matter_details.practice_area`. Re-point it at the app's tables (D1).
- **Quick draft:**
  - `app/admin/drafting/[matterId]/quick/**`, `…/quick-draft` routes, `lib/drafting/quickDraft.ts`, `lib/documentTemplates/customTemplates.ts`.
  - Needs the `document-template-versions` bucket.
- **Tests:** `drafting-hub*`, `saved-drafting-views`, `quick-draft*`, `custom-templates`. For `drafting-hub-sql`, build a database from the migration and run with `VITEST_HUB_SQL_TEST_CONTAINER=<container>`.

**Done when:**
- The hub shows each hired matter's next action, and its counts match the matters.
- A quick draft of the pour-over will downloads, and saves with `generation_engine = 'quick-draft'`.

## Phase 7: Admin — clause library, template overrides, style sets

- **Clauses:**
  - `app/admin/settings/estate-clauses/**`, `/api/admin/settings/estate-clauses/**`, `/api/admin/matters/[id]/estate-clause-overrides`, `ClauseOverridesPanel.tsx`.
  - Import with `ESTATE_CLAUSE_IMPORT_ACTOR_ID=… npm run clauses:import`, publish each clause, then set `ESTATE_CLAUSE_SOURCE=database`.
- **Template overrides:** `app/admin/settings/DocumentTemplatesSection.tsx`, `/api/admin/settings/document-templates/**`. Mount the section on the app's settings page.
- **Style sets:** `app/admin/settings/style-sets/**`, `/api/admin/style-sets/**`.
- **Tests:** `estate-clause-*`, `document-template-workflow`, `style-set-*`.

**Done when:**
- With `ESTATE_CLAUSE_SOURCE=database`, a published clause edit shows up in the next generated document, and the saved document lists that revision in `generated_document_clause_revisions`.
- A published template override is used by the next run.
- Changing the default style set changes the font of the next run.

## Phase 8: AI assist (optional)

`…/design-sheet/{autofill,import-docx,import-text,apply-proposal}`,
`lib/designSheetCompletion/*`, `lib/designSheetImport/*`, `lib/llm/*`,
`lib/anthropic.ts`, `lib/aiUsage.ts`, `DesignSheetImportDialog`.

- Pick one provider (D9) and set its key.
- `lib/designSheetCompletion/context.ts` reads `matter_notes`, `lead_meeting_notes` and `asset_intake`. Point it at the app's notes, or drop those inputs.
- Keep the guardrail wrapping (`PROMPT_INJECTION_GUARDRAIL`, `quoteUserContent`).
- Leave the LLM fallback generator (`/api/drafting*`, `ESTATE_DRAFT_LLM_FALLBACK_ENABLED`) off, or delete it.

**Done when:**
- Autofill on a sheet with notes returns a proposal and writes nothing.
- Accepting it writes through `apply-proposal` with the conflict check.
- `ai_usage` records the call.

## Phase 9: Real-estate transfer (optional)

`app/admin/drafting/real-estate-transfer/page.tsx`,
`/api/drafting/real-estate-transfer/{extract,generate}`,
`lib/realEstateTransfer/*`, `lib/designSheetRealEstateTransfer.ts`. These
render deeds and trust certificates. They also run inside a full generation
when `document_inclusions.deed` is on.

**Done when:** `realEstateTransfer` and `designSheetRealEstateTransfer` tests pass, and a deed renders from a test matter.

## Phase 10: Branding, deploy, end-to-end

1. **Branding pass:**
   - Code strings and templates (README, "Branding").
   - Open every DOCX in `templates/` and check firm name, attorney, letterhead and governing-law language.
   - If D6 is "own templates", follow `.claude/skills/aubreylaw-doc-templates/` for each new master.
2. **Env:** add every variable from the README table to `.env.example`, with a comment for each.
3. **Deploy a preview:**
   - Run one full generation, one quick draft and one design-summary export there.
   - Any `No registered template …` error means a missing `outputFileTracingIncludes` entry.
4. **Final checks:**
   - `grep -rn "HOST ADAPTER" .` lists only no-ops you chose to keep.
   - Every `.from('…')` in the moved code names a table that exists.

**Done when:** lint, typecheck and the full test suite pass, and the phase 5 walkthrough works on the preview deployment.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `WRITABLE_DESIGN_SHEET_COLUMNS` doesn't match the table, and every save fails | Phase 4 check. Keep the `design-sheet-*` persistence tests |
| Template files missing from the serverless bundle | `outputFileTracingIncludes`; check on a preview deploy (phase 10) |
| RPCs exposed to `authenticated` | Keep the explicit privileges block. The phase 1 check |
| Host model differs a lot (no intake, no contacts) | Phase 0 column map. Seed from what exists; fiduciaries need some person table with ids |
| Bundled templates are MA-specific and branded | D6 and the phase 10 review before any client sees output |
| Some writers skip the compare-and-swap (intake re-sync, plan-track reconcile, defaults-on-load) | Keep them as they are; they are idempotent. Don't add new writers that skip it |
| `packages/db-types` describes Cornerstone's whole schema | Regenerate in phase 1 |

## Rough effort

| Phase | Size |
|---|---|
| 0 Decide | Small. A conversation and a column map |
| 1 Schema | Small–medium. More if host tables must be mapped |
| 2 Infra | Small |
| 3 Engine | Small. The code lifts as-is |
| 4 Design sheet | Medium–large. Most host coupling (intake, contacts) is here |
| 5 Generate + review | Medium |
| 6–9 | Small–medium each |
| 10 Branding/deploy | Small for code. The template review depends on how many forms change |
