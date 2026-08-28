# Cornerstone Drafting architectural assessment

**Assessment date:** 2026-08-27  
**Worktree:** `main`, clean against `origin/main` when measured  
**Purpose:** decide what to keep, refactor, replace, and delete without assuming that either the practice-management layer or the drafting layer deserves its proposed fate.

## Executive summary

Three findings should change the decision.

First, the most urgent risk is not whether drafting stays or goes. Word previews disclose a signed client-document URL to Microsoft Office Online. `lib/documents.ts:31-33` constructs the Microsoft URL, and `lib/documents.ts:167-177` routes Word previews through it. Four active callers include the client portal (`app/(portal)/documents/PortalDocumentList.tsx:111`). The repository already has an authenticated, in-process Mammoth preview at `lib/documents.ts:180-190`. This is a confirmed confidentiality defect with a low-effort remedy.

Second, the practice-management domain is a keeper, but it is not yet a staff-scalable platform. Matter lifecycle rules are unusually strong: the database separates client relationship from work status and rejects invalid transitions (`supabase/migrations/20260824000000_matter_lifecycle_v3.sql:3-13,43-63`). Against that, the matter list is unbounded (`lib/queries/matters.ts:18-22`), the detail page loads data in several query waves (`app/admin/matters/[id]/page.tsx:242-315`), authorization recognizes only attorney/admin in application code while many database policies admit va/staff (`proxy.ts:9-13`; `supabase/migrations/20260712000000_lite_communications.sql:158-174`), and there is no matter-scoped staff authorization model. These are targeted refactors, not grounds for a rewrite.

Third, “keep CRM, replace drafting” draws the boundary incorrectly. The CRM person table is both a trigger-maintained identity projection and the owner of real marketing state. It duplicates names and contact details from `client_intake`/`contacts`, but application routes actively write marketing status, segments, preferences, consent, and deduplication state (`app/api/admin/crm/profiles/[intakeId]/route.ts:39-82`; `lib/crm/campaignDispatch.ts:168-177`). It should be normalized before any retirement decision, not deleted now. Drafting has valuable workflow, payload, manifest, provenance, and regression assets. Its risky boundary is narrower: three renderer families, a 444-line OOXML/Nunjucks repair engine (`lib/estateGenerator/node/templateRenderer.ts:24-75,390-444`), and a per-document fallback recorded under the retired label `python_fallback` (`app/api/admin/matters/[id]/draft/route.ts:303-395`). Preserve the drafting contracts; benchmark and consolidate or replace the renderers against attorney-reviewed golden documents.

The highest-leverage work is therefore: stop the Office Online disclosure; add an application CI gate; remove PII-bearing logs; make workflow jobs recoverable; correct configuration drift; then address staff authorization, unbounded reads, identity resolution, the unfinished contacts cutover, and design-sheet field duplication. None requires a from-scratch rewrite.

## Method and measured baseline

All counts below were re-measured in the current worktree. Directory scopes are stated because “lines in the application” has more than one reasonable definition.

| Measurement | Current count | Scope |
|---|---:|---|
| Application TypeScript | 1,239 files / 191,608 lines | `.ts`/`.tsx` under `app`, `lib`, `components`, `hooks`, `packages` |
| Tests | 420 files / 67,505 lines | `.ts`/`.tsx` under `tests` |
| API routes | 283 | `app/**/route.ts` |
| Migrations | 167 files / 25,477 lines | `supabase/migrations/*.sql` |
| Generated schema | 118 tables, 10 views | `types/supabase.generated.ts:16-8763` |
| Generated columns | 1,792 table columns + 252 view columns = 2,044 | `Row` fields in generated schema |
| Change rate | 719 commits on 46 active dates | Git history since 2026-07-01 |
| Application env names | 110 | distinct `process.env.*` names in application source |
| Operations documentation | 922 lines | `README.md`, `OPERATIONS_RUNBOOK.md`, `VERCEL_ENV_CHECKLIST.md` |

The 191,608-line definition excludes SQL, scripts, and other JavaScript. A broader repository-source count is therefore larger; that is a scope difference, not contradictory evidence.

