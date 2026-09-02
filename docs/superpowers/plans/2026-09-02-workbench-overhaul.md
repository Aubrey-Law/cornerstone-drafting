# Aubrey Law Workbench — Overhaul Plan

**Goal:** Replace Cornerstone's practice-management sprawl with a matter-centric
drafting platform built on versioned workflow objects and clause-level citations.
Strip email, telephony/SMS, CRM, billing, scheduling and e-sign. Keep and enhance
intake, the client portal, document drafting, task management, the assistant, and
the Word add-in.

**Architecture:** A new Next.js app at `apps/workbench` in this repo, against the
**same Supabase project**. The existing app keeps running and is retired screen by
screen. The drafting engine is extracted to a shared workspace package so both
apps import it — there is no fork. No data migration and no cutover cliff.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres with RLS and
`SECURITY DEFINER` RPCs, pgvector, Cloudflare R2, Vercel Cron, Vitest, Anthropic
SDK, Nunjucks-over-DOCX generation, Office.js.

**Source:** A CogniSync product evaluation and an estate-planning platform build
prompt (both supplied by the owner, not committed), reconciled against a
first-hand read of this repository. Every measurement below was taken in this
worktree at `72eb3ed`.

**Relationship to the scope-reduction plan:** This supersedes
`2026-08-28-cornerstone-scope-reduction.md` in part. See *Scope note on the
in-flight plan* below — three of its phases become dead work, and its Phase 8.1
golden corpus is promoted to a hard prerequisite.

---

## Context

Cornerstone grew into a full practice-management suite: matters, intake, a client
portal, an estate document generator, tasks — **plus** email, telephony/SMS, a CRM
and lead pipeline, billing and invoices, scheduling and booking, and e-signature.
That surface area is now the problem. The firm runs email and calendar on MS365
and accounting on QuickBooks Online, so Cornerstone's own email, phone and billing
stacks are duplicated infrastructure carrying real cost: ~120 tables, 169
migrations, 206 admin API handlers, and a web of cross-imports that makes every
change to the parts that matter slower than it should be.

The parts that matter are narrow and deep: **intake → design sheet → drafted
estate documents**, the portal around it, and the task spine that keeps matters
moving. Two evaluations (`docs/architecture-assessment-2026-08-27.md` and the
CogniSync product review) point the same way — the unit of value is not a chat
window, it is a **versioned, structured workflow object** the firm authors once
and runs many times against client documents, with every AI assertion anchored to
a clickable citation in the source.

Outcome: a smaller, matter-centric app built on four workflow types (Review,
Draft, Audit, Knowledge), a substantially more capable assistant, and a Word
add-in that meets the attorney where drafting actually happens — reusing the
estate generator, clause library and template corpus that are the firm's real IP.

## Decisions taken

| Question | Decision |
|---|---|
| Approach | New Next.js app in a **new directory in this repo** |
| Database | **Same Supabase project.** No data migration, no cutover cliff |
| Kept | Intake, client portal, drafting/generation, tasks, calendar sync |
| Removed | Email, telephony/SMS, CRM + leads, billing/invoices, scheduling/booking, e-sign/engagement agreements |
| Workflow model | **All four purposes** |
| Word add-in | **Port it, then finish it** |
| Live use | Attorney only; **no client portal users yet** |

---

## Two corrections to stated premises

**1. The Word add-in is already built.** `word-addin/` is ~4,000 lines of working
code: task-pane chat, native tracked-change application
(`src/word/applyTrackedEdits.ts`, `trackedChanges.ts`, `mutationQueue.ts`), the
firm formatting pass, hand-rolled PKCE OAuth for Microsoft and Google
(`src/dialog/signIn.ts`), sideload tooling, its own Vitest suite, and four server
routes (`app/api/addin/*`) guarded by `tests/addin-route-auth.test.ts`. What it
lacks is matter context (`matterId` is accepted and explicitly unused), any tools
at all (it uses a text `<EDITS>` protocol), version-history reconciliation, and
hosting from the app rather than `localhost:3100`. This is a *finish*, not a build.

**2. A character-offset engine for DOCX already exists** — the hardest part of the
citation model. `lib/docxTrackedChanges.ts` (1,054 lines) contains
`collectParagraphs`, `flattenParagraphAccepted` (accepted-view text),
`normalizeForMatch` returning a normalized string **plus an `origIdx` index map**,
`findAllInNormalized`, `mapNormRangeToOrig`, and `rebuildParagraphWithEdit(para,
start, end, …)` which writes `w:ins`/`w:del` **at character offsets**. Nobody has
thought of this file as an extraction library. It is one.

---

## What the split costs — measured

**Removed: ~29,000 LOC** — CRM/leads ~8,700; billing ~7,000; scheduling ~5,300;
telephony ~3,300; email ~2,300; e-sign/engagement ~2,100.

