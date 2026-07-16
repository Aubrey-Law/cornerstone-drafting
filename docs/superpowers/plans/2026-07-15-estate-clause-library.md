# Massachusetts Estate Clause Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Massachusetts-only, attorney-authored estate clause library with independent publication approval, deterministic template selection, audited overrides, and exact per-document clause provenance.

**Architecture:** Add immutable clause revisions and publication pointers in Supabase, expose them through focused server-side repositories and authenticated admin routes, and add a Clause Library tab to the existing Template Center. Preserve the existing `include_clause(...)` renderer contract by injecting a frozen clause snapshot into the Node generator; keep the current JSON store behind a rollback flag until parity and production verification pass.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase/Postgres/RLS, Vitest, Testing Library, Nunjucks-style estate text rendering, Docxtemplater/PizZip, Cloudflare R2.

## Global Constraints

- Massachusetts (`MA`) is the only supported jurisdiction in v1.
- Published revision content is immutable; changes always create a new revision.
- A publisher must have role `attorney` or `admin` and must be a different user from the revision author.
- AI may draft or compare text but may never submit, approve, or publish.
- Templates own Word styles, numbering, indentation, tables, headers, footers, and sections; clause records contain structured text only.
- Template-selection rules remain code-owned and deterministic.
- A matter override may only force-include or force-omit a conditional clause already referenced by the target template; it may not insert arbitrary text or select a historical revision.
- Generation fails closed when a requested publication, placeholder, dependency, hash, or manifest persistence step is invalid.
- Existing generated documents never change automatically; regeneration creates a new document/version and provenance manifest.
- Preserve the drafting no-touch boundary: adapt the existing clause-store interface and draft-save seam; do not port drafting code from `aubrey-law-app` or redesign the design sheet, payload assembly, or templates.
- Keep each task independently green. Use targeted Vitest commands first, then `npm test -- --run <files>` for the touched slice.
- Baseline repository failures documented in `AGENTS.md` are not regressions: full lint has five existing errors, typecheck errors are confined to tests, and three unrelated tests fail on a clean checkout.

## File Map

**Database and import**

- Create `supabase/migrations/20260715210000_estate_clause_library.sql`: clause identity, drafts, revisions, events, publications, overrides, provenance, guards, RLS, and workflow RPCs.
- Create `scripts/import-estate-clauses.ts`: idempotently stage the current JSON library as submitted baseline revisions without publishing it.

**Domain library**

- Create `lib/estateClauses/types.ts`: shared clause, revision, snapshot, override, and manifest contracts.
- Create `lib/estateClauses/validation.ts`: restricted placeholder/dependency validation, cycle detection, hashing, and document-type compatibility.
- Create `lib/estateClauses/fileRepository.ts`: read-only adapter around the current JSON library for parity and rollback.
- Create `lib/estateClauses/repository.ts`: Supabase authoring, review, publication, snapshot, override, and provenance operations.
- Create `lib/estateClauses/source.ts`: feature-gated source selection with database fail-closed behavior.
- Modify `lib/estateGenerator/node/clauses.ts`: render from an injected immutable snapshot and record per-document provenance.
- Modify `lib/estateGenerator/node/generate.ts`: resolve one frozen snapshot per generation and attach a manifest to each file.
- Modify `lib/estateGenerator/node/types.ts`: expose per-file manifest metadata.

**Admin APIs and UI**

- Create routes under `app/api/admin/settings/estate-clauses/` for list/create, draft save, submit, preview, publish/request-changes, and AI drafting.
- Create `app/admin/settings/estate-clauses/types.ts`, `EstateClauseLibrarySection.tsx`, `EstateClauseEditor.tsx`, and `EstateClauseReviewPanel.tsx`.
- Modify `app/admin/settings/TemplateCenter.tsx`: add the Clause Library tab.
- Create `app/api/admin/matters/[id]/estate-clause-overrides/route.ts`.
- Create `app/admin/drafting/[matterId]/ClauseOverridesPanel.tsx`.
- Modify `app/admin/drafting/[matterId]/GenerateStep.tsx`: show overrides before preflight/generation.

**Draft persistence**

- Create `lib/estateClauses/persistGeneratedDocument.ts`: one RPC call for document, initial version, and manifest rows.
- Modify `app/api/admin/matters/[id]/draft/route.ts`: carry per-file manifests and use atomic database registration for Node estate documents.

**Tests**

- Create `tests/estate-clause-schema.test.ts`, `tests/estate-clause-validation.test.ts`, `tests/estate-clause-workflow.test.ts`, `tests/estate-clause-admin-ui.test.tsx`, `tests/estate-clause-overrides.test.tsx`, `tests/estate-clause-parity.test.ts`, and `tests/estate-clause-provenance.test.ts`.
- Modify `tests/node-estate-generator.test.ts` and `tests/draft-generation-route.test.ts` only for integration assertions that belong to those existing suites.