Verification on this machine:

- `npm run lint`: exit 0, 0 errors, 19 warnings.
- `npm run typecheck`: stopped on one missing installed package, `@radix-ui/react-context-menu`. The dependency is declared in `package.json:50` and `package-lock.json:21,3757`, but absent from this checkout's `node_modules`; this is an environment failure, not evidence that source does not typecheck.
- `npm test -- --reporter=dot`: 416 files passed, one file failed to load for the same missing installed package; 4,438 tests passed and one skipped in 299 seconds.
- No test instantiates a live Supabase client. Database behavior is tested through mocks and migration/source assertions. Of 420 test files, 183 read source files directly and 177 combine `readFileSync` with `toContain`/`toMatch`. These tests are useful contracts, but they are not evidence that RLS, triggers, concurrency, or migrations work against Postgres.

### Evidence labels

- **Finding:** the code supports a concrete failure or incorrect behavior.
- **Scaling boundary:** reasonable for one operator, but demonstrably painful or unsafe with staff or volume.
- **Reasonable design choice:** not a defect; another design could be preferred.
- **Inference:** intent is not explicit and is identified as such.
- **Uncertain:** additional production or provider evidence is required.

## Subsystem verdicts

| Subsystem | Verdict | Evidence and reason |
|---|---|---|
| Leads and intake | **REFACTOR** | Direct scope: 86 files / 17,644 lines. `client_intake` has 132 production `.from()` call occurrences and is mentioned in 71 migration files. The lead list is paged (`lib/queries/leadList.ts:103-121`), so it is not universally unscalable. The liabilities are the 1,709-line intake wizard, the 1,076-line lead-detail client, and identity duplicated across intake/contact/matter/CRM records. Keep the workflow; reduce detail-component blast radius and finish identity normalization. |
| CRM and contacts | **REFACTOR** | Direct scope: 58 files / 5,660 lines. `cornerstone_crm_people` has 41 columns, 9 direct query call occurrences, and 10 migration-file mentions. It mirrors identity fields (`supabase/migrations/20260831000000_cornerstone_crm_foundation.sql:41-75`) but owns marketing state and is actively written by the profile and unsubscribe paths. Contacts are in a deliberate seven-step migration; steps 1-6 and 7a shipped, while the column drop in 7b is explicitly unapplied (`docs/matter-contacts-migration.md:1-5,922-983`). Complete that cutover after production integrity checks. Do not delete the people table until its CRM-owned fields have a destination. |
| Matter management | **KEEP** | Direct scope: 103 files / 18,813 lines. `matters` has 43 columns, 142 direct query call occurrences, and appears in 81 migration files. The lifecycle state machine and history are worth keeping (`supabase/migrations/20260824000000_matter_lifecycle_v3.sql:3-17,43-99`). The implementation still needs pagination, a canonical ID contract, fewer detail-page query waves, and smaller UI boundaries. |
| Billing | **KEEP** | Direct scope: 50 files / 6,008 lines; 43 test files mention billing/invoices and 9 migrations mention the principal billing tables. The model has invoices, payments, adjustments, milestones, reminders, and actor-aware RPCs. The dashboard performs eight broad reads (`lib/queries/billing.ts:279-318`), invoices are unpaged (`lib/queries/invoices.ts:196-219`), and reminder preparation performs one payments query per overdue invoice (`lib/workflowJobs.ts:158-190`). Keep the subsystem and fix the reads. |
| Design sheet | **REFACTOR** | Direct scope: 77 files / 19,390 lines. The generated table has 110 columns; code uses 32 distinct `decisions.*` namespaces; 24 production files query `design_sheets` directly. The persistence allow-list decides whether a value is a column or JSON (`lib/designSheetPersistence.ts:172-249`). `trust_protector` appears in 26 files and is `string|null` in generated types but `boolean|null` in application types (`types/supabase.generated.ts:2577`; `types/database.ts:337`). A documented dual-write disagreement reached a signed document (`lib/designSheet/dualWriteProvisions.ts:4-20`). Preserve the UI/workflow, but establish one canonical field registry and one representation per decision. |
| Drafting and templates | **REFACTOR** | Direct application scope: 128 files / 27,457 lines. Only 34 production files outside the drafting directories import the core drafting/payload/generator modules, so a renderer boundary is feasible. There are three named renderer families (`lib/documentTemplates/types.ts:1-2`). The estate renderer performs direct OOXML structural repair before Nunjucks (`lib/estateGenerator/node/templateRenderer.ts:24-75,399-443`); that is purposeful, not inherently wrong, but has a large legal-fidelity blast radius. Keep payload assembly, manifests, provenance, selection, review, and persistence. Benchmark renderer replacement/consolidation with golden documents before deciding. |
| Auth and permissions | **REFACTOR** | 212 API route files call `requireAdmin`, which is a substantial authentication baseline. The attorney/admin role set is separately encoded in 12 application files (`proxy.ts:9`; `lib/apiAuth.ts:5`; `app/admin/layout.tsx:10`, among others), while many RLS policies also admit va/staff. Server routes commonly use the service-role client after authentication: 183 API route files call `getAdminClient`. That is a reasonable solo-operator pattern, but it bypasses RLS and provides no matter/record scope when staff are added. Centralize roles and define staff authorization before scaling staff access. |
| Background jobs | **REFACTOR** | Seven Vercel crons are configured and all seven route files check `CRON_SECRET`. `workflow_jobs` has dedupe, attempts, and backoff, but claiming changes pending to running (`supabase/migrations/20261004000000_solo_practice_efficiency_billing.sql:479-490`) and only the surviving worker calls finish (`lib/workflowJobs.ts:195-220`). A process death strands a running job; no stale-running reclaim was found. The scheduled-email worker already demonstrates the missing pattern (`lib/email/scheduled.ts:114-150`). No runtime test directly exercises `processWorkflowJobs`. |
| Data model | **REFACTOR** | 118 tables and 10 views are too interconnected to replace wholesale, but the model contains targeted debt. Ten table definitions store `matter_id text` without a canonical UUID FK, including documents, messages, communications, activity, assistant messages, tabular reviews, and work runs (`supabase/migrations/20260705000001_drafting_baseline_documents.sql:5,47`; `supabase/migrations/20260710500000_lite_portal_messages.sql:5`; `supabase/migrations/20260712000000_lite_communications.sql:42,182,367`). There are 237 `::text` casts. `resolveMatterId` performs as many as seven sequential interpretations and returns an unresolved input unchanged (`lib/draftPayload/resolveMatterId.ts:3-84`); 17 production files call it. Normalize incrementally after legacy-ID inventory, not with a blind type conversion. |