**Ported: ~58,000 LOC** — design sheet + drafting UI ~21,600; generator ~15,800;
intake ~7,700; tasks ~6,600; assistant ~2,900; estate-fields ~1,900; portal ~1,700.

So "port the generator" is really "port the product core." The phases below are
sized for that.

### The finding that makes it tractable

A dependency scan across every kept lib/component/app directory found **six**
imports crossing into removed subsystems:

- `app/(portal)/messages/actions.ts` and `app/intake/(shell)/actions.ts` → `@/lib/email/send`
- `app/(portal)/schedule/page.tsx` → `@/lib/appointments/portalTypes`
- `lib/documentTemplates/validate.ts` → `@/lib/engagement/{types,render}`
- `lib/stage-engine/planGateContext.ts` → `@/lib/billing/billingType`

Everything else entangling email/phone/CRM with the product lives in the **shell**
— `app/admin/matters/[id]/` (12,551 LOC), the rail (three of six tabs are
email/phone/SMS), sidebar counts, and DB triggers. Since we build a new shell
anyway, that entanglement is *discarded* rather than untangled. That is the main
reason the new-app route is cheaper here than stripping in place.

---

## Three deviations from the build prompt, forced by the code

**1. No `firm_id`, no multi-firm RLS.** `firm_id` appears in **zero** of 169
migrations; `firm_settings` is literally `id integer PRIMARY KEY CHECK (id = 1)`.
Every RLS policy in the repo is the same predicate (`users.role IN
('attorney','admin')`), and every API route uses the service-role client, so RLS
is defense-in-depth, not the access control. Keep single-tenant. The real gate
stays `requireAdmin` (`lib/apiAuth.ts`) + `userCanAccessMatter`
(`lib/documentSecurity.ts`).

**2. The Draft purpose is the existing estate generator.** The prompt's
`{sections[], variables[]}` shape is strictly less capable than what exists: 31
package manifests, Nunjucks-over-DOCX with split-run tag repair, a jurisdiction
rules layer, an immutable clause library with review gates and per-document
provenance, DOCX template versioning with sha256 publications. The design sheet is
already the variable form, and `lib/estateGenerator/missingFieldDesignMap.ts`
already maps a missing generator field back to where to fix it. Draft workflows
*reference* this; they do not duplicate it.

**3. `work_skills` is not evolved into `workflows`.** It has three live consumers
unrelated to runs — the assistant's playbook library, the drafting-interview
prompts, and `AGENTS.md` explicitly protects that path. Its payload is a markdown
blob, which cannot yield per-rule iteration. New tables sit beside it; `work_skills`
retires when the old app does.

---

## Workspace layout

**Add `apps/workbench` beside the existing app. Do not move the old app.**

179 test files resolve paths via `path.join(process.cwd(), 'app/...')` with
vitest's cwd at the repo root. Moving the old app rewrites ~600 path strings
across them, plus `vitest.config.ts`, `outputFileTracingRoot`, `vercel.json` and
the Vercel Root Directory — for a tree scheduled for deletion. Those tests are a
liability that **expires on its own**; moving the app converts an expiring
liability into immediate work.

- `package.json` — add `"workspaces": ["apps/*", "packages/*", "tools/aubreylaw-docgeneration", "tools/workflows"]`. Leave the `file:` spec for estate-fields alone.
- `tests/word-addin-project.test.ts:22` asserts `rootPkg.workspaces` is **undefined** — a deliberate guard. Amend it to assert what it meant (`word-addin` never joins the hoisted tree); don't delete it.
- `tsconfig.json` + `tsconfig.typecheck.json` — add `"apps"` to `exclude` (both; `exclude` replaces, not merges). `eslint.config.mjs` — ignore `apps/**`.
- `apps/workbench/next.config.mjs` — `outputFileTracingRoot: path.resolve(process.cwd(), '../..')`, `transpilePackages: ['@aubrey-law/estate-fields', '@aubrey-law/drafting-engine']`, and trace `tools/aubreylaw-docgeneration/**`, `pdfjs-dist`, `@napi-rs/canvas`.
- Vercel: second project, same repo, Root Directory `apps/workbench`, **"Include files outside root" ON**, `ignoreCommand` `bash ../../scripts/vercel-should-build.sh`.
- CI: extend the single job in `.github/workflows/app-ci.yml` (which documents "WHY ONE JOB") with `npm run -w apps/workbench verify`. One `npm ci` covers both — the point of workspaces here.

**Hard rule while both apps live:** the workbench's versions of shared deps
(`next`, `react`, `@supabase/*`, `docxtemplater`, `pizzip`, `nunjucks`) must match
root exactly, or hoisting shifts under the old app. Worth a test that diffs them.