## Execution Order

Execute tasks in this dependency order: **1, 2, 3, 7, 8, 4, 5, 6, 9, 10**. Tasks 7 and 8 establish the injected snapshot and per-file manifest interfaces required by candidate-preview APIs and the override UI. The sections remain grouped by surface so the authoring workflow can be reviewed together, but every implementation checkpoint must follow this dependency order.

---

### Task 1: Add the immutable database model and workflow guards

**Files:**
- Create: `supabase/migrations/20260715210000_estate_clause_library.sql`
- Create: `tests/estate-clause-schema.test.ts`

**Interfaces:**
- Produces RPCs: `submit_estate_clause_revision(uuid, uuid)`, `request_estate_clause_changes(uuid, uuid, text)`, `publish_estate_clause_revision(uuid, uuid, uuid)`, and `persist_generated_estate_document(jsonb, jsonb)`.
- Produces tables consumed by all later tasks: `estate_clauses`, `estate_clause_working_drafts`, `estate_clause_revisions`, `estate_clause_review_events`, `estate_clause_publications`, `matter_estate_clause_overrides`, and `generated_document_clause_revisions`.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260715210000_estate_clause_library.sql'), 'utf8')

describe('estate clause schema', () => {
  it('creates immutable revisions, two-person publication, overrides, and normalized provenance', () => {
    for (const table of ['estate_clauses', 'estate_clause_working_drafts', 'estate_clause_revisions', 'estate_clause_review_events', 'estate_clause_publications', 'matter_estate_clause_overrides', 'generated_document_clause_revisions']) {
      expect(sql).toContain(`public.${table}`)
    }
    expect(sql).toContain("jurisdiction text NOT NULL DEFAULT 'MA' CHECK (jurisdiction = 'MA')")
    expect(sql).toContain('v_author_id = p_actor_id')
    expect(sql).toContain('v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id')
    expect(sql).toContain('prevent_estate_clause_revision_mutation')
    expect(sql).toContain('UNIQUE (document_version_id, inclusion_position)')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('TO service_role')
  })
})
```

- [ ] **Step 2: Run the test and verify the missing migration failure**

Run: `npx vitest run tests/estate-clause-schema.test.ts`

Expected: FAIL with `ENOENT ... 20260715210000_estate_clause_library.sql`.

- [ ] **Step 3: Create the migration with exact constraints**

Use UUID identities, `text[]` document types, JSONB validation reports, SHA-256 checks (`content_hash ~ '^[0-9a-f]{64}$'`), foreign keys to `public.users` for workflow actors, and a normalized manifest foreign-keyed to `document_versions`. Add these non-negotiable guards:

```sql
CREATE OR REPLACE FUNCTION public.prevent_estate_clause_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Estate clause revisions are immutable';
END;
$$;

CREATE TRIGGER estate_clause_revisions_immutable
BEFORE UPDATE OR DELETE ON public.estate_clause_revisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();

CREATE TABLE public.matter_estate_clause_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('force_include', 'force_omit')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, clause_id)
);

CREATE TABLE public.generated_document_clause_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES public.estate_clause_revisions(id) ON DELETE RESTRICT,
  clause_key text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  inclusion_position integer NOT NULL CHECK (inclusion_position >= 0),
  selection_reason text NOT NULL CHECK (selection_reason IN ('template_rule', 'attorney_override')),
  override_id uuid REFERENCES public.matter_estate_clause_overrides(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, inclusion_position)
);
```

`submit_estate_clause_revision` must lock the working draft, require its `author_id` to equal `p_actor_id`, create the next revision number, append `submitted`, and delete the working draft in one transaction. `request_estate_clause_changes` requires the actor to differ from the author and appends `changes_requested`. `publish_estate_clause_revision` requires the actor to differ from the author, verifies current validation, compares the expected current revision, upserts the pointer, and appends both `approved` and `published` in the same transaction.

Grant direct authenticated reads only where the UI needs them; keep writes behind service-role route handlers/RPCs. Policies allow staff roles to read current publications and allow only `attorney`/`admin` to read drafts and review history.

- [ ] **Step 4: Run the schema test**

Run: `npx vitest run tests/estate-clause-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Reset local Supabase and verify the functions exist**

Run: `npx supabase db reset`

Expected: migration completes without SQL errors; `supabase/seed.sql` still applies.

Run: `npx supabase db lint`