## Coupling and blast radius

### Load-bearing and entangled

`matters`, `client_intake`, and `contacts` are the application's identity spine, not independent modules. Current production query occurrences are 142, 132, and 49 respectively; migration-file mentions are 81, 71, and 39. `matter_contacts` is specifically intended to unwind the old one-intake/one-household assumption (`docs/matter-contacts-migration.md:7-39`), but 7b has not removed the compatibility columns and triggers. Changing identity semantics before that cutover completes would hit leads, matters, contacts, drafting, communications, and CRM at once.

Matter detail demonstrates the result. It first resolves an ambiguous ID, loads matter/contacts/aging in parallel, loads seven more domains in a second wave, then serially obtains estate snapshot, intake shell, linked lead history, uploads, tasks, and marketing consent (`app/admin/matters/[id]/page.tsx:242-315`). The domain should remain; this composition should become explicit bounded read models.

### Extractable boundaries

- **Draft renderer:** 34 production files outside drafting import the central drafting/payload/generator modules. Payload and persistence can form a stable adapter while a renderer is replaced or compared.
- **Billing:** its model is mostly additive and its principal scale failures sit in query functions, making targeted optimization viable.
- **Campaign delivery:** campaign tables and dispatch logic are separable from CRM identity projection. `cornerstone_crm_people` cannot yet be removed because recipients and consent point to it, but the marketing machinery can retain a small person/consent contract.
- **Document preview:** the Office Online path can be removed independently because the in-app preview already exists.

### Large change amplifiers