---

## Shared-code extraction

The engine is far less tangled than feared. Across ~15,800 LOC of drafting code,
only **11 files** touch app infrastructure (8 × `getAdminClient`, 1 × R2, 2 ×
engagement renderer). **Zero** import `next/*`, auth, or the server Supabase
clients. And `generateNodeEstatePackage` already accepts `clauseSnapshot?`,
`templateResolver?` and `styleSet?` as injections, with a structural
`EstateClauseClient` interface at `lib/estateClauses/repository.ts:24`.

**1. `@aubrey-law/estate-templates` — hours, zero file moves.**
Do *not* move `tools/aubreylaw-docgeneration/`; 25 test paths and 12 scripts
hard-code it. Add a `package.json` + `root.mjs` exporting `templatesRoot` *in
place*, then have `lib/estateGenerator/runtime.ts` prefer `ESTATE_GENERATOR_ROOT`
→ package root → cwd. This also fixes a real trap: `resolveEstateGeneratorRoot()`
resolves relative to cwd, so under `apps/workbench` it would look for
`apps/workbench/tools/...` and fail. Same treatment for `tools/workflows`.

**2. `@aubrey-law/drafting-engine` — ~9,600 LOC, 4–6 days.**
`lib/estateGenerator/node/*` + `runtime`/`toGeneratorData`/`preflight`/
`templateVariables`, the pure half of `lib/styleSets` (not `data.ts`/`seed.ts`),
the pure half of `lib/estateClauses` (not the DB repository), `lib/drafting`'s
docx utilities, `lib/documentTemplates/{types,registry}`, and
`lib/docxTrackedChanges.ts`.

The complete injection surface is **one new optional argument** — `clauseClient?:
EstateClauseClient` — replacing the single `getAdminClient()` call at
`lib/estateGenerator/node/generate.ts:297`. Persistence stays app-side
(`persistGeneratedDocument.ts`, the template/style-set DB repositories,
`buildDraftDownloadZip.ts`).

Behavioral suites (`node-estate-generator`, `style-set-*` ×8, `estate-clause-*`
×7, `template-*`, `docx-tracked-changes`) move with an import rewrite; only 13
files read drafting source as text.
*Flag:* `lib/documentTemplates/validate.ts` imports the engagement renderer — the
workbench must not port it as-is.

**3. `lib/draftPayload/**` — explicitly NOT extracted yet.** `assemble.ts` imports
30+ modules across the design sheet, college-prep, contacts and real-estate
transfer; it *is* the domain model, not a library. And `resolveMatterId.ts` is
already flagged in the scope-reduction plan as defective (returns its input
unchanged on failure). The workbench imports it via a tsconfig path alias to
`../../lib/draftPayload/*` — an explicit, greppable cross-app import that dies
with the old app, which beats a fork. Package it during retirement.

**4. `@aubrey-law/estate-fields` — a decision, not engineering.**
`packages/estate-fields/SYNC.md:5` names the sibling `aubrey-law-app` repo as
source of truth; scope-reduction task 8.5.3 says make Cornerstone canonical. Two
committed documents disagree. **Resolve before the workbench imports it.**

---

## Ported vs rewritten

Rule: **reuse every table; rewrite screens that are lists or forms over wide
tables; port screens that encode hard-won legal correctness.**

| Subsystem | Treatment |
|---|---|
| Drafting UI (~15,000 LOC) | **Port near-verbatim.** `app/admin/drafting/[matterId]/design/sections/` encodes expensive legal knowledge. Change routes and shell, not sections. One fix during the port: `design/actions.ts:23` is last-write-wins where the main sheet uses compare-and-swap — give the new one CAS. |
| Intake | **Rewrite the UI, reuse `client_intake` (107 cols) as-is** — the current wizard's section model is shaped by the lead funnel being deleted. But **port `lib/designSheet/seedFromIntake.ts` and `lib/contacts/intakeFiduciarySnapshot.ts` verbatim**; that mapping is the intake→drafting bridge and rewriting it silently breaks generation. |
| Client portal (8 files) | **Port near-verbatim.** `lib/portal/getMatterForUser.ts` as-is (its `.limit(1)` is a documented bugfix, not a smell). **Rewrite `proxy.ts`**, preserving its three real security decisions: JSON 401/403 for API paths, `resolveRole()` falling back to the `users` table, failing to 503 rather than open. Drop `/schedule`. |
| Tasks | **Port; reuse `tasks` as-is** — 58 columns, the product of a deliberate 5-migration consolidation. `matter_tasks` already has zero readers. |
| Assistant | **Rewrite `engine.ts`** against a narrower tool set; port `designSheetTool`, `matterKnowledgeTools`, `workflowTools`, `matterExportTool`; drop `leadTools`, `leadExportTool`, `calendarTools`. Keep `tools/workflows/system/assistant/*/SKILL.md` as the prompt source of truth per `AGENTS.md`. |

