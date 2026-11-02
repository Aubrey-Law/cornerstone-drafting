# Design sheet & drafting — extracted from Cornerstone

This folder holds Cornerstone's estate-planning **design sheet** and **document
drafting** feature, copied out so another Next.js + Supabase app can adopt it.

| Item | Contents |
|---|---|
| `SPEC.md` | What the feature does and how it works: data model, flows, API contract, invariants |
| `BUILD_PLAN.md` | Phased plan for standing it up in the new app, with acceptance checks per phase |
| `PROMPT.md` | Prompt to paste into Claude Code (or another agent) working in the new app |
| `schema.sql` | One file that creates every table, function, trigger, policy and grant the code needs |
| `source/` | 945 files (~119k lines of TS/TSX plus the DOCX template corpus). Paths match a Next.js App Router root with the `@/*` alias |
| `source/.claude/skills/aubreylaw-doc-templates/` | Cornerstone's Claude Code skill for authoring and QA-ing templates, clauses and package manifests |
| `source/tests/` | 158 test files (1,531 passing tests) that run against this bundle |

Read `SPEC.md` first if you want to understand the feature. Read this file
before you move any code.

## What it does

- **Drafting hub** (`/admin/drafting`): every hired matter with its next drafting action (design, setup, generate, review, revise), search, practice-area facets and saved views. Backed by one Postgres RPC, `drafting_hub_page`.
- **Drafting workspace** (`/admin/drafting/[matterId]`): three steps, **Design → Generate → Review**, in the URL as `?step=`.
- **Design sheet**: a long, sectioned interview form that records every decision a will, trust, POA, health-care proxy, HIPAA release, deed or college-prep package needs. It is seeded from the client's intake, autosaves every few seconds with optimistic concurrency, keeps an edit draft in `sessionStorage`, resolves save conflicts field by field, and shows blockers ("readiness") per section.
- **Optional AI help on the sheet**: autofill open fields from the matter's notes, or import a prior plan (DOCX or pasted text). Both return a *proposal*; nothing is written until staff accept it.
- **Generate**: a preflight lists the documents the sheet implies and the fields still missing. Generation renders DOCX files from Word templates with Nunjucks tags (`{{ client.full_name | name }}`, `{% if trust.marital_trust %}`). It is deterministic: **no LLM is involved by default**. Missing values render as visible `[[ MISSING: path ]]` holes rather than failing. Runs are idempotent and leased, so a double-click or a retry never produces two sets.
- **Output**: download as a ZIP, or save to the matter. Saved drafts go to Cloudflare R2, with a `matter_documents` row, a first `document_versions` row and (when clauses come from the database) a record of exactly which clause revisions went into each document. A new full run supersedes the previous set.
- **Review**: open each draft, mark it reviewed (pinned to the revision you read), convert to PDF, and share it with the client. Sharing is refused while the file still contains a `MISSING` marker.
- **Quick draft** (`/admin/drafting/[matterId]/quick`): render one template for a matter, with per-field overrides, without the full run. Staff can upload their own DOCX as a custom template.
- **Clause library** (settings): clauses are versioned, reviewed and published in the database; matters can force a conditional clause in or out with a reason.
- **Template overrides** (settings): upload a replacement DOCX master for any bundled template, validate it against a real matter, publish it, roll it back.
- **Style sets** (settings): firm typography (fonts, sizes, spacing, numbering, page setup) applied to every generated document. Can be extracted from an uploaded DOCX.
- **Real estate transfer** (`/admin/drafting/real-estate-transfer`): deeds and trust certificates, generated from the design sheet or a standalone form.

The bundled templates and clause library are **Massachusetts** estate-planning
forms. The clause tables only accept `jurisdiction = 'MA'`. Another state means
new templates, clauses and `states/<ST>/rules.json`; see `SPEC.md` §8.

## How the pieces connect