Expected: no new errors from `20260715210000_estate_clause_library.sql`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715210000_estate_clause_library.sql tests/estate-clause-schema.test.ts
git commit -m "Add estate clause library schema"
```

### Task 2: Define clause contracts and fail-closed validation

**Files:**
- Create: `lib/estateClauses/types.ts`
- Create: `lib/estateClauses/validation.ts`
- Create: `tests/estate-clause-validation.test.ts`

**Interfaces:**
- Produces `EstateClauseContent`, `PublishedEstateClause`, `EstateClauseSnapshot`, `EstateClauseOverride`, and `EstateClauseManifestEntry`.
- Produces `validateEstateClauseContent(content, catalog)`, `hashEstateClauseContent(content)`, and `assertNoClauseCycles(catalog)`.

- [ ] **Step 1: Write failing unit tests for placeholders, hashes, compatibility, and cycles**

```ts
import { describe, expect, it } from 'vitest'
import { assertNoClauseCycles, hashEstateClauseContent, validateEstateClauseContent } from '@/lib/estateClauses/validation'

const clause = { text: 'I appoint {{ fiduciaries.agent.primary.full_name | name }}.', requiredFields: ['fiduciaries.agent.primary.full_name'], nestedClauseKeys: [] }

describe('estate clause validation', () => {
  it('accepts declared fields and produces a stable hash', () => {
    expect(validateEstateClauseContent(clause, new Set())).toEqual([])
    expect(hashEstateClauseContent(clause)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('rejects undeclared fields and unsupported template syntax', () => {
    expect(validateEstateClauseContent({ ...clause, text: '{{ client.secret }} {% for x in y %}' }, new Set()))
      .toEqual(expect.arrayContaining([expect.stringMatching(/client.secret/), expect.stringMatching(/for/)]))
  })
  it('rejects nested cycles', () => {
    expect(() => assertNoClauseCycles(new Map([['a', ['b']], ['b', ['a']]]))).toThrow(/cycle: a -> b -> a/i)
  })
})
```

- [ ] **Step 2: Verify the tests fail**

Run: `npx vitest run tests/estate-clause-validation.test.ts`

Expected: FAIL because `@/lib/estateClauses/validation` does not exist.

- [ ] **Step 3: Add the exact domain types**

```ts
export type EstateDocumentType = 'will' | 'trust' | 'durable_power_of_attorney' | 'health_care_directive' | 'hipaa_authorization' | 'ancillary'
export type EstateClauseOverrideAction = 'force_include' | 'force_omit'

export interface EstateClauseContent {
  text: string
  requiredFields: string[]
  nestedClauseKeys: string[]
  conditionField?: string | null
}

export interface PublishedEstateClause extends EstateClauseContent {
  clauseId: string
  clauseKey: string
  title: string
  jurisdiction: 'MA'
  documentTypes: EstateDocumentType[]
  revisionId: string
  revisionNumber: number
  contentHash: string
}

export interface EstateClauseOverride {
  id: string
  clauseId: string
  clauseKey: string
  action: EstateClauseOverrideAction
  reason: string
  actorId: string
}

export interface EstateClauseManifestEntry {
  clauseId: string
  clauseKey: string
  revisionId: string
  contentHash: string
  inclusionPosition: number
  selectionReason: 'template_rule' | 'attorney_override'
  overrideId: string | null
}

export interface EstateClauseSnapshot {
  jurisdiction: 'MA'
  clauses: ReadonlyMap<string, PublishedEstateClause>
  overrides: ReadonlyMap<string, EstateClauseOverride>
  source: 'database' | 'file'
}
```

- [ ] **Step 4: Implement deterministic canonical hashing and restricted validation**

Allow variable expressions and the filters already supported by `renderNodeEstateText`; reject block tags other than nested `include_clause(...)`, unknown fields, duplicate required fields, unknown nested keys, and cycles. Canonicalize arrays with sorted copies before `JSON.stringify` and hash with `createHash('sha256')`.

```ts
export function hashEstateClauseContent(content: EstateClauseContent): string {
  const canonical = JSON.stringify({
    text: content.text.replace(/\r\n/g, '\n'),
    requiredFields: [...new Set(content.requiredFields)].sort(),
    nestedClauseKeys: [...new Set(content.nestedClauseKeys)].sort(),
    conditionField: content.conditionField ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex')
}
```

- [ ] **Step 5: Run validation tests and existing renderer tests**

Run: `npx vitest run tests/estate-clause-validation.test.ts tests/node-estate-generator.test.ts`

Expected: new tests PASS; existing Node generator suite has no new failures.

- [ ] **Step 6: Commit**

```bash
git add lib/estateClauses/types.ts lib/estateClauses/validation.ts tests/estate-clause-validation.test.ts
git commit -m "Add estate clause validation contracts"
```

### Task 3: Implement repository workflow and baseline import

**Files:**
- Create: `lib/estateClauses/repository.ts`
- Create: `scripts/import-estate-clauses.ts`
- Create: `tests/estate-clause-workflow.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `listEstateClauses`, `saveEstateClauseDraft`, `submitEstateClauseDraft`, `requestEstateClauseChanges`, `publishEstateClauseRevision`, `loadPublishedEstateClauseSnapshot`, and `importBundledEstateClauses`.

- [ ] **Step 1: Write repository tests with a narrow fake Supabase client**

Test these exact outcomes: draft saves never touch publications; submission uses the RPC; author self-review is rejected before RPC; publication sends `expectedCurrentRevisionId`; snapshot rejects a hash mismatch; import preserves every JSON key and maps `condition` to `conditionField`.

```ts
await expect(publishEstateClauseRevision({ revisionId: 'r2', actorId: 'author', authorId: 'author', expectedCurrentRevisionId: 'r1', client }))
  .rejects.toThrow('A different attorney or administrator must publish this revision.')
expect(client.rpc).not.toHaveBeenCalled()
```

- [ ] **Step 2: Verify the repository tests fail**

Run: `npx vitest run tests/estate-clause-workflow.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement repository functions around service-role calls**

Use explicit column lists. Convert snake_case rows to the Task 2 contracts in one mapper. Recompute each published revision hash before adding it to a snapshot; throw `Published clause <key> failed its integrity check` on mismatch. Load all current publications in one query and all matter overrides in a second query, then freeze both maps.

```ts
export async function publishEstateClauseRevision(args: PublishArgs) {
  if (args.actorId === args.authorId) {
    throw new Error('A different attorney or administrator must publish this revision.')
  }
  const { data, error } = await args.client.rpc('publish_estate_clause_revision', {
    p_revision_id: args.revisionId,
    p_actor_id: args.actorId,
    p_expected_current_revision_id: args.expectedCurrentRevisionId,
  })
  if (error) throw new Error(error.message)
  return data
}
```

- [ ] **Step 4: Add the idempotent import command**

Add `"clauses:import": "tsx scripts/import-estate-clauses.ts"` to `package.json`. The script reads `tools/aubreylaw-docgeneration/clauses` and `states/MA/clauses`, upserts stable identities by key, and creates a submitted revision only when the canonical hash is new. It must print counts for `created`, `unchanged`, and `requiresReview`; it must never call the publication RPC.

- [ ] **Step 5: Run repository tests and dry-run the importer locally**

Run: `npx vitest run tests/estate-clause-workflow.test.ts`

Expected: PASS.

Run: `npm run clauses:import -- --dry-run`

Expected: reports 22 bundled clauses, including the state-specific affidavit, and zero publications written.

- [ ] **Step 6: Commit**

```bash
git add lib/estateClauses/repository.ts scripts/import-estate-clauses.ts tests/estate-clause-workflow.test.ts package.json
git commit -m "Add estate clause repository workflow"
```

### Task 4: Add authenticated admin routes

**Files:**
- Create: `app/api/admin/settings/estate-clauses/route.ts`
- Create: `app/api/admin/settings/estate-clauses/[clauseId]/draft/route.ts`
- Create: `app/api/admin/settings/estate-clauses/[clauseId]/submit/route.ts`
- Create: `app/api/admin/settings/estate-clauses/[clauseId]/review/route.ts`
- Create: `app/api/admin/settings/estate-clauses/[clauseId]/preview/route.ts`
- Create: `app/api/admin/settings/estate-clauses/draft-ai/route.ts`
- Modify: `tests/estate-clause-workflow.test.ts`

**Interfaces:**
- Produces JSON endpoints consumed by the Task 5 UI.
- Preview returns `{ files: Array<{ filename: string; base64: string }>, validationReport }` and succeeds only when the candidate revision appears in the generated manifest.

- [ ] **Step 1: Add failing route contract tests**

Assert every route calls `requireAdmin(req)`, validates UUID/body fields, and delegates legal state transitions to repository/RPC functions. Assert the AI route calls `consumeRateLimit`, quotes user content, and returns draft text only; assert it has no import of submit/review/publish functions.

- [ ] **Step 2: Verify route tests fail**

Run: `npx vitest run tests/estate-clause-workflow.test.ts`

Expected: FAIL on missing route files.

- [ ] **Step 3: Implement list/create, draft, submit, and review routes**

Use `requireAdmin`, `getAdminClient`, status 400 for invalid input, 403 for author self-review, 404 for unknown records, 409 for stale publication or failed validation, and 500 only for unexpected errors. The review route accepts only:

```ts
type ReviewBody =
  | { action: 'request_changes'; comment: string }
  | { action: 'publish'; expectedCurrentRevisionId: string | null }
```

For `publish`, load the revision author and current publication server-side; never trust author/current IDs from the browser.

- [ ] **Step 4: Implement candidate preview without publication**

Load the representative matter payload, build a temporary snapshot that replaces only the candidate key, generate compatible Node documents with the injected snapshot, scan markers, and reject the preview if no generated file manifest contains the candidate revision. Do not persist preview files or manifests.

- [ ] **Step 5: Implement optional AI drafting with no workflow authority**

Follow `app/api/admin/engagement-clauses/draft/route.ts`: rate limit by authenticated user, use `resolveFirmModel('drafting')`, apply `PROMPT_INJECTION_GUARDRAIL`, and return `{ proposal: { text } }`. The system prompt must say the text is an attorney-review draft and must not invent client facts.

- [ ] **Step 6: Run route/workflow tests**

Run: `npx vitest run tests/estate-clause-workflow.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/settings/estate-clauses tests/estate-clause-workflow.test.ts
git commit -m "Add estate clause admin APIs"
```

### Task 5: Build the Clause Library authoring and review UI

**Files:**
- Create: `app/admin/settings/estate-clauses/types.ts`
- Create: `app/admin/settings/estate-clauses/EstateClauseEditor.tsx`
- Create: `app/admin/settings/estate-clauses/EstateClauseReviewPanel.tsx`
- Create: `app/admin/settings/estate-clauses/EstateClauseLibrarySection.tsx`
- Modify: `app/admin/settings/TemplateCenter.tsx`
- Create: `tests/estate-clause-admin-ui.test.tsx`

**Interfaces:**
- Consumes Task 4 routes.
- Produces an administrator Template Center tab labeled `Clause library`.

- [ ] **Step 1: Write failing interaction tests**

Use Testing Library to cover search/status filtering, draft preservation after a failed save, disabled submission until validation passes, side-by-side published/proposed text, mandatory change summaries, author self-publish suppression, confirmation of the exact clause key, and visible conflict errors.

```tsx
render(<EstateClauseLibrarySection currentUserId="reviewer" />)
await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))
expect(screen.getByText('Published revision')).toBeInTheDocument()
expect(screen.getByText('Proposed revision')).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
```

- [ ] **Step 2: Verify UI tests fail**

Run: `npx vitest run tests/estate-clause-admin-ui.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement typed UI state and editor**

The editor contains title, compatible document types, structured text, required fields, nested keys, condition field, change summary, Save draft, Draft with AI, Preview, and Submit for review. AI output enters the editor only after explicit `Accept draft`; it never submits automatically.

- [ ] **Step 4: Implement independent review and publication**

Show text diff, validation report, downloadable preview files, author, change summary, and current publication. Require typing the stable clause key before publication. Hide/disable publish for the author and show `A different attorney or administrator must publish this revision.`

- [ ] **Step 5: Add the Template Center tab**

```tsx
<TabsTrigger value="clauses">Clause library</TabsTrigger>
<TabsContent value="clauses">
  <EstateClauseLibrarySection currentUserId={currentUserId} />
</TabsContent>
```

Pass the current authenticated user ID into `TemplateCenter` from `StaffSettingsClient`; keep the entire Template Center administrator-only as it is today.

- [ ] **Step 6: Run UI and existing template-center tests**

Run: `npx vitest run tests/estate-clause-admin-ui.test.tsx tests/document-template-workflow.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/admin/settings/estate-clauses app/admin/settings/TemplateCenter.tsx app/admin/settings/StaffSettingsClient.tsx tests/estate-clause-admin-ui.test.tsx tests/document-template-workflow.test.ts
git commit -m "Add estate clause library admin UI"
```

### Task 6: Add constrained matter overrides

**Files:**
- Create: `app/api/admin/matters/[id]/estate-clause-overrides/route.ts`
- Create: `app/admin/drafting/[matterId]/ClauseOverridesPanel.tsx`
- Create: `lib/estateClauses/templateReferences.ts`
- Modify: `app/admin/drafting/[matterId]/GenerateStep.tsx`
- Create: `tests/estate-clause-overrides.test.tsx`

**Interfaces:**
- Produces GET/PUT/DELETE override operations keyed by canonical matter ID and stable clause key.
- Produces `ReadonlyMap<string, EstateClauseOverride>` consumed by snapshot resolution.

- [ ] **Step 1: Write failing API and UI tests**

Cover: only current active publications appear; only conditional keys referenced by selected templates are eligible; force-include/force-omit require a reason of at least ten characters; manual clause text and historical revision IDs are rejected; saving an override invalidates prior preflight in `GenerateStep`.

- [ ] **Step 2: Verify override tests fail**

Run: `npx vitest run tests/estate-clause-overrides.test.tsx`

Expected: FAIL because the route and panel do not exist.

- [ ] **Step 3: Implement server-side eligibility calculation**

Create `referencedClauseKeys(template: Buffer): string[]` in `templateReferences.ts`. Use PizZip to read every `word/*.xml` entry, join split Word runs with the same XML-text normalization used by `templateRenderer.ts`, match only literal `include_clause("<stable-key>")` calls, deduplicate, and sort. Reject dynamic clause-key expressions because they cannot be audited. Intersect the referenced keys from selected package templates with current publications where `condition_field IS NOT NULL` and compatible document types overlap. The PUT body is exactly:

```ts
interface OverrideRequest {
  clauseKey: string
  action: 'force_include' | 'force_omit'
  reason: string
}
```

Resolve the canonical matter ID server-side, reject ineligible keys with 409, and record `created_by` from auth.

- [ ] **Step 4: Implement the panel and preflight invalidation**

Show default outcome, override action, current published revision number, and reason. On any successful PUT/DELETE, clear `preflight` and `preflightReady` so generation cannot reuse stale selection results.

- [ ] **Step 5: Run override and GenerateStep tests**

Run: `npx vitest run tests/estate-clause-overrides.test.tsx tests/draft-generation-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/matters/[id]/estate-clause-overrides app/admin/drafting/[matterId]/ClauseOverridesPanel.tsx app/admin/drafting/[matterId]/GenerateStep.tsx lib/estateClauses/templateReferences.ts tests/estate-clause-overrides.test.tsx
git commit -m "Add audited estate clause overrides"
```

### Task 7: Add database/file source adapters and prove parity

**Files:**
- Create: `lib/estateClauses/fileRepository.ts`
- Create: `lib/estateClauses/source.ts`
- Create: `tests/estate-clause-parity.test.ts`
- Modify: `lib/estateGenerator/node/clauses.ts`

**Interfaces:**
- Produces `loadEstateClauseSnapshot({ matterId, jurisdiction, client })`.
- Extends `createNodeClauseStore` with `snapshot` and returns a fresh per-document report.

- [ ] **Step 1: Write failing parity and fail-closed tests**

For every bundled key, compare text, title, condition, required fields, jurisdiction override, inclusion/skipping, missing-field markers, and nested rendering between the legacy store and `fileRepository`. Add a source-selection test proving `ESTATE_CLAUSE_SOURCE=database` does not fall back when a publication is missing or corrupt.

- [ ] **Step 2: Verify parity tests fail**

Run: `npx vitest run tests/estate-clause-parity.test.ts`

Expected: FAIL because the adapters do not exist.

- [ ] **Step 3: Implement the read-only file adapter**

Map base and `states/MA` JSON to synthetic immutable publications using `file:<contentHash>` revision IDs. State files override base keys. Preserve `review_status`; the adapter may load draft clauses only when the existing `allowDraft` test/rollback option explicitly permits them.

- [ ] **Step 4: Implement source selection**

```ts
export function estateClauseSource(): 'file' | 'database' {
  return process.env.ESTATE_CLAUSE_SOURCE === 'database' ? 'database' : 'file'
}

export async function loadEstateClauseSnapshot(args: LoadSnapshotArgs) {
  return estateClauseSource() === 'database'
    ? loadPublishedEstateClauseSnapshot(args)
    : loadBundledEstateClauseSnapshot(args)
}
```

No `catch` may switch a database request to file mode. Rollback requires changing the environment flag and starting a new generation.

- [ ] **Step 5: Adapt `createNodeClauseStore` without changing template calls**

Accept `snapshot: EstateClauseSnapshot`, apply a force-omit before condition evaluation and force-include instead of condition evaluation, reject unknown/missing publications, record selection reason and override ID, and preserve the public `include(clauseId, context, lookupState?)` signature.

- [ ] **Step 6: Run parity and Node generator tests**

Run: `npx vitest run tests/estate-clause-parity.test.ts tests/node-estate-generator.test.ts tests/docx-template-integrity.test.ts`

Expected: PASS with file source; output buffers and marker reports remain equivalent.

- [ ] **Step 7: Commit**

```bash
git add lib/estateClauses/fileRepository.ts lib/estateClauses/source.ts lib/estateGenerator/node/clauses.ts tests/estate-clause-parity.test.ts tests/node-estate-generator.test.ts
git commit -m "Add estate clause source adapters"
```

### Task 8: Freeze one snapshot and attach per-file manifests

**Files:**
- Modify: `lib/estateGenerator/node/types.ts`
- Modify: `lib/estateGenerator/node/generate.ts`
- Modify: `lib/estateGenerator/node/clauses.ts`
- Modify: `tests/node-estate-generator.test.ts`
- Create: `tests/estate-clause-provenance.test.ts`

**Interfaces:**
- `GenerateNodeEstatePackageArgs` gains `clauseSnapshot?: EstateClauseSnapshot`.
- `NodeEstateGeneratedFile` gains `clauseManifest: EstateClauseManifestEntry[]`.
- `generateEstatePlanDocumentsNode(payload, options?)` accepts `{ matterId?: string; clauseSnapshot?: EstateClauseSnapshot }`.

- [ ] **Step 1: Write failing snapshot/provenance tests**

Test that one loader call serves a multi-package generation, a publication change after load cannot mix versions, each file contains only clauses actually rendered in that file, inclusion positions are contiguous from zero, forced inclusion is `attorney_override`, and nested clauses receive their own manifest entries.

- [ ] **Step 2: Verify provenance tests fail**

Run: `npx vitest run tests/estate-clause-provenance.test.ts`

Expected: FAIL because generated files have no `clauseManifest`.

- [ ] **Step 3: Add the manifest type to generated files**

```ts
export interface NodeEstateGeneratedFile {
  name: string
  buffer: Buffer
  title: string
  owner: string | null
  clauseSource: 'database' | 'file'
  clauseManifest: EstateClauseManifestEntry[]
  unresolvedMarkers?: string[]
  missingFields?: string[]
  templateId?: string
  templateVersionId?: string | null
  templateSource?: 'bundled' | 'published'
}
```

- [ ] **Step 4: Resolve once and create a fresh report per document**

`generateEstatePlanDocumentsNode` loads the snapshot before iterating packages. `generateNodeEstatePackage` reuses that snapshot but creates a new clause-store/report for each DOCX, attaches `snapshot.source` as `clauseSource`, attaches `report.included_clauses.map(...)` as the file manifest, and never reloads publications while rendering. Update the draft route call to `generateEstatePlanDocumentsNode(payload, { matterId: canonicalMatterId })`; non-matter exports remain on the file source unless they inject a snapshot.

- [ ] **Step 5: Run provenance, generator, and template-integrity suites**

Run: `npx vitest run tests/estate-clause-provenance.test.ts tests/node-estate-generator.test.ts tests/docx-template-integrity.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/estateGenerator/node/types.ts lib/estateGenerator/node/generate.ts lib/estateGenerator/node/clauses.ts tests/estate-clause-provenance.test.ts tests/node-estate-generator.test.ts
git commit -m "Record per-document clause provenance"
```

### Task 9: Persist document registration and clause provenance atomically

**Files:**
- Modify: `supabase/migrations/20260715210000_estate_clause_library.sql`
- Create: `lib/estateClauses/persistGeneratedDocument.ts`
- Modify: `app/api/admin/matters/[id]/draft/route.ts`
- Modify: `tests/estate-clause-provenance.test.ts`
- Modify: `tests/draft-generation-route.test.ts`

**Interfaces:**
- Consumes `NodeEstateGeneratedFile.clauseManifest`.
- Produces one `persist_generated_estate_document` RPC result: `{ documentId, documentVersionId }`.

- [ ] **Step 1: Write failing persistence tests**

Assert one RPC receives document metadata plus the exact manifest; the RPC inserts `matter_documents`, `document_versions`, `generated_document_clause_revisions`, and updates `current_version_id` in one transaction. Assert R2 cleanup is attempted when RPC persistence fails. Assert Node documents never use the old non-fatal `ensureInitialVersion` path.

- [ ] **Step 2: Verify persistence tests fail**

Run: `npx vitest run tests/estate-clause-provenance.test.ts tests/draft-generation-route.test.ts`

Expected: FAIL on the missing RPC helper and old route behavior.

- [ ] **Step 3: Complete the database RPC**

The JSON document argument contains the existing insert fields (`matter_id`, `r2_key`, `name`, size/content type, actor, generation ID/engine, markers, template provenance). The manifest argument is a JSON array validated with `jsonb_array_elements`. For each row, verify the revision belongs to the clause, hash matches the immutable revision, publication existed in history, override belongs to the matter when present, and selection reason matches override presence. Any error rolls back all database rows.

- [ ] **Step 4: Implement the typed RPC wrapper**

```ts
export async function persistGeneratedEstateDocument(args: PersistArgs) {
  const { data, error } = await args.admin.rpc('persist_generated_estate_document', {
    p_document: args.document,
    p_manifest: args.manifest,
  })
  if (error) throw new Error(error.message)
  if (!data?.documentId || !data?.documentVersionId) throw new Error('Generated document persistence returned no identifiers')
  return data as { documentId: string; documentVersionId: string }
}
```

- [ ] **Step 5: Update the draft route**

Carry `clauseSource` and `clauseManifest` through `generatedFiles`. After successful R2 upload, call the wrapper only for Node estate files where `clauseSource === 'database'`. If it fails, delete the just-uploaded R2 object with `DeleteObjectCommand` and fail the run visibly. File rollback mode, non-estate fallback, and real-estate-transfer files retain the existing registration path; synthetic file revision IDs must never be inserted into database provenance foreign keys.

For download-only delivery, include a `clause-manifest.json` inside the ZIP metadata so the artifact remains reproducible even though it is not registered as a matter document.

- [ ] **Step 6: Run persistence and route tests**

Run: `npx vitest run tests/estate-clause-provenance.test.ts tests/draft-generation-route.test.ts tests/draft-download.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260715210000_estate_clause_library.sql lib/estateClauses/persistGeneratedDocument.ts app/api/admin/matters/[id]/draft/route.ts tests/estate-clause-provenance.test.ts tests/draft-generation-route.test.ts tests/draft-download.test.ts
git commit -m "Persist estate clause manifests atomically"
```

### Task 10: Validate baseline, cut over safely, and document operations

**Files:**
- Modify: `VERCEL_ENV_CHECKLIST.md`
- Modify: `OPERATIONS_RUNBOOK.md`
- Modify: `tests/estate-clause-parity.test.ts`

**Interfaces:**
- Produces the operator runbook for import, review, cutover, verification, and rollback.

- [ ] **Step 1: Add a failing release-readiness test**

The test loads the database snapshot from a local Supabase fixture and asserts every clause key referenced by representative package templates has an active publication, no active publication has `review_status=draft`, and database/file rendering differences are either zero or listed in a committed `intentionalDifferences` object with clause key and reason.

- [ ] **Step 2: Run it before baseline review**

Run: `npx vitest run tests/estate-clause-parity.test.ts -t "database cutover readiness"`

Expected: FAIL until imported revisions have been independently reviewed and published locally.

- [ ] **Step 3: Execute the local review rehearsal**

Run: `npm run clauses:import`

Expected: 22 clauses staged and zero silently published. Use the UI with two distinct attorney/admin users to preview and publish approved baseline revisions. The seven bundled clauses currently marked `draft` must remain unpublished until their language is affirmatively approved; any template that requires one must continue blocking database cutover.

- [ ] **Step 4: Run the complete focused verification**

Run: `npx vitest run tests/estate-clause-schema.test.ts tests/estate-clause-validation.test.ts tests/estate-clause-workflow.test.ts tests/estate-clause-admin-ui.test.tsx tests/estate-clause-overrides.test.tsx tests/estate-clause-parity.test.ts tests/estate-clause-provenance.test.ts tests/node-estate-generator.test.ts tests/docx-template-integrity.test.ts tests/draft-generation-route.test.ts tests/draft-download.test.ts tests/document-template-workflow.test.ts`

Expected: PASS.

Run: `npm run lint -- --quiet`

Expected: no new lint errors in changed files; compare any repository-wide output with the documented baseline.

Run: `npm run typecheck`

Expected: no new application-code errors; documented baseline test-file errors may remain.

- [ ] **Step 5: Document deploy and rollback commands**

Add `ESTATE_CLAUSE_SOURCE=file|database` to `VERCEL_ENV_CHECKLIST.md`. In `OPERATIONS_RUNBOOK.md`, require this order: apply migration, run idempotent import, independently review/publish, run parity/readiness verification, set the flag in a preview deployment, generate and inspect representative Will/Trust/POA/HCP/HIPAA packages, then promote the flag to production. Rollback is setting `ESTATE_CLAUSE_SOURCE=file` and redeploying; never delete database history.

- [ ] **Step 6: Verify hosted schema before production cutover**

Use the project's established Supabase connection method to confirm all seven tables, four RPCs, RLS policies, revision immutability trigger, publication pointer, and manifest indexes exist. If migration history collides with live objects, reconcile migration history and verify schema rather than replaying non-idempotent DDL.

- [ ] **Step 7: Commit**

```bash
git add VERCEL_ENV_CHECKLIST.md OPERATIONS_RUNBOOK.md tests/estate-clause-parity.test.ts
git commit -m "Document estate clause library rollout"
```

## Final Verification Gate

- [ ] Confirm `git diff --check` is clean.
- [ ] Confirm the focused suite in Task 10 passes.
- [ ] Confirm changed application files have no new lint/type errors.
- [ ] Confirm a database-source generation stores one manifest row for every included clause and no rows for skipped clauses.
- [ ] Confirm publishing a new revision changes only new generations.
- [ ] Confirm regeneration preserves the old document version and old manifest.
- [ ] Confirm an author cannot publish their own revision through either API or direct RPC.
- [ ] Confirm a missing/corrupt publication blocks generation and never falls back to JSON while `ESTATE_CLAUSE_SOURCE=database`.
- [ ] Confirm `ESTATE_CLAUSE_SOURCE=file` reproduces the pre-feature generator output for rollback.