**Build portal auth in the workbench first**, before intake. With zero client
users it is the only subsystem you can get wrong for free.

---

## The new part: workflow objects and citations

### Schema (new migration `<ts>_workbench_workflows.sql`)

Mirror the firm's established immutability idiom from
`supabase/migrations/20260715210000_estate_clause_library.sql`: subject →
immutable revisions with `content_hash text CHECK (~ '^[0-9a-f]{64}$')` → working
draft → publications pointer with a **composite FK** so a revision cannot be
published against the wrong subject.

- `workflows` — `purpose ∈ (review|draft|audit|knowledge)`, `slug`, `is_system`, plus `UNIQUE (id, purpose)`.
- `workflow_versions` — `version_number`, `body jsonb`, `content_hash`, `change_summary`, `validation_status`, and `FOREIGN KEY (workflow_id, purpose) REFERENCES workflows(id, purpose)` so a review workflow can never acquire a draft-shaped version.
- `workflow_publications` — one current version per workflow, composite FK.
- `workflow_working_drafts` — one per author.

`body` is validated with `zod` (already a dependency), discriminated on `purpose`
— review rules carry `number`, `statement`, `risk`, `preferred_language`,
sub-numbered `fallbacks[]` each with their own risk, and `not_acceptable[]`.

**Runs** (do *not* extend `work_runs`; its status CHECK, `execution_mode`,
`skill_id ON DELETE RESTRICT` and `matter_id text` are all wrong):

- `workflow_runs` — status `queued|running|completed|partial|failed|cancelled`, `step_total/step_done/step_failed`, `usage_summary`, `last_tick_at` for the watchdog.
- `workflow_run_steps` — **one step per (rule × document)**. This is what makes fail-soft real: a throwing step is `failed` with `last_error`, the run ends `partial`, and retry re-enqueues only failures.
- `workflow_findings` — one table for findings, audit cells and knowledge answers. `outcome`, `severity`, `quoted_language`, `proposed_language`, `fallback_number`, `answer_value jsonb`, and `disposition ∈ (open|accepted|rejected|deferred)` with note/actor. The audit grid is a **view** over this, not a second table.
- `workflow_citations` — `text_layer_id`, `document_version_id`, `block_index`, `char_start`, `char_end`, nullable `page`, `bbox jsonb`, `quote`, and `verification ∈ (verified|unverified|stale)`.
- `document_text_layers` — `source_kind ∈ (docx|pdf|plain)`, `extractor`+version, `source_sha256`, `text`, `blocks jsonb`, `aligned_to_layer_id`, `UNIQUE (document_version_id, source_kind)`.

Three deliberate choices in the citation table:

1. **Citations reference `document_version_id`, never `matter_documents.id`.** A redline creates a new version and every offset shifts. Anchoring to the mutable document is the bug that ruins this product six months in.
2. **`page` is nullable and derived.** `block_index`/`char_start`/`char_end` is authoritative; page is display convenience.
3. **`verification` is stored, not assumed.** Anything not `verified` never reaches an export.

New tables use `uuid REFERENCES matters(id)` and eat the cast when joining
`matter_documents` (whose `matter_id` is `text` with no FK).

### Text extraction with offsets

**Iron rule: the canonical text is never transformed.** No ligature folding, no
smart-quote normalization, no whitespace collapsing. Normalization lives in a
*matching* layer carrying an index map back to raw offsets — exactly the
`normalizeForMatch → {normalized, origIdx}` pattern already at
`lib/docxTrackedChanges.ts:257`. Projects that normalize into stored text discover
six weeks later that their offsets point at the wrong characters.

**DOCX — refactor, don't rebuild.** Drop `mammoth` from this path (it emits
HTML/raw text with no mapping back to OOXML, which is exactly why the current
tabular route cannot cite anything). Step 1 is a **pure refactor**: move
`collectParagraphs`, `flattenParagraphAccepted`, `normalizeForMatch`,
`findAllInNormalized`, `mapNormRangeToOrig` into `lib/textLayer/docx.ts` and have
`docxTrackedChanges.ts` import them; the existing tests are the safety net. Step 2
adds `buildDocxTextLayer(bytes): TextLayer`.

The payoff is the export path. Add a second entry point beside `applyTrackedEdits`:

```ts
applyTrackedEditsAtOffsets(bytes, edits: Array<{
  blockIndex: number; start: number; end: number; replacement: string
}>): Promise<ApplyTrackedEditsResult>
```

It skips `locateEdit` entirely — no fuzzy search, no ambiguity when a phrase
appears twice. Apply in **descending** (blockIndex, start) order so earlier
offsets stay valid.