```
/admin/drafting  ──► DraftingHubClient ──► lib/queries/drafting.ts ──► RPC drafting_hub_page
/admin/drafting/[matterId]
   layout.tsx (staff guard)                        page.tsx ──► loadDraftingMatterContext
   DraftingWorkspace  ?step=design|generate|review       (seed sheet from intake, defaults, plan track)
   │
   ├─ Design ─► DesignSheetPage ─► useDesignSheetState (autosave, sessionStorage draft, conflicts)
   │      PATCH/GET /api/admin/matters/[id]/design-sheet            (CAS on updated_at → 409)
   │      POST …/design-sheet/{autofill,import-docx,import-text}    (LLM → proposal only)
   │      POST …/design-sheet/apply-proposal                        (single writer for proposals)
   │      GET  …/design-sheet/export?format=…  POST …/clause-preview  GET/POST …/resync-intake
   │      POST/PATCH/DELETE …/design-sheet/contacts   PATCH …/plan-type  PATCH …/matter-type
   │
   ├─ Generate ─► GenerateStep
   │      GET  /api/admin/matters/[id]/draft/preflight  → documents, missing fields, sourceRevision
   │      POST /api/admin/matters/[id]/draft {documents, mode:'save'|'download', runId, sourceRevision}
   │           ├─ loadDraftSourceSnapshot → buildDraftPayload (lib/draftPayload/*) → sha256 revision
   │           ├─ RPC claim_draft_generation_run (advisory lock, 6-min lease, idempotent by runId)
   │           ├─ @aubrey-law/drafting-engine: deriveEstateGeneratorPackages → toEstateGeneratorData
   │           │     → per package manifest → per DOCX: template resolver (published override | bundled)
   │           │     → Nunjucks render + include_clause() → style set
   │           ├─ save: marker scan → R2 PUT → RPC persist_generated_estate_document
   │           │        (or matter_documents insert + ensureInitialVersion) → supersede old set
   │           └─ download: ZIP + clause-manifest.json, meta in X-Draft-Meta header
   │      GET  /api/admin/matters/[id]/draft  → run status + RPC draft_generation_metrics
   │
   └─ Review ─► ReviewStep
          GET/PATCH/DELETE /api/documents/[id]   (signed URL, reviewed, shared)
          GET /api/documents/[id]/review          (share gate: rescans R2 bytes for MISSING)
          POST /api/documents/[id]/convert-pdf    (DOCX_PDF_CONVERT_URL → tools/docx-pdf-worker)
          GET /api/documents/[id]/{preview,docx,versions}

Quick draft   ─► GET/POST /api/admin/matters/[id]/quick-draft, /api/admin/quick-draft/custom-templates
Clauses       ─► /api/admin/settings/estate-clauses/**, PUT/DELETE /api/admin/matters/[id]/estate-clause-overrides
Templates     ─► /api/admin/settings/document-templates/**   (Storage bucket document-template-versions)
Style sets    ─► /admin/settings/style-sets, /api/admin/style-sets/**
```

### Package layout

The rendering engine is already split out of the app:

| Path | npm name | What it is |
|---|---|---|
| `source/packages/drafting-engine` | `@aubrey-law/drafting-engine` | Pure generation: Nunjucks-over-DOCX, clause store, style sets, tracked changes, marker scanning. No database, storage or framework. |
| `source/tools/aubreylaw-docgeneration` | `@aubrey-law/estate-templates` | Data only: 30 package manifests, 39 DOCX templates, 22 clause JSON files, MA rules, field schemas, examples |
| `source/packages/estate-fields` | `@aubrey-law/estate-fields` | Shared field registry (labels, options, normalizers) for intake and the design sheet |
| `source/packages/ui` | `@aubrey-law/ui` | Theme tokens and a few shared components |
| `source/packages/db-types` | `@aubrey-law/db-types` | Generated Supabase types for **all of Cornerstone's** tables. Regenerate against the new database |
| `source/packages/citations` | `@aubrey-law/citations` | Trimmed to `./prompt` (prompt-injection guardrail helpers used by `lib/anthropic.ts`) |

Many files under `source/lib/drafting`, `lib/estateGenerator`, `lib/estateClauses`,
`lib/styleSets` and `lib/documentTemplates/{types,docx}.ts` are one-line
re-exports of the engine package. The app-side code that matters is
`lib/draftPayload/*`, `lib/designSheet*`, `lib/drafting/{runStore,sourceSnapshot,persistGeneratedDocument,supersede,quickDraft}.ts`
and the route handlers.