| File | Lines | Commits touching file since 2026-07-01 | Test files naming it | Risk |
|---|---:|---:|---:|---|
| `app/admin/matters/[id]/MatterDetailClient.tsx` | 1,319 | 62 | 8 | Largest product-integration surface; changes affect nine tabs and shared rail state. |
| `app/admin/leads/[id]/LeadDetailClient.tsx` | 1,076 | 56 | 6 | High-churn lead workflow and communication state. |
| `app/admin/matters/[id]/MatterDocumentsTab.tsx` | 1,220 | 14 | 5 | Confidential documents, sharing, preview, conversion, and versioning. |
| `app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx` | 1,072 | 17 | 6 | Legal decisions coupled to design persistence and payload conversion. |
| `app/admin/components/TodayQueue.tsx` | 1,405 | 7 | 1 | Operational next-action queue with thin direct test coverage. |
| `lib/estateGenerator/node/templateRenderer.ts` | 444 | 8 | 2 | One transformation can silently alter every generated Word package. |
| `lib/workflowJobs.ts` | 223 | 1 | 0 direct runtime tests | Billing/matter automation can be lost silently after a worker death. |

“Test files naming it” measures direct references, not behavioral completeness.

## Duplication of concept

### A person exists in four shapes

The same human can be represented by:

1. `client_intake` person columns;
2. a canonical `contacts` row;
3. a matter-relative `matter_contacts` row;
4. a `cornerstone_crm_people` projection.

This is partly intentional migration scaffolding, not four equally authoritative models. The target split is sound: intrinsic person facts belong to `contacts`; relationship-to-matter facts belong to `matter_contacts` (`supabase/migrations/20260925000000_matter_contacts_join.sql:19-56`). The current risk is that compatibility columns and trigger projections remain active while the app also owns CRM-specific state. For scale, make authority explicit in code and finish step 7b only after production consistency checks.

### One design answer crosses many layers

`trust_protector` is present in 26 files across migration/schema types, application types, persistence allow-list and normalization, trust-details adapters, UI, draft payload, generator conversion, validation, manifests, templates, and tests. It changes type from text at the database boundary to boolean in the application (`types/supabase.generated.ts:2577`; `types/database.ts:337`; `lib/designSheetPersistence.ts:255-278`). This is the clearest evidence that adding a drafting answer has excessive blast radius.

The `packages/estate-fields` registry is not yet canonical: only three application/test files import it directly. A registry that does not drive schema, UI, persistence, validation, and payload generation is another representation, not a solution. Either make it generate/validate those layers or remove it after migrating its useful rules.

### Matter identity is accepted rather than typed

`resolveMatterId` accepts a matter UUID, matter number, design-sheet UUID, legacy design-sheet matter value, intake UUID, or intake matter value (`lib/draftPayload/resolveMatterId.ts:3-82`). Returning the original input at line 84 makes failure indistinguishable from successful canonicalization. This is a confirmed correctness defect, not merely unfamiliar style.

## Scaling limits for CRM and practice management

### More records

- Matters load every non-archived row, then perform a second matter-number query (`lib/queries/matters.ts:18-34`).
- Invoices load every matching invoice and then issue two `IN (...)` queries over the complete result (`lib/queries/invoices.ts:196-219`).
- The billing dashboard loads eight whole datasets (`lib/queries/billing.ts:279-318`).
- Invoice reminders perform an N+1 payments query inside the invoice loop (`lib/workflowJobs.ts:158-190`).
- Contacts are bounded, not unbounded, but silently stop at 1,000 intakes and 2,000 contacts (`lib/queries/contactsDirectory.ts:102-120`).
- Tasks and inbox already show better patterns: tasks page through bounded ranges (`lib/queries/tasks.ts:280-296`) and inbox uses a cursor and limit (`lib/queries/inbox.ts:8-31`). Those patterns can be reused.

### More staff