**DOCX page numbers** don't exist in OOXML. Storage contract: `page` may be null,
cite `¶ 47`. Enrichment: `lib/docxPdfConvert.ts` already POSTs to the LibreOffice
worker and `document_versions.pdf_r2_key` already exists — convert, build a PDF
layer, and align with a **forward-only monotonic cursor**, inheriting the previous
block's page on a miss. Fails soft by construction.

**PDF — `pdfjs-dist` directly**, not `pdf-parse`'s `getText()` (drops positions).
Both `pdfjs-dist` and the `@napi-rs/canvas` polyfill are **already** in
`next.config.mjs` tracing and `lib/engagement/render.ts` already does the
`DOMMatrix`/`ImageData`/`Path2D` polyfill server-side. Record per text item
`{charStart, charEnd, bbox}` with bbox flipped to a top-left origin. Named hard
parts: content-stream reading order (sort by y-band then x; single-column legal
instruments are fine), ligatures/soft hyphens (handled by the matcher, not the
store), rotated pages (skip bboxes, keep offsets), and **scanned PDFs** — detect
`charCount/pageCount < 50`, set `status='no_text'`, and say so explicitly. **No
OCR in v1**; this is a real gap for opposing-counsel scans and the honest fix is a
later Textract/Tesseract worker beside `docx-pdf-worker`.

**Viewer.** PDF highlighting is pure geometry from stored bboxes — no runtime text
matching. DOCX highlighting reuses a pattern the repo already proves works:
`DocxViewerPanel.loadDocx` (`components/documents/DocxViewerPanel.tsx:98-112`)
stamps `data-w-id` onto rendered nodes by document order; do the same with
`data-block-index`. Safety valve: compare the element's `textContent` to the
stored block text before highlighting, and fall back to quote search on mismatch —
turning a silent-wrong-highlight into a degraded-but-correct one.

**Recommendation: make PDF the canonical citation surface for review.** Every
review input gets a PDF rendition on ingest; citations anchor there (exact page +
bbox, zero derivation) and carry the aligned DOCX anchor for the tracked-changes
export.

### Retrieval

**For review on a single document, do not retrieve.** A 60-page trust is ~40k
tokens against a 200k window. Retrieval is a *source of missed findings* here,
because a rule like "the indemnity must be mutual" is answered by **absence**, and
vector search cannot retrieve an absence. Put the whole document in the prompt,
cached. Chunk only above ~120k tokens, and then run every rule against every chunk
and merge — never route a rule to "relevant" chunks.

Retrieval is genuinely needed for **knowledge** and for **audit** over many long
documents. `create extension if not exists vector` (matching the `btree_gist`
precedent at `20260805000000_...:7`); chunk **structure-first** off
`TextLayer.blocks` (~1200 tokens, ~150 overlap, never split a block, hard-break at
headings) so **every retrieved chunk arrives already carrying a citation anchor**.
`document_chunks` gets an `embedding` column plus a generated `fts tsvector`,
**HNSW** (correct from an empty table; IVFFlat needs population and degrades),
GIN on fts, and fusion by **Reciprocal Rank Fusion** rather than score blending —
cosine distance and `ts_rank_cd` have incomparable scales.

Embeddings: Anthropic has none; `openai@^4.104.0` is already a dependency with a
key path. Use `text-embedding-3-small` at 1536 dims, storing `embedding_model` and
`embedding_dims` as columns so a switch (e.g. to Voyage's legal-tuned
`voyage-law-2`) is a backfill, not a migration.

### The run engine

`lib/workflows/runWorkflow.ts` — one pipeline, four purposes, differing only in
step planning and tool schema.

**Queuing is two-tier.** `workflow_jobs` cannot be reused as-is: `job_type` has a
hard CHECK of six values, `enqueue_workflow_job` calls `assert_billing_actor`
(a billing guard coupled into the queue), `firm_settings.durable_workflow_jobs_enabled`
**defaults false**, and the cron is `*/5` — up to 5 minutes before a run starts.
So: the POST plans all steps up front (making `step_total` honest), inserts the
run, and **fires the first tick immediately** via `waitUntil`; a
`/tick` route with `maxDuration` claims a slice, executes with bounded
concurrency, and re-invokes itself if steps remain; the cron gains a
`workflow_run_reap` type as the **safety net** for stalled runs. Enqueue with
`p_actor_id => null` to sidestep the billing guard, and **do not gate on
`durable_workflow_jobs_enabled`**. Verify the `maxDuration` ceiling on the current
Vercel plan first — `app/api/admin/chat/route.ts:26` already uses 120.