`source/packages/*` and `source/tools/aubreylaw-docgeneration` are npm
workspaces (see `source/package.json`). The new app can keep them as workspaces
or copy them into its own `packages/` folder; either way `next.config`
must list `@aubrey-law/drafting-engine` and `@aubrey-law/estate-fields` in
`transpilePackages`, because they ship TypeScript source.

## Seams: what was Cornerstone-specific

The bundle typechecks and its tests pass. Some code still assumes Cornerstone's
law-firm data model. There are four kinds of seam.

### 1. Stub files (`// HOST ADAPTER (stub)` at the top)

Same import paths, minimal bodies, so the core code compiles.

| Stub | What Cornerstone did there |
|---|---|
| `lib/slaTasks/generate.ts` | `resyncMatterSlaTemplate` re-checked the matter's service-level task checklist on every workspace load. Now a no-op |
| `lib/tasks/types.ts` | Task model. Only `ChecklistItem` is kept, for the design-sheet follow-up-task route |
| `lib/engagement/{templates,render,types}.ts` | Engagement-letter masters, which Cornerstone also lists in the template registry. Empty list; the preview path throws |
| `lib/esign/requestStatus.ts` | E-signature request types attached to document rows. Types only |
| `lib/billing/invoices.ts` | Invoice balance helper reached through the `lib/queries.ts` barrel. Pure helper kept |
| `lib/portalNotifications.ts` | Emailed the client when staff shared a document. No-op |

### 2. Trimmed files (`// EXTRACTED:` comment)

- `app/admin/drafting/[matterId]/layout.tsx`: Cornerstone wrapped drafting in its matter workspace shell (header, stage stepper, tabs, details panel). This version keeps the staff guard and the UUID check and renders the pages bare. `DraftingWorkspace` has an `embeddedInWorkspace` prop: pass it if the new app's record page supplies its own header.
- Some tests assert facts about Cornerstone files that are not in the bundle: the Word add-in, archived portal migrations, the settings Library, Tasks and Overview pages, `/auth` pages, repo docs, engagement masters. 18 such tests are skipped and one expectation is narrowed. Each has an `EXTRACTED` comment saying why.

### 3. Queries to host tables inside copied files

These copied files still query tables that the new app may not have. Point them
at the new app's equivalents or remove the code path.

| File | Tables | Purpose |
|---|---|---|
| `lib/designSheetCompletion/context.ts` | `matter_notes`, `lead_meeting_notes`, `asset_intake` | Context for AI autofill. Missing tables only weaken autofill |
| `lib/queries/matterCore.ts` | `matter_notes` | Notes on the intake snapshot |
| `lib/matterActivity.ts` | `matter_activity` | Activity log entries (`draft_generated`, `draft_promoted_to_review`) |
| `app/api/admin/matters/[id]/design-sheet/follow-up-task/route.ts` | `tasks` | "Create follow-up task" from open design-sheet items |
| `lib/queries/portal.ts`, `lib/queries/invoiceBalances.ts` | `messages`, `appointments`, `invoices`, `billing_*` | Reached only through the `lib/queries.ts` barrel; drafting does not call these functions. Delete them when you split the barrel |
| `lib/documentRequests/repository.ts`, `lib/documents/priorPlans.ts` | `document_requests`, `review_uploads` | Document-request and prior-plan helpers pulled in by `lib/documents.ts`; not on the drafting path |
| `lib/documentTemplates/validate.ts` | `engagement_agreements*` | Engagement-master preview. Unreachable with the stub registry |
| `lib/drafting/generateDocuments.ts` | Storage bucket `templates`, `doc_selections`, `draft_log` | Legacy engine (`ESTATE_GENERATOR_ENGINE=supabase`). Safe to delete if you stay on the default `node` engine |

### 4. UI calls with no route in the bundle