- Application access recognizes only attorney/admin; database policies frequently recognize attorney/admin/va/staff. **Inference:** va/staff were planned but not completed as an application role tier.
- `requireAdmin` establishes firm membership, not record assignment. Matter `responsible_attorney` is text (`supabase/migrations/20260713000000_lite_matter_details_columns.sql:10`), not a user FK used for authorization. Tasks and CRM people have assignee user FKs, but RLS generally grants staff firm-wide access.
- Service-role clients are appropriate for server orchestration, but authorization must then be enforced in every route. More staff increases the consequence of a missed object-level check.
- The CRM dashboard itself pages to a documented ceiling (`lib/queries/cornerstoneCrm.ts:338-393`), which is better than the earlier claim that no primary list paginates. The scaling problem is uneven query discipline.

### More concurrency

- Workflow jobs can be stranded in `running` after a worker death.
- Design-sheet defaults can update records on load; repository instructions acknowledge a one-time save conflict for newly seeded sheets. That is a known optimistic-concurrency edge, not evidence of general corruption.
- No live-Postgres tests exercise RLS, transaction isolation, `SKIP LOCKED`, migration ordering, or trigger recursion. Concurrency guarantees are mostly asserted by reading SQL text.

## Dead and vestigial code

### Confirmed low-impact dead symbols

The current lint run found 19 warnings, including unused executable symbols:

- `formatDate` — `app/admin/inbox/InboxClient.tsx:6`;
- `isShowAsBusy` — `lib/appointments/graphBusy.ts:45`;
- `primaryId` — `lib/designSheet/initialTrusteeNomination.ts:113`;
- `setAttr` — `lib/docxTrackedChanges.ts:132`;
- `slotContact` — `lib/draftPayload/fiduciaryDetails.ts:240`;
- two CRM constant values used only as types — `lib/queries/cornerstoneCrm.ts:14-15`.

These are DELETE candidates, but none is architecturally important.

### Vestigial compatibility state

- `python_fallback` is an active provenance label even though the Python subprocess was retired (`lib/estateGenerator/engine.ts:3-21`; `app/api/admin/matters/[id]/draft/route.ts:303-395`). Rename/migrate it so provenance says what actually generated the file.
- `contacts.client_intake_id`, `contact_roles.client_intake_id`, dual-write triggers, and `delete_intake_contact` are planned for removal in contacts step 7b (`docs/matter-contacts-migration.md:961-983`). They are transitional, not safe to delete before the documented detector passes against production.
- `cornerstone_crm_settings` has zero application query call sites and appears only in generated types and two migrations. `user_mcp_oauth_tokens` likewise has no application references. Both are deletion candidates, but **uncertain**: provider/external consumers and production rows were not inspected.

### Not dead despite zero application `.from()` calls

- `contact_merges` is written by the merge RPC and preserves reversible audit facts (`supabase/migrations/20260929000000_merge_contacts.sql:255-270`).
- `generated_document_clause_revisions` is populated by database functions and is deliberately immutable provenance (`supabase/migrations/20260715210000_estate_clause_library.sql:203-204,1078-1107`).

Absence of a direct application table query is not sufficient deletion evidence for trigger-, RPC-, audit-, or externally-owned tables.

## Risk concentration and test quality

The test suite is large and valuable: 4,438 tests executed successfully in this environment. It is strongest at UI contracts, pure transformations, source shape, and document-template invariants. It is weakest exactly where silent failures are expensive:

- zero tests instantiate a live Supabase client;
- `lib/workflowJobs.ts` has no direct runtime test;
- RLS and security-definer behavior are checked primarily through SQL text;
- 177 source-contract test files can pass while runtime imports, provider behavior, or database semantics fail;
- legal fidelity is not the same as marker completeness or XML validity.

The renderer tests support preservation of known behavior. They do not prove that every generated instrument expresses the intended legal decision. A replacement decision needs a corpus of approved input facts and attorney-reviewed expected documents, run through both renderers with semantic and visual comparison.

The files with the worst combination of size and churn are MatterDetailClient and LeadDetailClient. The highest-cost silent-failure files are different: document preview/security, design persistence, draft payload/renderer, workflow jobs, billing issuance/reminders, and webhook idempotency. Prioritize tests by consequence, not line count alone.

## Confidentiality and data handling

### Where PII lives