**Structured output via tool use**, `tool_choice: {type:'tool'}` with a strict
`input_schema` — replacing the `raw.match(/\[[\s\S]*\]/)` + `JSON.parse` in the
current tabular route.

**Prompt caching** puts the document in the system array with `cache_control:
ephemeral` and varies only the rule: 40 rules over one 40k-token document = one
cache write + 39 reads. Two consequences the step scheduler must respect: cache
breakpoints mark a *prefix*, so the document precedes the varying rule; and the
TTL is 5 minutes, so **schedule steps grouped by document and run them
contiguously**.

Wrap opposing-counsel text with the existing `quoteUserContent` and
`PROMPT_INJECTION_GUARDRAIL` (`lib/anthropic.ts`) — a review workflow reads
hostile input, and this repo already has the defense.

**Citation verification is a hard gate.** The model returns `{quote,
blockIndexHint}`; the engine normalizes, searches **within the chunk's span**,
requires exactly one match, maps back to raw offsets, resolves page/bbox. On
failure the citation is dropped, the finding is marked `unverified`, and it is
**excluded from every export**. This is the feature that makes the product
defensible, and the code for it already exists in this repo.

**Accounting** is already solved: `callAnthropic` writes an `ai_usage` row per
call including cache-read/creation tokens. Add a nullable `workflow_run_id` column
and roll up with `estimateUsdCost` (whose hand-maintained rate table needs a line
for whatever model you run).

**No token streaming.** Runs are jobs, not chats. Realtime is already enabled for
messages — add `workflow_run_steps` and `workflow_findings` to the publication so
findings pop in as steps complete and progress survives a page reload, which SSE
does not.

### Draft maps onto the existing generator