Some bundled components `fetch` routes that were deliberately left out because
they belong to other Cornerstone features. Remove the UI or build the route.

| Route | Called from | Cornerstone feature |
|---|---|---|
| `/api/documents/[id]/edits/**`, `/tracked-change-ids` | `components/documents/DocxViewerPanel.tsx` | AI redlines as Word tracked changes (the engine side, `editProtocol` + `docxTrackedChanges`, *is* bundled) |
| `/api/admin/matters/[id]/assistant`, `/api/admin/assistant/proposals` | `components/drafting/MatterAssistantPanel.tsx`, `app/admin/components/ChatMessage.tsx` | Matter chat assistant |
| `/api/admin/matters/[id]/tabular-reviews/**` | `components/drafting/TabularReviewSection.tsx` | Tabular document review |
| `/api/admin/matters/[id]/signature-requests/**` | `lib/documents.ts` | E-signature |
| `/api/admin/matters/[id]/stage` | `lib/drafting/updateMatterStage.ts` | Matter lifecycle (the draft route itself just sets `matters.stage = 'drafting'`) |
| `/api/documents` (list), `/upload`, `/combine`, `/bulk-download`, `/folders/**`, `/prior-plans`, `/api/admin/documents/audit` | `lib/documents.ts`, ReviewStep "upload shared PDF" | The matter Documents tab |
| `/api/admin/me/preferences` | `lib/userPreferencesClient.ts` | Per-user settings (LLM provider, attorney preset) |

## Host contract: what drafting needs from the new app

Drafting reads these host records. `schema.sql` contains Cornerstone's own
definitions (section 1); map the columns onto the new app's tables instead of
copying them if the app already has clients/cases.

| Concept | Cornerstone table | Columns drafting relies on |
|---|---|---|
| Staff user | `users` | `id` (= `auth.users.id`), `role` (`attorney`/`admin` are staff), `preferences` (LLM provider, attorney preset) |
| Case | `matters` | `id`, `client_intake_id`, `matter_number`, `matter_type` (`individual`/`couple`), `relationship_status` (drafting requires `'hired'`), `stage`, `status`, `client_id` (portal RLS) |
| Case details | `matter_details` (keyed by `client_id` = matter id) | `practice_area` (`EP`, `EP-LP`, `CP`; `Probate`/`TA` are excluded), `ep_*` |
| Questionnaire | `client_intake` | Names, contact, citizenship, marital status, `plan_type`, `intake_track`, `document_inclusions`, fiduciary slot arrays, college-prep answers. Used to seed and re-sync the sheet |
| People | `contacts` + `matter_contacts` | Fiduciary slots store `contact_id`. Children on the sheet are a projection of contacts |
| Pipeline view | `v_matter_pipeline` | Hub page, clone-plan source picker |

The full list of `client_intake` columns the seeder reads is in
`lib/designSheet/seedFromIntake.ts` (`buildIntakeSeedPayload`) and
`lib/intakeSeed.ts`.

**Auth.** Route handlers call `requireAdmin(req)` (`lib/apiAuth.ts`): a Supabase
bearer token whose `users.role` is `attorney` or `admin`. Pages call
`requireStaffPage()` (`lib/review/staff.ts`). Browser code sends the bearer
token via `useAccessToken()` from `lib/auth/AuthTokenProvider.tsx`, so staff
pages need that provider (or an equivalent) above them. All database writes go
through the service-role client (`lib/supabaseAdmin.ts`); the RPCs are
service-role only.

## Branding and firm-specific values