- Supabase/Postgres: client intake, contacts, matters, matter details, design sheets, messages, communications, billing, appointments, audit records, and generated-document metadata.
- Cloudflare R2: uploaded and generated document bytes. Download URLs are signed for 300 seconds after `userCanReadDocument` (`app/api/documents/[id]/route.ts:12-35`).
- Provider state: email/SMS delivery logs, calendar bookings, e-signature artifacts, payment events, and LLM usage/context.

### Where PII travels

- Email providers receive recipient, subject, body, and attachments (`lib/email/send.ts:296-378`).
- Twilio/Telnyx receive phone numbers and message/call contents (`lib/sms/outbound.ts:204-294`).
- Calendly/Cal.com/Microsoft Graph receive booking identity and calendar facts (`lib/bookings/sync.ts:201-238`; `lib/appointments/graphEvents.ts`).
- Firma receives signer and document data (`lib/esign/firma.ts`).
- Anthropic receives system context containing client/spouse names, children, assets, goals, concerns, and fiduciaries (`lib/adminChat/prompts.ts:148-162`; `lib/adminChat/engine.ts:376-395`). This may be an approved business choice, but it is an external confidentiality boundary and should be covered by vendor terms and firm policy.
- Microsoft Office Online receives a signed R2 URL for Word previews. This is the confirmed inappropriate path unless separately approved under a suitable legal/vendor arrangement.

### What is protected well

- Document reads authenticate, check `userCanReadDocument`, create short-lived URLs, and audit access (`app/api/documents/[id]/route.ts:12-35`).
- Sentry defaults PII collection off and strips cookies, request data, headers, query strings, and users (`lib/sentry/server.ts:16-31`; `instrumentation-client.ts:34-49`).
- Cron routes reject requests without `CRON_SECRET`.

### What relies too much on discipline

- Server service-role access bypasses RLS, so every route must perform correct object-level authorization.
- Logs contain real PII: recipient and subject in `lib/email/send.ts:349-355`, attendee email in `lib/bookings/sync.ts:382-395`, and arbitrary matter field values in `app/api/admin/matter-details/route.ts:306-307`.
- Application migrations contain 79 unique static `ENABLE ROW LEVEL SECURITY` table names, but the current production catalog was not inspected. It would be incorrect to turn that source count into a claim that a specific percentage of the 118 current tables is protected. Resolve with a linked-catalog audit of tables, views, grants, policies, and function ownership.

## Operational burden

The application has 110 application env names and 922 lines of setup/runbook material. It concurrently contains Twilio and Telnyx, Calendly and Cal.com, Resend and Mailgun, Microsoft Graph, Supabase, R2, e-signature, payments, and multiple LLM providers. That can be a reasonable transition strategy, but it makes configuration and incident diagnosis owner-specific.

There are four GitHub workflows, all database-focused. They provide migration deployment, migration-history drift, RPC checks, and generated-type drift. That is a real strength: `scripts/checkMigrationDrift.mjs:1-37` records five production migration/history incidents and the workflow now deploys merged migrations. No workflow runs the application test, lint, or typecheck suites as a merge gate.

Preview deployments are intentionally skipped (`scripts/vercel-should-build.sh:4-7,29-35`). Production invokes `npm run build:next`, not the one-hour-cache `npm run build` wrapper (`vercel.json:1-3`; `package.json:10-12`). Therefore “no PR application gate” is confirmed; “production always ships untypechecked” is not.

There is also a concrete configuration defect: `VERCEL_ENV_CHECKLIST.md:13` instructs `R2_BUCKET`, while code reads `R2_BUCKET_NAME` and otherwise defaults to `legal-documents` (`lib/r2.ts:17`; `scripts/validateEnv.mjs:16`). Document storage should not depend on a misleading checklist plus a default bucket name.

## Prioritized changes by impact / effort