`draft` is a `workflow_versions` row pointing at a package manifest —
`{engine:'estate_package', packageName, state, variableSource:'design_sheet'}` —
and **makes no model call in the happy path**: `buildDraftPayload` →
`toEstateGeneratorData` → `missingRequiredFields` (this *is* the typed-variable
validation; don't write another) → `generateNodeEstatePackage` →
`scanDocxBufferForMarkers` (step fails if `markerCount > 0`, already the promotion
gate) → `storeRunArtifacts` → attorney promotes.

A sync script — sibling to `scripts/syncSystemWorkflows.ts` — walks
`tools/aubreylaw-docgeneration/packages/*.json` and upserts one workflow + one
version per manifest, with `content_hash` = sha256 of the manifest, so a manifest
edit produces a **new version** instead of mutating the old one. That is the
versioning fix `work_skills` never got, applied to the generator.

Non-estate work is a second engine behind the same purpose
(`{engine:'docx_template', templateKey}`) resolving through
`lib/documentTemplates/resolver.ts`, which already has sha256 versioning and
publications. Two engines, one manifest shape, one pipeline.

**Leave `llmDraftFallbackEnabled()` off.** `lib/estateGenerator/engine.ts:44`
explains why a template failure must surface as an error rather than silently
becoming model-authored text in a client's instrument.

### Export

**Tracked-changes DOCX:** accepted findings with `proposed_language` become edits
fed to `applyTrackedEditsAtOffsets` at the citation's exact offsets, then
`createDocumentVersion` + `document_edits` rows. The strongest reuse in the plan:
**the export lands directly in the accept/reject UI that already exists** —
`DocxViewerPanel` loads `document_edits`, stamps `w:id`s, and offers per-change
accept/reject. Zero new review UI. (`document_versions.source` has a fixed CHECK;
reuse `'assistant_edit'` or add `'workflow_review'`.)

**Issues memo:** built with the `docx` package (already used for design-sheet
export), then `convertDocxToPdf`. Without `DOCX_PDF_CONVERT_URL` it's DOCX-only,
and `DocxPdfConvertNotConfiguredError` is the already-modeled failure.

**Audit grid:** `exceljs` is already a dependency — documents as rows,
instructions as columns, cell comment = quote + page, hyperlink back to the
finding. CSV is a second serializer over the same matrix.

---

## Assistant

Consolidate **four** chat surfaces (floating rail panel, assistant page, matter
assistant, Word add-in) onto **one** engine with one tool registry. Today the
first two share `lib/adminChat/engine.ts`, the third uses `lib/llm` + MCP
connectors, and the add-in has **no tools at all**.

- Drop `leadTools`, `leadExportTool`, `calendarTools` (10 of ~27 tools are calendar/lead). Edit `lib/matterKnowledge.ts` to remove the `communications` section and its loader.
- Add: run/read workflows, retrieval over `document_chunks` with inline citation chips, and matter document tools.
- Add **memories** (firm/user/matter scope, visible and editable — no invisible memory); none exist today.
- Fix a real gap: the main engine interpolates intake free-text straight into the system prompt without `quoteUserContent`, unlike the add-in and draft-reply routes. Apply the guardrail uniformly.
- Persist threads with a `context_type` that admits `document`/`addin` — today's CHECK allows only `general` and `matter`.

## Word add-in

1. **Port** — repoint `word-addin/vite.config.ts` proxy and `CORNERSTONE_ORIGIN` at the workbench; keep the PKCE dialog and sideload tooling untouched.
2. **Host it from the app** instead of `localhost:3100`, so the manifest's `SourceLocation` is a real URL. This is the precondition for everything else.
3. **Give it matter context and tools** — `matterId` is already accepted and unused. Wire the shared tool registry.
4. **Run review playbooks against the open document**, applying findings through the existing `applyTrackedEdits`.
5. **Clause insertion** from the estate clause library.
6. **Reconcile version history** — the add-in edits the file on disk and never writes `document_versions`/`document_edits`; `/api/documents/[id]/edits` does. Close that gap.
7. Raise the ~3.5 MB style-sweep limit (a Vercel body limit) and test on Word for the web.

---

## Coexistence hazards

**H1 — CRM triggers fire on every intake/contact/matter write.**
`20260902000000_unify_crm_hub.sql:1011-1067` installs five sync triggers, and
`create_matter_with_client` inserts into `client_intake` unconditionally — the
workbench cannot create a matter without firing the whole chain. Worse,
`sync_crm_person_from_intake` calls `crm_stage_slug_for_intake(...)`; an unmapped
`lead_status` yields a stage-less person row, silently corrupting the pipeline the
attorney still uses daily.
*Mitigation:* the workbench writes **only through the existing RPCs**, never a
direct `INSERT INTO client_intake`. Add a test asserting every status literal it
can write is a key the stage function maps.

**H2 — `deleteMatter` couples matter deletion to every table being dropped.**
`lib/matters/deleteMatter.ts:151-165` deletes from `messages`, `sms_messages`,
`email_log`, `engagement_agreements` and treats every error as fatal, by design.
Remove the references in **both** apps, deploy, confirm, then drop in a later PR.

**H3 — `client_intake` ↔ `contacts` bidirectional mirror.**
`20260926000000_matter_contacts_dual_write.sql` installs two triggers mirroring 19
columns each, avoiding recursion only via same-value guards, with no advisory
lock. Low risk with one user; real once a client uses the portal. Also
`matter_contacts` step 7b is documented written-but-unapplied with two
authoritative writers per join row — **run `npm run check:matter-contacts` before
the workbench writes one.**

**H4 — duplicate crons.** Give the workbench **zero** crons until a subsystem
fully transfers, then move the cron in the same PR that darkens the old screen.

**H5 — R2 key collisions.** `persistGeneratedDocument.ts:31` builds keys from
`Date.now()`; add a random suffix in the workbench's copy.

**The governing rule**, from `20261013000000_drop_twenty_sync_columns.sql`: never
drop a column or table a trigger function names without `CREATE OR REPLACE`-ing
the function first — plpgsql resolves columns at execution, so the migration
succeeds and *then* every write fails. And a table drop is never in the same PR as
its last code reference, because migrations and code deploy in no guaranteed order.

---

## Scope note on the in-flight plan

`docs/superpowers/plans/2026-08-28-cornerstone-scope-reduction.md` is an active
plan to remove scheduling, telephony and default-off flags **from the existing
app**. Those phases are now dead work — the screens are going dark wholesale.
**Stop Phases 3, 5 and 6.** Keep Phase 1 (confidentiality/reliability) and Phase
4 (billing system-of-record, an owner decision the *data* outlives the screen).

**Phase 8.1 — the attorney-approved golden-document corpus — becomes a hard
prerequisite, not a nice-to-have.** It is the only oracle that will prove the
ported generator did not change a trust.

That plan also states "**No rewrite**" among its explicit refusals. This plan
supersedes that refusal deliberately, on the evidence above: the domain core is
clean (6 cross-imports), the entanglement is confined to a shell we are replacing
anyway, and the old app stays running throughout. Worth recording as a conscious
amendment rather than an oversight.

---

## Phases

Complete one, run tests, stop for review.

**0 — Repo shape** (days). Workspaces; amend `tests/word-addin-project.test.ts`;
`@aubrey-law/estate-templates` and `tools/workflows` package files; empty
`apps/workbench` deploying green on its own Vercel project; CI extended.

**1 — Engine extraction** (1 week). `@aubrey-law/drafting-engine` with the
`clauseClient?` injection. **The old app imports the package** — that is the proof
there is no fork. Gate: `npm run audit:render-matrix` byte-identical before/after.

**2 — Golden corpus** (attorney time). Scope-reduction Phase 8.1. Gate for
everything that generates a client document.

**3 — Citation vertical slice** (2 weeks). *The go/no-go gate for the whole
product.* One native PDF + one hand-written 3-rule review workflow (JSON, no
authoring UI) → 3 findings, each with a `verified` citation carrying
`{page, charStart, charEnd, bbox}` → clicked in a viewer that highlights from
geometry alone → exported as a tracked-changes DOCX whose `w:ins`/`w:del` land on
the cited text. Golden-file tests asserting
`text.slice(charStart, charEnd) === quote`.

**4 — Run engine** (2 weeks). Steps, tick route, reaper, tool-forced output, the
verification gate, `ai_usage` wiring, Realtime progress, findings UI with
dispositions. Review purpose only.

**5 — Portal + shell** (2 weeks). Portal ported onto the new IA and new domain;
`proxy.ts` rewritten. Zero client users = zero risk.

**6 — Drafting ported** (3 weeks). Design sheet and drafting UI near-verbatim.
Both hubs live against the same tables. Attorney drafts one real matter in the
workbench, diffed against the corpus.

**7 — Draft workflows** (1 week). Manifest sync, preflight-as-checklist,
`storeRunArtifacts` → promotion. Mostly wiring.

**8 — DOCX text layer** (1 week). The `docxTrackedChanges` refactor,
`applyTrackedEditsAtOffsets`, `data-block-index` stamping. Slice now closed on
both formats.

**9 — Audit** (1 week). Migrate `tabular_reviews`/`tabular_cells` into
`workflow_findings`; delete the synchronous route (it loops every document ×
column inside a POST handler with no `maxDuration`, truncates at 60k chars, and
regex-parses JSON); XLSX export.

**10 — Tasks + intake ported** (2 weeks). Old `/admin/matters`, `/admin/contacts`,
`/admin/leads`, `/admin/crm`, `/admin/pipeline` go dark.

**11 — Assistant consolidation** (2 weeks). One engine, one registry, memories,
retrieval with citations.

**12 — Knowledge** (1 week). pgvector, chunker, embeddings,
`match_document_chunks`. Last of the four because it is the only piece with zero
precedent in this schema.

**13 — Word add-in finished** (2 weeks). Hosted, matter-aware, tools, playbook
runs, clause insertion, version reconciliation.

**14 — Authoring UI + seed content** (3 weeks). Playbook/audit/knowledge editors
with the rule-ladder outline. Seed the estate-planning playbooks from the build
prompt (RLT, pour-over will, DPOA, AHCD, ILIT, SNT, third-party review, deed) —
10–18 substantive rules each; **placeholder text is a failed phase.**

**15 — Retirement.** Old app screens dark → remove removed-subsystem libs from
both apps → `CREATE OR REPLACE` the five CRM sync functions as no-ops → bake one
week watching `cornerstone_crm_sync_events` stop growing → drop triggers → delete
the old app (the 179 text-asserting tests die with the code they describe) →
extract `@aubrey-law/draft-payload` → deferred table drops, one family per
migration, with production row-count evidence.

---

## Verification

**Per phase:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build:next`,
plus `npm run -w apps/workbench verify`. CI must run from `npm ci`, never a warm
`node_modules`.

**Engine extraction (Phase 1) — the critical gate:** `npm run audit:render-matrix`
must produce byte-identical DOCX before and after. Run `npm run estate:render --
--package <name>` across all 31 manifests and diff.

**Citation slice (Phase 3) — the go/no-go:** golden-file tests asserting
`layer.text.slice(charStart, charEnd) === citation.quote` for every fixture;
manual confirmation that a citation click highlights the correct span in both the
PDF and DOCX viewers; a tracked-changes export opened in real Word with the
insertion landing on the cited clause.

**Drafting port (Phase 6):** generate a full estate package for one real matter in
both apps and diff against the golden corpus. Attorney sign-off before any
workbench-generated document reaches a client.

**Coexistence:** `npm run check:matter-contacts` green against production before
the workbench writes `matter_contacts`. A test asserting every status literal the
workbench can write is mapped by `crm_stage_slug_for_intake`. Watch
`cornerstone_crm_sync_events` row growth after the no-op rewrite.

**Before any table drop:** production row-count evidence. Zero `.from()` calls is
*not* deletion evidence for trigger-, RPC- or audit-owned tables.

## Open questions for the owner

1. **`estate-fields` ownership** — sibling repo or Cornerstone? Two committed docs disagree; blocks Phase 1.
2. **Billing system of record** — QuickBooks Online is stated, but `invoices`/`billing_*` hold live data. Where does history go before the tables drop?
3. **Scanned PDFs** — accept "no text layer, upload the DOCX" for v1, or budget an OCR worker?
4. **Add-in distribution** — stay sideloaded firm-internal, or publish to AppSource (which adds a review cycle and a hosting requirement)?