- **Templates.** The DOCX masters are Aubrey Law's own Massachusetts forms. 15 of the 63 DOCX files under `tools/aubreylaw-docgeneration` mention the firm (letterhead, design-summary worksheets, funding instructions, college-prep forms). Review every template before a client sees output.
- **Prompts.** `app/api/drafting/route.ts` (LLM fallback system prompt names the firm and attorney). `tools/workflows/system/assistant/*/SKILL.md` are the chat-assistant drafting interview prompts, included for reference only.
- **Code strings.** `lib/supabaseAdmin.ts` (`ADMIN_EMAIL` fallback), `lib/auth/ensureUserProfile.ts` (`FIRM_EMAIL_DOMAIN`), `components/guided/BrandBar.tsx` (logo `/aubrey-law-logo.svg`, which is not in the bundle, and alt text), `WillProvisionsSection.tsx` (helper copy), `lib/styleSets/seed.ts` and `packages/drafting-engine/src/styleSets/defaults.ts` ("Aubrey Law house style"), `packages/estate-fields/src/core/{goals,reviewDisplay}.ts` ("Why Aubrey Law").
- **Package names.** `@aubrey-law/*` and the `tools/aubreylaw-docgeneration` path. Renaming is optional; if you do, `lib/documentTemplates/registry.ts`, `preflight.ts`, `lib/realEstateTransfer/*`, `lib/drafting/quickDraft.ts` and `packages/drafting-engine/src/estateGenerator/runtime.ts` hard-code the path.
- **Time zone.** Draft file names use the date in `America/New_York` (`lib/firmDate.ts`).

Find them all with `grep -rniE "aubrey|needham" source/ --include=*.ts --include=*.tsx | grep -v "@aubrey-law"`.

## Environment variables

| Var | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Everything |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Saving drafts, review, PDFs, style-set source files. Download-as-ZIP works without them |
| `ESTATE_GENERATOR_ENGINE` | `node` (default) or `supabase` (legacy placeholder fill) |
| `ESTATE_GENERATOR_ROOT` | Optional absolute path to the template corpus if the server's cwd is not the app root |
| `ESTATE_CLAUSE_SOURCE` | `file` (default: clause JSON in the corpus) or `database` (published clause library + matter overrides) |
| `ESTATE_DRAFT_LLM_FALLBACK_ENABLED` | `true` turns on the LLM fallback generator. Off by default |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | Only the LLM fallback (it calls `/api/drafting` over HTTP) |
| `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`), `OPENAI_API_KEY`, `GEMINI_API_KEY` | AI autofill/import, clause AI drafting, LLM fallback. Any one provider is enough |
| `ANTHROPIC_MODEL_DRAFTING`, `ANTHROPIC_MODEL_LIGHT`, `ANTHROPIC_MODEL_ASSISTANT` | Optional model overrides (`lib/firmModels.ts`) |
| `USER_API_KEYS_ENCRYPTION_SECRET` | Only if staff store their own LLM keys (`user_api_keys`) |
| `DOCX_PDF_CONVERT_URL`, `DOCX_PDF_CONVERT_SECRET` | "Convert to PDF" in review. Deploy `source/tools/docx-pdf-worker` (LibreOffice). Without it the route returns 501 |
| `ADMIN_EMAIL` | Fallback admin address (`lib/supabaseAdmin.ts`) |

## Next.js configuration

```js
// next.config.mjs (additions)
transpilePackages: ['@aubrey-law/drafting-engine', '@aubrey-law/estate-fields'],
serverExternalPackages: ['pdf-parse', 'mammoth'],
outputFileTracingIncludes: {
  '/api/admin/matters/[id]/draft': ['./tools/aubreylaw-docgeneration/**'],
  '/api/admin/settings/document-templates/[templateId]/versions/[versionId]/download': ['./tools/aubreylaw-docgeneration/**'],
  '/api/admin/settings/document-templates/[templateId]/versions/[versionId]/validate': ['./tools/aubreylaw-docgeneration/**'],
},
```

The templates are read with `fs` at runtime, so serverless bundles must
include them. Cornerstone lists the three routes above; its other rendering
routes (preflight, quick draft, export, clause preview, real-estate generate)
work in production without an entry. Confirm the same on the new app's first
preview deploy by running a quick draft and a design-summary export there, and
add entries for any route that reports `No registered template`.

`/api/admin/matters/[id]/draft` sets `maxDuration = 300`.

## npm dependencies

See `source/package.json` (generated from what the bundle imports). Main ones:

