# Aubrey Law Workbench — Overhaul Plan

**Goal:** Replace Cornerstone's practice-management sprawl with a matter-centric
drafting platform built on versioned, stage-scoped prompt objects with typed inputs
and clause-level citations. Strip telephony/SMS, CRM, billing, scheduling and e-sign.
Keep and enhance intake, the client portal, document drafting, task management, the
assistant, email (retargeted at Gmail) and the Word add-in.

**Architecture:** A new Next.js app at `apps/workbench` in this repo, against the
**same Supabase project**. The existing app keeps running and is retired screen by
screen. The drafting engine is extracted to a shared workspace package so both
apps import it — there is no fork. No data migration and no cutover cliff.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres with RLS and
`SECURITY DEFINER` RPCs, pgvector, Cloudflare R2, Vercel Cron, Vitest, Anthropic
SDK, Nunjucks-over-DOCX generation, Office.js.

**Sources:** A CogniSync product evaluation, an estate-planning platform build
prompt, and an Irys review (`Cornerstone_Scope.md`, 2026-09-02) — all supplied by
the owner, none committed — reconciled against a first-hand read of this
repository. Measurements were taken in this worktree at `72eb3ed`; the execution
notes were added as phases shipped.

**Revision history:**

| Date | Change |
|---|---|
| 2026-09-02 | Initial plan (#375). |
| 2026-09-02 | Phases 0 and half of 1 shipped (#376, #377, #378, #379). Two corrections learned in execution added — see below. |
| 2026-09-02 | Irys scope review folded in: prompts become the primary abstraction, email is kept and retargeted at Gmail, probate and trust administration added, Lawmatics two-way sync added. |
| 2026-09-03 | Phase 1 finished (#381), golden corpus built (#382), citation slice built (#383) with CLI follow-ups (#384, #387). Open question 5 resolved: the Google migration is complete. |
| 2026-09-05 | Workbench shell shipped (#394–#398): shared design system, portal auth with Google, findings workspace, one shared schema. **The Phase 3 go/no-go answered** — 8 citations verified, 1 rejected, against three real instruments. All four practice tools from 13b built (#399–#402). **A stated premise corrected by the owner: the firm reviews only its own drafts** — the playbook was rescoped and renamed (#403). |
| 2026-09-03 | Estate-tax schedules moved into dated configuration with a settings screen (#385, #386), pulled forward out of phase 4. |
| 2026-09-04 | Share gate on unfilled `[[ MISSING: ]]` fields (#388), pulled forward out of phase 4b. |

**Relationship to the scope-reduction plan:** This supersedes
`2026-08-28-cornerstone-scope-reduction.md` in part. See *Scope note on the
in-flight plan* below — several of its phases become dead work, task 7.8 is
cancelled outright, and its Phase 8.1 golden corpus is promoted to a hard
prerequisite.

---

> **Status as of 2026-09-05 11:45 UTC.**
>
> | | State |
> |---|---|
> | **Phase 0** — repo shape | **Done.** #376 (workspaces + data-corpus packages), #377 (`apps/workbench` + CI), #379 (instrumentation shadow). |
> | **Phase 1** — engine extraction | **Done.** #378 moved the 44-file pure closure (~9,000 LOC); #381 finished it — `generateNodeEstatePackage` is in the package with `templateResolver` and `styleSet` as *required* injections, and the `NODE_ENV === 'test'` branches are gone. All 45 generated documents verified content-identical. |
> | **Phase 2** — golden corpus | **Built, awaiting attorney approval.** #382 — content-hash fingerprints for 45 documents across 30 packages, `corpus:check`/`update`/`list`, CI step. **Zero approved**, so the gate reports but never blocks until the documents are signed off. |
> | **Phase 3** — citation slice | **Built and answered.** #383, with #384/#387 making the CLI usable and #403 adding the attempted quote to a refusal. **The gate passed:** across three real instruments — a sample realty trust and the firm's own joint trust, 121 and 1,037 blocks — **8 citations verified and 1 rejected.** The rejection was the verifier working; it kept the rationale and dropped the unsupported quote. The tracked-changes export produced real `w:ins`/`w:del`. *Still owed: opening that redline in Word to confirm the insertions land on the cited clauses.* |
> | **Workbench shell** | **Done 2026-09-05.** #394 (design system + scaffold), #395 (engine dependencies), #396 (Google sign-in, firm accounts only), #397 (playbook bundled not read from disk), #398 (one shared generated schema). |
> | **Phase 13b** — practice tools | **All four built 2026-09-05.** #399 funding tracker, #400 execution requirements, #401 signing ceremony record, #402 fiduciary matrix. None has yet been used by a person on a real matter, which is the next thing worth doing. |
> | **Phase 4** — pulled forward | The estate-tax table (#385, #386) and the marker share gate (#388) shipped ahead of the rest of phase 4, since neither depends on the citation gate. |
> | **Open question 1** | Resolved: Cornerstone is canonical for `estate-fields`. |
> | **Open question 2** | Partly answered — QuickBooks link declined for now. |
> | **Open questions 3–4** | 3 (OCR for scanned PDFs) and 4 (add-in distribution) still open. |
> | **Open question 5** | **Resolved 2026-09-03: the migration to Google is already complete.** Email, calendar and files are all Google, so the Microsoft Graph path is dead code against the firm's actual setup — removed in phase 15b rather than maintained, and phase 15b is no longer gated. |
> | **Irys scope review** | Folded in 2026-09-02: prompts primary, email kept on Gmail, probate added, Lawmatics sync added. Phases 4, 13b, 14, 15b, 16, 17 changed. |
>
> **Two things carried forward that automation cannot close:**
>
> 1. **The published-template-override run.** #381 made the injections required, so a
>    missed call site is a typecheck error — but nothing in the suite talks to the
>    database. Generating for a matter with a published template override, and
>    confirming the override is used rather than the bundled template, is still a
>    manual check.
> 2. **Corpus approvals.** 45 documents fingerprinted, none approved. The gate is inert
>    until at least the packages drafted most often are signed off.

## Two corrections learned in execution — carry these forward

**1. "Byte-identical DOCX" is not a usable gate.** DOCX is a zip and its entries
carry timestamps, so two renders of identical input seconds apart differ at the
byte level. A first determinism check passed only because both renders landed
inside one timestamp tick — a false green. **The gate is content-level:** hash
every zip entry's name and bytes, excluding zip metadata. Wherever this plan says
"byte-identical", read it that way. The working script is in the scratchpad.

**2. Next resolves convention files by walking UP, and this bit twice.**
`proxy.ts`, `middleware.ts`, `instrumentation.ts` and `instrumentation-client.ts`
are all inherited from the repository root by any app that does not define its
own — silently, with a successful build. `apps/workbench` must shadow every one
the root app defines; `apps/workbench/tests/convention-file-isolation.test.ts`
enforces that generally rather than file by file.

**The blind spot behind it, still open:** CI runs one hoisted `npm ci` at the
repo root, so a workbench file importing a dependency it does not declare
resolves fine in CI and fails only on Vercel, which installs scoped to the app
directory. That is how the Sentry failure reached production. Nothing currently
catches this class before deploy. If it recurs, add a scoped-install check for
`apps/workbench` to CI rather than another test.

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
| Removed | Telephony/SMS, CRM + leads, billing/invoices, scheduling/booking, e-sign/engagement agreements |
| Word add-in | **Port it, then finish it** |
| Live use | Attorney only; **no client portal users yet** |

**Revised 2026-09-02 after the Irys scope review** (see that section below):

| Question | Decision | Changes what |
|---|---|---|
| **Email** | **Kept, on Gmail — not Outlook.** | Reverses the removal. See the migration note below. |
| **Primary abstraction** | **Prompts primary**; Review playbooks become one prompt type, not the organising model | Reshapes the workflow schema |
| **Practice scope** | **Adds probate and trust administration** | New matter types, stage H prompts, dated task generation |
| **Integrations** | **Lawmatics two-way sync** on contacts and stage. QuickBooks not now | Reverses scope-reduction 7.8 |

> **Email is the consequential one, and it needs care.** The plan had email removed
> because MS365 already owns it. Keeping it on **Gmail** is a different decision, not a
> reversal to the status quo: the current stack sends through **Resend**
> (`lib/email/send.ts`) with a **Microsoft Graph** path (`lib/email/graphSend.ts`), and
> neither is Gmail. So this is "retarget email at Google", not "keep what's there".
>
> Two things follow that the answer did not cover, and both need confirming before any
> email work starts:
>
> 1. **Calendar and files.** Calendar sync was kept, and it is Microsoft-based today
>    (`lib/microsoftCalendar.ts`, `lib/appointments/graphBusy.ts`). If email moves to
>    Google, calendar and file storage presumably follow — but a half-migrated firm
>    running Gmail against Outlook calendar is worse than either end state. This plan
>    assumes calendar follows email to Google and says so rather than guessing silently.
> 2. **The stated preference on file says MS365** for email, calendar and file storage.
>    The Irys document describes a mid-migration from M365 to Google, which reconciles
>    the two — but the migration's timing governs when the Outlook path can be deleted,
>    and nothing here knows that timing.

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

**Removed: ~26,700 LOC** — CRM/leads ~8,700; billing ~7,000; scheduling ~5,300;
telephony ~3,300; e-sign/engagement ~2,100.

*Revised: email (~2,300 LOC) is no longer a removal.* It is kept and retargeted at
Gmail, which is a rewrite of the send path rather than a deletion — the current stack
sends through Resend with a Microsoft Graph path, and neither is Gmail. The six
cross-imports counted below still stand, but two of them (`app/(portal)/messages/actions.ts`
and `app/intake/(shell)/actions.ts` → `@/lib/email/send`) are no longer breakages to
resolve; they simply follow the send path to its new target.

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

## The Irys scope review — what it changes

`Cornerstone_Scope.md` (2026-09-02) reviews Irys as a reference implementation and
proposes a ~40-prompt Massachusetts estate-planning library, a matter schema, and a
practice-tool ranking. Most of it strengthens this plan. Three things reshape it.

### 1. Prompts replace workflows as the organising abstraction

The approved plan borrowed CogniSync's four workflow purposes. The Irys schema is a
better fit for what this firm actually does, and the reason is in the content: of the
~40 prompts proposed, almost none is a rule-ladder review. They are drafting briefs,
checklists, client letters and issue-spotters. Forcing those into a shape built for
marking a document against firm positions would be the "one more representation, not a
solution" mistake already flagged for `estate-fields`.

So: **prompts are primary; Review playbooks survive as one prompt type.**

> **Corrected by the owner, 2026-09-05.** This paragraph used to say the rule-ladder case
> was "reviewing a draft prepared elsewhere, which is real but rare". It is not rare — it
> does not occur. Every draft is the firm's own, every redline is the attorney's own
> change, opposing counsel sends no comments, and **clients receive only PDFs**.
>
> The rule ladder is therefore **quality review of the firm's own drafting**, and a
> deviation is a template or an edit to fix rather than a point to negotiate. The playbook
> was renamed accordingly (`ma-trust-third-party-draft` → `ma-trust-firm-qa`, #403).
>
> The reframing was not cosmetic. Restating one rule as "*every* discretionary
> distribution standard we draft states…" moved it from COMPLIANT to a blocker-level
> DEVIATION against the firm's own joint trust, because the new wording demands
> completeness where the old one accepted a single satisfying clause. No code changed.
>
> Two consequences elsewhere in this plan. The prompt-injection hardening around a
> reviewed document is now defence in depth rather than a live threat — keep it, since the
> day a foreign document does arrive is the day nobody is thinking about it. And any path
> that could send a DOCX to a client contradicts "clients receive only PDFs"; the portal
> work in Phase 5 should enforce that rather than assume it.

Two things the Irys schema has that the workflow model does not, and both are the point:

- **Typed inputs sourced from the matter record.** `inputs: [{key, source: "matter.client.legal_name"}]`, pre-filled, asking only for what is genuinely missing. Irys prompts ask everything in chat because an Irys matter holds nothing. Cornerstone's `design_sheets` already holds ~195 answered fields. This is the single largest quality difference available and it costs a schema column.
- **`output_target`.** A prompt that produces a checklist should create checklist objects on the matter, not a wall of chat text. `chat | draft_doc | checklist | task_set | email_draft`. The `tasks` table and `lib/stage-engine/` already exist to receive them.

**Retained from the workflow design:** run/step/finding tables with per-step fail-soft,
the citation model, and `workflow_runs` as provenance (the doc's `PromptRun` is the same
idea). Retained schema shape, re-pointed at prompts.

### 2. Stage-gated surfacing and stage-triggered runs

Prompts surface filtered by `matter_types` + current `stage`, and stage transitions fire
them: Drafting → QA auto-runs the Blank Finder and blocks the move to Client Review while
a BLOCKER stands; Executed → Funding generates the funding checklist as tasks.

This marries cleanly to machinery that already exists — `lib/stage-engine/fireStageTasks.ts`,
`matter_stage_rules`, `stage_tasks` and the `workflow_jobs` queue — and it is what makes a
40-prompt library usable rather than a menu nobody reads.

### 3. Practice scope widens

Probate (MUPC) and trust administration are in: new matter types, the stage H prompts, and
dated task generation from date of death with jurisdictional deadlines flagged. `probate_track_enabled`
exists today as a default-off flag; this turns it on rather than inventing a track.
*Assumption to confirm:* "add probate" is read as the full track — matter types, filing
roadmap, task generation, successor-trustee onboarding — sequenced after the EP core is solid.

### Grounding: what is already built

Checked against the tree rather than taken on faith.

| Doc proposes | Reality |
|---|---|
| Matter fields `blended_family`, `has_minor_children`, `qtip`, `disclaimer`, `spendthrift`, `trust_protector` | **Already exist** as design-sheet decisions. Do not add columns; read the sheet. |
| `special_needs`, `masshealth`, `out_of_state_property` | **Genuinely absent.** Real gaps — SNT and the five-year lookback are exactly the facts a plan must not miss. |
| `funding_status`, per-asset funding tracking | `lib/draftPayload/fundingPlan.ts` plans funding **for drafting**; nothing **tracks** it. The tracker is new. |
| Numbered folder taxonomy (`03_Drafts/`) | `lib/documentFolders.ts` is **13 lines**. Does not exist. |
| D1 Blank Finder | **Half built** — `scanDocxBufferForMarkers` already gates promotion on `markerCount > 0`. Extend it; don't start over. |
| Fiduciary matrix | Fiduciary slots exist on the design sheet; the cross-document matrix does not. |

### The estate-tax threshold problem is real and current

The doc warns never to hard-code tax figures into prompt text. **`lib/estateTax.ts` hard-codes
the entire Massachusetts rate table**, with the 2023 exemption in a comment and no effective
date anywhere. Nothing marks it stale when the law changes.

That is cheap to fix and worth doing before any prompt quotes a threshold: move the table
into `firm_settings` (single-row, already exists) keyed by effective date, inject as
`{{firm.estate_tax_thresholds}}`, and have a prompt that needs a missing figure **say so
rather than supply one from memory**. A prompt that quotes a stale exemption is worse than
one that refuses.

### Tools the doc names that this plan lacks

In its own priority order, and all genuinely absent:

1. **Funding tracker** — per-asset status to confirmation, with an `unfunded_asset_value` figure. The doc's claim that unfunded trusts are the profession's largest malpractice exposure is the reason to build it, and the dollar figure is what makes a client act.
2. **Execution requirements engine** — MA per-document signing rules generated per matter. Takes the highest-consequence checklist out of human memory.
3. **Fiduciary matrix** — live, cross-document, rather than a regenerated report.
4. **Signing ceremony module** — scheduling, witness and notary assignment, per-document requirements, scan-and-file. Note this is **not** e-signature: most of an EP set cannot be e-signed (wills need wet signatures and witnesses, deeds need notarisation), which is consistent with removing e-sign rather than in tension with it.
5. **Plan simulator** — run first death / incapacity / simultaneous death against the current set. Falls out of the prompt engine almost free once documents are in scope.

### Explicitly not adopted

Knowledge-graph "Insights" (nothing to show on a five-document matter), general legal
research (the answers are in MUPC/MUTC/MassHealth/DOR, not case law), plugins and a
marketplace (one seat), and e-sign for estate-plan documents.

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

## The new part: prompt objects and citations

> **Superseded in part, 2026-09-02.** This section was written for the four-purpose
> workflow model. Under the Irys decision the organising object is a **prompt**
> (`stage`, `matter_types`, typed `inputs`, `doc_scope`, `output_target`, `skill_ref`,
> `version`), with Review playbooks as one type rather than the frame.
>
> **What survives unchanged and is still the design to build:** the immutability idiom
> below (subject → immutable versions with `content_hash` → publications pointer with a
> composite FK), the run/step/finding tables with one step per unit and per-step
> fail-soft, the citation table anchored to `document_version_id`, the text-layer and
> extraction design, the run engine's queuing and prompt-caching, and the export paths.
> Read `workflows`/`workflow_versions` below as `prompts`/`prompt_versions`; the
> `purpose` column becomes `output_target` plus a `kind` that admits `review`.
>
> **What changes:** `body` carries the Irys `Use Case / Ask me / Then return` text plus
> typed `inputs`, rather than a purpose-discriminated rule structure. The rule-ladder
> shape stays as the `review` kind's body only.

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

**Further amended 2026-09-02 by the Irys scope decisions.** Two more items in that
plan are now cancelled rather than merely resequenced:

- **Task 7.8 — retire the Lawmatics OAuth surface (~1,470 LOC).** Cancelled. Lawmatics
  becomes an integration with two-way sync, so that surface is verified and kept, not
  deleted.
- **Anything premised on email leaving.** Email stays, retargeted at Gmail. Phase 2's
  campaign removal already shipped and is unaffected, but the surrounding assumption
  that the email subsystem was on its way out no longer holds.

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
product.* One hand-written 3-rule review playbook (JSON, no authoring UI) →
findings, each with a `verified` citation carrying `{page, blockIndex,
charStart, charEnd, bbox}` → highlighted in a viewer from geometry alone →
exported as a tracked-changes DOCX whose `w:ins`/`w:del` land on the cited text.
Golden-file tests asserting `text.slice(charStart, charEnd) === quote`.

**Built as of 2026-09-03.** `lib/textLayer/{types,pdf,docx,match,persist}.ts`,
`applyTrackedEditsAtOffsets` in the engine, `lib/reviewSlice/runReview.ts`,
`tools/workflows/review/ma-trust-firm-qa.json` (renamed from
`ma-trust-third-party-draft` in #403),
`components/documents/PdfCitationViewer.tsx`, `npm run review:slice`, and the
`document_text_layers` / `workflow_citations` migration.

*One deviation from the design above, taken deliberately.* The plan proposed
making PDF the canonical citation surface and aligning back to the DOCX for the
tracked-changes export. Instead **each format carries its own layer**: the DOCX
path gives an exact export (a block's index *is* its paragraph index, so
citation → edit is arithmetic rather than matching), and the PDF path gives
exact page and bbox geometry. A fuzzy alignment step between them would have
been the least reliable link in a chain whose whole value is reliability.
Reviewing a native PDF and redlining its DOCX twin is the case still open;
`document_text_layers.aligned_to_layer_id` is in the schema for it. Build it
against a real document that needs it, not speculatively.

*The check no test can stand in for* — **taken 2026-09-05.** Run against three real
instruments, the playbook returned **8 verified citations and 1 rejected**, the
rejection landing on a quote the model had tidied rather than copied. A high
rejection rate means changing the prompting or how the document is presented —
**never** loosening the verifier.

That rejection exposed a gap and closed it: a finding recorded *that* a citation
failed but never what was attempted, so the rate could be measured and not acted
on. `ReviewFinding.attemptedQuote` now carries the words on refusal, and both the
CLI and the findings list show them (#403).

*Still owed, and small:* open the exported redline in real Word and confirm the
insertions land on the cited clauses.

**4 — Prompt + run engine** (2–3 weeks). *Reshaped by the Irys review.* The prompt
object (`stage`, `matter_types`, typed `inputs` with matter-record sources,
`doc_scope`, `output_target`, `skill_ref`, `version`), the run/step/finding tables,
tick route, reaper, tool-forced output, the citation verification gate, `ai_usage`
wiring, Realtime progress. Stage-filtered surfacing on the matter page.

**Built as of 2026-09-08.** Prompts are versioned database objects —
`prompts` / `prompt_versions` / `prompt_publications`, immutable versions under a
publication pointer, a composite FK holding a version's `kind` to its prompt's
(`20261028000000_prompt_objects.sql`). Typed `inputs` resolve through the
allow-list in `packages/citations/src/prompt/inputs.ts`, checked at publish time
rather than run time. Run, step and finding tables with per-unit records
(`workflow_runs`, `workflow_run_steps`, `workflow_findings`,
`workflow_field_references`); a cron-driven queue with `claim_workflow_run`'s
`for update skip locked`, a reaper, and surgical retry that re-pays for only the
units that failed — measured at **1 model call to retry 1 of 6**. Tool-forced
output with prompt caching. The verification gate: `verifyQuote` for citations,
`verifyFieldReference` for design-sheet fields, both refusing on ambiguity.
`ai_usage.workflow_run_id` wired. Runs fire on stage entry
(`20261103000000`) and, since #421, on a watched field changing
(`20261106000000`).

*Four deviations from the design above, each taken deliberately.*

**`output_target` is content, not a column** (#417). A run records only
`prompt_version_id`, so a mutable column would leave an old run
indistinguishable from one that produced something else. The rule that fell out:
content changes make a version, configuration does not — `fires_on_stage_entry`
is a column, `output_target` is in the body. Three of the five values are built:
`chat`, `task_set`, `checklist`. `draft_doc` and `email_draft` are refused, and
not for effort — the workbench's R2 client is read-only, and more to the point
the safety model does not transfer. Everything trustworthy here rests on a claim
being verified against its source, and generated prose has no source.

**Realtime progress became a client poller.** `revalidate` was specified and did
nothing: both run pages call `getSessionUser()`, which reads `cookies()` and
forces fully dynamic rendering. `app/runs/RunProgressRefresh.tsx` polls and stops
when the run settles.

**Stage-filtered surfacing is in the workbench, not the matter page.** Stage
transitions happen in the old app's matter screens, which is where an attorney
stands when they move a matter — and which phase 15 deletes. Until phases 6 and
10 move matters into the workbench, this surfaces a blocker to someone who has
already moved it. Advisory only, never blocking: both v1 and v2 of the
design-sheet audit produced blocker-level **false positives** on a real matter,
and a hard gate would have stopped a well-drafted matter advancing on a wrong
finding.

**`doc_scope` and `skill_ref` were never built.** Nothing needed them. Named here
so their absence reads as a decision rather than an oversight.

*Seven things the plan did not mention, built because running it demanded them.*
A run queue and tick route (#412) — the 300s ceiling was not being hit, but a
40-prompt library will. Stage-triggered runs (#416). Three separate corrections
to task withdrawal (#417, #418, #419): a retry duplicating instead of replacing,
an uncitable finding retiring a cited one, and one prompt erasing another's
tasks. The fiduciary matrix's gaps becoming tasks (#420). Unsupported findings
failing their unit instead of vanishing (#422). And versioned instructions
(#424), because the checks were versioned data while the instructions were
un-versioned code, so half of what produced a finding could change under an old
run on retry.

*The check no test can stand in for* — **taken 2026-09-06 to 2026-09-08.**

Every defect that mattered was invisible to a passing suite. `matters.title`, a
column that never existed, had shipped in five features. `emitTasks` took a
`unitIds` argument that nothing passed — `git log -S` showed #412 dropping it —
so a retried run re-created a task for every unit including the ones that never
failed. `'prompt'` had been a legal `tasks.source` since #410 and was never added
to the root app's `TASK_SOURCES`, so every task the audit ever created rendered
as an **empty, unstyled chip** in the only app that displays tasks.

And the one worth remembering: on a live matter, the audit's check 1 returned the
same blocker twice — once with **four verified references**, once with **none**.
The gate correctly refused the uncitable one, and the withdrawal step retired the
first run's task anyway, leaving the matter with no blocker at all. Nothing in
1,100 tests could have found that; it needs two model calls on identical input
disagreeing.

Investigating it found the cause was not the model. The prompt said *"do not
report a deviation or an absence you cannot reference"*, the tool schema had no
`minItems` so `references: []` validated, and `findingForCheck` accepted it — **a
prompt rule that nothing enforced.** Measured across seven runs on one unchanged
sheet, the model omits references on check 1 roughly **2 in 7** runs. That rate
is unchanged and inherent; what changed is that it is now a visible failed step
carrying its reason rather than a silent finding.

Two of the conclusions drawn while investigating were wrong, both from reasoning
about a check's grammar without reading the sheet. Check 4's `absent` was called
a false positive and is a **real finding** — the concerns say *"Include general
disinheritance language"* and the field is empty. An instruction change was
written, verified and nearly shipped that would have silenced it. Check 2's
one-in-six `absent` **was** a false positive, from a statement containing two
questions, fixed in v5.

*Still owed, and named rather than implied.* #419's cross-prompt scoping and
#421's field-trigger path are proven by tests alone — the first needs a second
task-emitting prompt, the second needs a prompt that watches a field. Three of
the four fiduciary issue kinds have never fired in production. `FIELD_AUDIT_TOOL`'s
`input_schema` is still un-versioned code that shapes what the model can answer,
and the missing `minItems` was the whole subject of #422 — the same argument as
#424 applies to it. And the drafting-notes prompt has a written plan waiting on
that field being populated: it is on 3 of 44 sheets, none at the firing stages,
so re-measure before trusting the plan.

~~Do the cheap high-value fix here: move the hard-coded Massachusetts rate table out of
`lib/estateTax.ts` into `firm_settings` with effective dates, so no prompt can quote a
stale exemption.~~ **Done 2026-09-03**, ahead of the rest of phase 4 since it needed no
citation gate. `lib/estateTaxSchedules.ts` holds dated schedules with their sources,
`firm_settings.estate_tax_schedules` overrides them without a deploy, and
`resolveScheduleAsOf` returns **"not on file"** rather than the nearest figure.
Settings → Estate tax edits the federal figures by year; the Massachusetts table is
read-only there, because H.4104 carries no sunset and there is nothing to update.

Two things the work turned up that the plan had not anticipated:

- **The federal exclusion was the stale figure, not the Massachusetts table.** MA's
  schedule is legitimately open-ended. The federal basic exclusion is *indexed
  annually* — it was hard-coded at the 2025 figure and would have gone on being quoted
  forever. Its window is now closed at 2025-12-31, so any later date reports that no
  figure is on file.
- **Typecheck did not protect the display.** `formatAssetCurrency` accepts
  `number | null` and renders null as `"$0"`, so a missing federal exclusion would have
  shown as $0 of federal tax on a $20M estate — a confident number that is false, and
  worse than a stale one. Only an assertion on rendered output catches this class;
  there is now one.

**Marker gate — built 2026-09-04, ahead of the rest of 4b.**
`lib/documents/shareGate.ts` refuses to set `matter_documents.shared_at` on a firm
document that still carries unresolved `[[ MISSING: … ]]` fields. Unsharing is never
gated, and a document the client uploaded is never scanned.

Three findings during the build:

- **The gate belongs at `shared_at`, not at generation.** That column is the only thing
  standing between a draft and the client portal, so it is the only place a block is
  worth having. Blocking generation would stop the attorney working on their own draft.
- **`convert-pdf` hard-coded `marker_count: 0`** on the PDF row it created, so
  converting to PDF was a way around any marker gate — the PDF shows the markers just
  as plainly as the DOCX. It now inherits the source document's counts.
- **A scan that cannot open the file must refuse, not pass.**
  `scanDocxBufferForMarkers` reports clean on an unopenable buffer, which is right for
  a report and wrong for a gate; the gate returns `unverifiable` instead.

*Original finding, 2026-09-03.* Investigating a real client draft — a Health Care Proxy
carrying four `[[ MISSING: ]]` fields — established that `scanDocxBufferForMarkers` has
**never blocked anything**. `app/api/admin/matters/[id]/draft/route.ts:685` computes
`hasBlockingMarkers` and the comment beside it says so outright: "(The hard promote
block lands in WP3.)" WP3 was never done. Owner decision: build the block at the share
boundary rather than touch the live drafting path mid-overhaul, and scope it to
`missingFields` — those are always unintentional, unlike the deliberate blanks in a
signature block, which are not markers at all.

**4b — `output_target` wiring** (1 week). `checklist` and `task_set` write real objects
through the existing `tasks` table and `lib/stage-engine/`; `email_draft` and `draft_doc`
target the document path. Then stage-transition triggers: Drafting → QA auto-runs the
Blank Finder (extending `scanDocxBufferForMarkers`, which already gates on markers) and
blocks Client Review while a BLOCKER stands.

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

**13b — Practice tools the doc names** (3–4 weeks). **All four built 2026-09-05**, in
the priority order given: funding tracker (#399, per-asset status → confirmation with
`unfunded_asset_value`; a database trigger refuses to record a retirement account as
retitled, which is a taxable distribution of the whole account), execution requirements
engine (#400, twelve document kinds each carrying its statutory citation), signing
ceremony record (#401, which objects while the witness is still in the room rather than
after), fiduciary matrix (#402, which found **14 of 33 role chains with no successor** in
the live data before anyone opened it).

Built against tables that already existed, so only two migrations were needed. Scan-and-file
is deliberately deferred: attaching the executed PDF needs R2 wiring the workbench does not
have, and half an upload is worse than none. **None of the four has been used by a person on
a real matter, and the Massachusetts rules in the execution engine are a reading that wants
the attorney's eye.**

Plan simulator falls out of the prompt engine once documents are in scope. Also the
three missing matter facts — `special_needs`, `masshealth`, `out_of_state_property` —
and the numbered folder taxonomy, so `doc_scope: matter_drafts` maps to `03_Drafts/`
and QA can never read a client's 2004 will as a current draft.

**14 — Authoring UI + seed content** (3 weeks). Prompt editor, plus the rule-ladder
outline for the Review type. Seed the **~40-prompt Massachusetts library from
`Cornerstone_Scope.md`** (stages A–I: intake, design, drafting briefs, QA, execution,
funding, maintenance, administration, firm ops) — it is written in a consistent schema
and is largely paste-ready. Keep the estate-planning review playbooks for the
third-party-draft case. **Placeholder text is a failed phase.**

**15b — Email retargeted to Gmail** (2 weeks, sequenced by the firm's migration).
Not a removal any more. Replace the Microsoft Graph send path with Gmail; decide
whether Resend stays as the transactional sender or Gmail carries everything. Calendar
follows email to Google, or the firm runs Gmail against an Outlook calendar, which is
worse than either end state. **Gated on the migration's actual timing, which this plan
does not know.**

**16 — Probate and trust administration** (3–4 weeks). Turn on `probate_track_enabled`
rather than inventing a track: matter types, the stage H prompts, MUPC filing roadmap,
dated task generation from date of death with jurisdictional deadlines flagged,
successor-trustee onboarding.

**17 — Lawmatics two-way sync** (2 weeks). Contacts and stage. Lawmatics owns the
pipeline, Cornerstone owns the work. **Reverses scope-reduction task 7.8**, which
planned to retire the ~1,470-line Lawmatics OAuth surface — that retirement is now
cancelled and the surface needs verifying rather than deleting.

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