| Priority | Action | Impact | Effort | Why now |
|---:|---|---|---|---|
| 1 | Replace Office Online Word preview with the existing authenticated in-app preview | Critical | Low | Stops unnecessary third-party disclosure of wills and trusts. |
| 2 | Add a PR workflow for tests, lint, and typecheck; run from a clean install | High | Low-medium | Current local suite shows how a missing installed dependency can defeat tests/typecheck while no merge gate notices. |
| 3 | Remove/redact PII-bearing server logs | High | Low | Confirmed recipient, subject, attendee-email, and arbitrary-field exposure. |
| 4 | Correct `R2_BUCKET`/`R2_BUCKET_NAME`; fail closed rather than defaulting in production | High | Low | Prevents writes/checks against an unintended bucket. |
| 5 | Add stale-running workflow-job recovery and batch reminder payment reads | High | Medium | Prevents permanently lost jobs and removes an invoice-count N+1. |
| 6 | Paginate matters and invoices; aggregate billing on the server | High | Medium | Direct path from hundreds to thousands of matters without changing domain behavior. |
| 7 | Centralize role vocabulary and define matter/record scope before enabling staff/VA access | High | Medium-high | Existing database and application role sets disagree; current service-role model is firm-wide. |
| 8 | Make matter identity explicit: typed resolver inputs, fail on unresolved IDs, then remove legacy branches | High | Medium | Eliminates up to seven lookups and downstream false validity. Must coordinate with contacts step 7b. |
| 9 | Complete contacts migration step 7b after production detector/row audit | High | Medium | Removes old household authority and dual-write triggers after the staged safety gate. |
| 10 | Repair design-sheet field types and make one registry drive persistence, validation, payload, and templates | High | Medium-high | Reduces the 26-file blast radius demonstrated by `trust_protector`. |
| 11 | Build an attorney-approved golden-document corpus; compare and consolidate drafting renderers | High | Medium | Establishes evidence for KEEP versus REPLACE at the correct boundary. |
| 12 | Delete confirmed unused symbols; investigate dormant CRM settings/MCP token tables before dropping | Low | Low | Reduces noise without mistaking audit or RPC tables for dead code. |

## Where I disagree with the owner's framing

I disagree with both halves as currently stated.

The “CRM” is not one coherent keeper. Practice management—leads, matters, tasks, billing, contacts, communications—is the load-bearing product and should be kept. `cornerstone_crm_people` is a hybrid: duplicated identity projection plus authoritative marketing/consent state. It should be normalized and possibly retired later, but the evidence does not support deleting it now. Campaign delivery is a distinct, real subsystem and does not require preserving every identity mirror.

The “drafting layer” is not one coherent liability. The workflow, design decisions, payload assembly, package selection, template provenance, access controls, review, and generated-document history contain substantial reusable value. The rendering implementations are the concentrated liability: multiple engines, direct OOXML surgery, inconsistent provenance labels, and no attorney-approved semantic oracle. Replacing the whole drafting layer would discard the strongest contracts and expand risk. Keeping it unchanged would preserve the weakest boundary.

The decision I support is therefore:

1. keep and refactor practice management;
2. normalize CRM identity before deciding what to delete;
3. keep drafting contracts and workflow;
4. benchmark, consolidate, or replace only the renderer boundary;
5. fix cross-cutting confidentiality, CI, authorization, identity, and job-durability defects before either strategic migration.

No evidence found requires a from-scratch rewrite. Targeted change is feasible because the major liabilities have identifiable seams: preview, query functions, auth helpers, job claim/finish, contact compatibility columns, design persistence, and renderer adapters.

## Uncertainties requiring production or provider evidence

- Current production RLS/grant/function-owner catalog: run a linked, read-only policy audit. Migration source alone cannot establish current enforcement.
- Whether `cornerstone_crm_settings` or `user_mcp_oauth_tokens` has production rows or external consumers: inspect catalog/data and provider integration inventory before deletion.
- Whether staff/VA roles are intended for near-term use: if not, remove dormant policy vocabulary; if yes, implement application access and record scope first.
- Drafting legal fidelity: requires approved fact patterns and expected documents, not more source-contract assertions.
- Actual list sizes, query latency, and slow-query plans in production: obtain table cardinalities and `pg_stat_statements`/query-plan evidence before choosing indexes or materialization.
- Whether Microsoft Office Online use is covered by an approved confidentiality agreement: absent that evidence, remove the path.