```
next@^16  react@19  @supabase/supabase-js@^2.100  @supabase/ssr@^0.9
nunjucks@^3.2  pizzip@^3.2  jszip@^3.10  docxtemplater@^3.68  fast-xml-parser@^5.9  docx@^9.6
mammoth@^1.12  pdf-parse@^2.4  docx-preview@^0.4  dompurify@^3.4
@aws-sdk/client-s3  @aws-sdk/s3-request-presigner      (R2)
@anthropic-ai/sdk  openai                               (optional AI features)
zod@^3.25  sonner  lucide-react  cmdk  react-markdown  remark-gfm  @radix-ui/*  class-variance-authority  clsx  tailwind-merge
dev: vitest@^4  @testing-library/react  jsdom  typescript@5.7  tsx
```

Styling is Tailwind with shadcn-style tokens (`bg-background`,
`text-muted-foreground`, `border-border`) plus custom sizes `text-micro` and
`text-compact`. `app/intake/guided.css` is imported by the design sheet,
generate and review steps.

## Database

`schema.sql` was produced by applying all 312 Cornerstone migrations to a clean
Supabase Postgres 17 and filtering the result to the drafting objects. It
contains 31 tables (8 host-contract, 23 feature/support), the
`v_matter_pipeline` view, 28 functions, 13 triggers, 35 RLS policies, explicit
grants, and the `document-template-versions` storage bucket.

`source/supabase/migrations/` holds the 39 original migrations those objects
came from, for history. Some tests read them. Don't apply them to the new
database; use `schema.sql`.

Seeding after the schema is in place:
- **Style sets:** `npm run styleSets:seed` inserts the two built-in style sets (no default is set).
- **Clause library:** only needed with `ESTATE_CLAUSE_SOURCE=database`. `ESTATE_CLAUSE_IMPORT_ACTOR_ID=<staff users.id> npm run clauses:import` creates the clauses and submits a revision for each, **but publishes none**. Each clause must be published (settings UI or `publish_estate_clause_revision`) before generation includes it. With the default `file` source nothing needs seeding.

## Verification done before export

- **Typecheck:** `tsc --noEmit` on `source/` alone (its own `tsconfig.json`, workspace packages resolved to the bundled copies, `scripts/` included): **0 errors**.
- **Tests:** `vitest run` in `source/`: **157 files passed, 1 skipped; 1,531 tests passed, 20 skipped**. 18 skips are the `EXTRACTED` host-file assertions described above. The other two are Cornerstone's own opt-in tests: `estate-clause-parity`'s cutover gate (needs `ESTATE_CLAUSE_CUTOVER_GATE`) and `drafting-hub-sql` (needs `VITEST_HUB_SQL_TEST_CONTAINER`). The hub SQL test was run separately against a database built from `schema.sql` and passed: the SQL document-inclusion logic agrees with the TypeScript one for every combination.
- **Schema:** `schema.sql` applied with `ON_ERROR_STOP` to a fresh Supabase Postgres 17 container. A catalog diff against the database built from the full migration history matched every column, constraint, index, RLS policy, function body, function grant, table grant and the view definition. The only differences are the 26 host triggers and 2 foreign keys listed in the header of `schema.sql`, which were removed on purpose.
- **Schema behaviour**, on the clean database: a duplicate `(matter_id, version)` design sheet is rejected; a run is claimed and a second concurrent run is refused; output registered under a live lease is stamped with its `draft_run_output`, and refused once the lease expires; `persist_generated_estate_document` creates the document and its first version; metrics, clause snapshot and hub page return; a clause goes draft → submitted → published and appears in the generation snapshot; revisions are immutable; `authenticated` cannot execute the service-role RPCs.
- **Rendering:** `npm run estate:render` from the bundle alone produced 9 documents (joint trust, individual trust, pour-over will, DPOA, health-care proxy, living will, HIPAA authorization, college-plan will, funding instructions) from the bundled example payloads. None contains a `[[ MISSING` marker or a leftover `{{`/`{%` tag.
- **Fixtures:** all example payloads and test fixtures use synthetic people (`Jane Example`, `*@example.com`).
- **Not verified:** running the app end to end, R2 uploads, the PDF worker, live LLM calls, lint (the bundle has no ESLint config), and a production build with file tracing.
