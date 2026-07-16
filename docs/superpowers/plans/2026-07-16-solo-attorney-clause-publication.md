# Solo-Attorney Estate-Clause Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the same authorized Aubrey Law attorney or administrator to author, request changes to, publish, and revert every Massachusetts estate-clause revision without weakening any other publication safeguard.

**Architecture:** Add one forward-only Supabase migration that replaces the three affected workflow RPC definitions and removes only their author/actor inequality guards. Remove the matching repository, route, and UI gates while preserving submission separation, role authorization, validation, immutable preview evidence, typed stable-key confirmation, optimistic concurrency, immutable history, and provenance.

**Tech Stack:** PostgreSQL/Supabase migrations and `SECURITY DEFINER` RPCs, Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library, Vercel.

## Global Constraints

- Massachusetts only; do not introduce multi-jurisdiction behavior.
- Use a new forward migration; never edit or replay `20260715210000_estate_clause_library.sql` against the hosted database.
- A user with the existing `attorney` or `admin` role may self-review, self-publish, and self-revert every future clause revision.
- Submission and publication remain separate explicit actions.
- Publication still requires a valid submitted revision, fresh immutable preview evidence, typed stable-key confirmation in the UI, content-integrity checks, dependency checks, template-snapshot checks, and the expected current publication.
- AI and import paths may never publish, revert, retire, or approve legal language.
- All review and publication events remain append-only and attributed to the authenticated actor.
- Keep production `ESTATE_CLAUSE_SOURCE=file` until the existing parity, preview, and document-inspection release gates pass.
- Do not add a firm setting, two-person toggle, automatic publication, free-form Word editing, editable selection logic, or automatic changes to existing drafts.

---

## File Map

- Create `supabase/migrations/20260716130000_solo_attorney_estate_clause_publication.sql`: forward replacement of the three affected RPC bodies and preservation of service-role-only execution.
- Modify `tests/estate-clause-schema.test.ts`: prove the active forward migration removes only different-user guards while retaining database safeguards.
- Modify `lib/estateClauses/repository.ts`: remove client-side self-review and self-publication rejection and remove obsolete `authorId` inputs.
- Modify `app/api/admin/settings/estate-clauses/[clauseId]/review/route.ts`: allow an author through the same authorized review route and retain workflow conflict handling.
- Modify `tests/estate-clause-workflow.test.ts`: prove self-authored request-change and publication calls reach the correct RPCs and route.
- Modify `app/admin/settings/estate-clauses/EstateClauseReviewPanel.tsx`: always show deliberate review controls, with informational solo-attorney copy instead of a block.
- Modify `tests/estate-clause-admin-ui.test.tsx`: prove a self-authored revision can reach preview and publication controls.
- Modify `OPERATIONS_RUNBOOK.md`: replace second-attorney instructions with deliberate solo-attorney review and keep the cutover gates unchanged.
- Modify `docs/superpowers/specs/2026-07-15-estate-clause-library-design.md`: add a supersession notice pointing to the approved solo-attorney design.

---

### Task 1: Replace the Database Two-Person Guards with a Forward Migration

**Files:**
- Create: `supabase/migrations/20260716130000_solo_attorney_estate_clause_publication.sql`
- Modify: `tests/estate-clause-schema.test.ts`

**Interfaces:**
- Consumes: the existing signatures of `request_estate_clause_changes(uuid, uuid, text)`, `publish_estate_clause_revision(uuid, uuid, uuid, text)`, and `revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid)` from `20260715210000_estate_clause_library.sql`.
- Produces: the same RPC names, parameter order, return types, security mode, and service-role privileges, without author/actor inequality checks.

- [ ] **Step 1: Write the failing forward-migration contract test**

Add a second migration source beside `sql` in `tests/estate-clause-schema.test.ts`:

```ts
const soloPublicationSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260716130000_solo_attorney_estate_clause_publication.sql'),
  'utf8',
)
```

Add this test without weakening the historical assertions against the original migration:

```ts
it('allows an authorized solo attorney while preserving every non-personnel publication gate', () => {
  for (const functionName of [
    'request_estate_clause_changes',
    'publish_estate_clause_revision',
    'revert_estate_clause_publication',
  ]) {
    expect(soloPublicationSql).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}`)
    expect(soloPublicationSql).toContain(`REVOKE ALL ON FUNCTION public.${functionName}`)
    expect(soloPublicationSql).toContain(`GRANT EXECUTE ON FUNCTION public.${functionName}`)
  }

  expect(soloPublicationSql).not.toMatch(/different attorney|different administrator/i)
  expect(soloPublicationSql).not.toContain('v_revision.author_id = p_actor_id')
  expect(soloPublicationSql).not.toContain('v_author_id = p_actor_id')
  expect(soloPublicationSql).not.toContain('v_target_author_id = p_actor_id')

  expect(soloPublicationSql).toContain("u.role IN ('attorney', 'admin')")
  expect(soloPublicationSql).toContain("v_latest_event IS DISTINCT FROM 'submitted'")
  expect(soloPublicationSql).toContain("v_validation_status <> 'valid'")
  expect(soloPublicationSql).toContain('pe.template_snapshot_hash = p_current_template_snapshot_hash')
  expect(soloPublicationSql).toContain('pe.dependency_revision_ids = v_dependency_revision_ids')
  expect(soloPublicationSql).toContain('v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id')
  expect(soloPublicationSql).toContain("hashtextextended('estate-clause-publications', 0)")
  expect(soloPublicationSql).toContain("'changes_requested'")
  expect(soloPublicationSql).toContain("'published'")
  expect(soloPublicationSql).toContain("'publication_reverted'")
})
```

- [ ] **Step 2: Run the schema test and verify the red state**

Run:

```bash
npx vitest run tests/estate-clause-schema.test.ts
```

Expected: FAIL because `20260716130000_solo_attorney_estate_clause_publication.sql` does not exist.

- [ ] **Step 3: Create the forward migration with unchanged RPC signatures**

Create `20260716130000_solo_attorney_estate_clause_publication.sql` by copying the complete current definitions of the three functions from `20260715210000_estate_clause_library.sql`, byte-for-byte except for these exact removals:

```sql
-- Remove from request_estate_clause_changes:
IF v_revision.author_id = p_actor_id THEN
  RAISE EXCEPTION 'A different attorney or administrator must review this revision';
END IF;

-- Remove from publish_estate_clause_revision:
IF v_author_id = p_actor_id THEN
  RAISE EXCEPTION 'A different attorney or administrator must publish this revision';
END IF;

-- Remove from revert_estate_clause_publication:
IF v_target_author_id = p_actor_id THEN
  RAISE EXCEPTION 'A different attorney or administrator must revert this revision';
END IF;
```

Remove `v_author_id` and `v_target_author_id` from `DECLARE` and remove their corresponding values from the `SELECT ... INTO` lists; each variable is used only by the deleted inequality guard. Keep `v_revision.author_id` in `request_estate_clause_changes` because it restores the reviewed proposal to the original author's working draft.

Do not change any other conditional, lock, query, event insert, return type, function parameter, `SECURITY DEFINER`, or `SET search_path = ''` clause.

End the migration with explicit privilege normalization using the exact signatures:

```sql
REVOKE ALL ON FUNCTION public.request_estate_clause_changes(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_estate_clause_changes(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.publish_estate_clause_revision(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_estate_clause_revision(uuid, uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid) TO service_role;
```

- [ ] **Step 4: Run the schema test and inspect the migration diff**

Run:

```bash
npx vitest run tests/estate-clause-schema.test.ts
git diff --check
git diff -- supabase/migrations/20260716130000_solo_attorney_estate_clause_publication.sql tests/estate-clause-schema.test.ts
```

Expected: schema tests PASS; the migration diff contains only the three full RPC replacements, removed author inequality guards, and privilege statements.

- [ ] **Step 5: Commit the database contract**

```bash
git add supabase/migrations/20260716130000_solo_attorney_estate_clause_publication.sql tests/estate-clause-schema.test.ts
git commit -m "Allow solo attorney clause publication"
```

---

### Task 2: Allow Self-Review Through the Repository and API Route

**Files:**
- Modify: `lib/estateClauses/repository.ts:192-232`
- Modify: `app/api/admin/settings/estate-clauses/[clauseId]/review/route.ts:32-122`
- Modify: `tests/estate-clause-workflow.test.ts:98-139, 775-805`

**Interfaces:**
- Consumes: the unchanged RPC signatures from Task 1.
- Produces: `requestEstateClauseChanges` and `publishEstateClauseRevision` argument objects without `authorId`; the authenticated `POST` route accepts the revision author under the same validation and conflict rules as any other authorized actor.

- [ ] **Step 1: Replace repository rejection tests with self-review success tests**

Replace the two self-rejection tests in `tests/estate-clause-workflow.test.ts` with:

```ts
it('allows the author to request changes through the audited RPC', async () => {
  const client = fakeClient()

  await requestEstateClauseChanges({
    client: asRepositoryClient(client),
    revisionId: 'revision-2',
    actorId: 'author-1',
    comment: 'Revise this language after another deliberate review pass.',
  })

  expect(client.rpc).toHaveBeenCalledWith('request_estate_clause_changes', {
    p_revision_id: 'revision-2',
    p_actor_id: 'author-1',
    p_comment: 'Revise this language after another deliberate review pass.',
  })
})

it('allows the author to publish while sending the expected current revision', async () => {
  const client = fakeClient()

  await publishEstateClauseRevision({
    revisionId: 'revision-2',
    actorId: 'author-1',
    expectedCurrentRevisionId: 'revision-1',
    currentTemplateSnapshotHash: 'a'.repeat(64),
    client: asRepositoryClient(client),
  })

  expect(client.rpc).toHaveBeenCalledWith('publish_estate_clause_revision', {
    p_revision_id: 'revision-2',
    p_actor_id: 'author-1',
    p_expected_current_revision_id: 'revision-1',
    p_current_template_snapshot_hash: 'a'.repeat(64),
  })
})
```

In `targets one exact submitted revision when multiple revisions await review`, replace the publish assertion with:

```ts
expect(publish).toHaveBeenCalledWith(expect.objectContaining({
  revisionId,
  actorId: 'reviewer-1',
}))
expect(publish.mock.calls[0][0]).not.toHaveProperty('authorId')
```

Change the route runtime test from `returns 403 for self-review...` to `allows self-publication and still returns 404 for a missing submitted revision`. Use this exact self-authored fixture:

```ts
const selfReview = await invoke(fakeClient({
  estate_clause_revisions: {
    data: [{ id: revisionId, author_id: 'author-1', validation_status: 'valid' }],
    error: null,
  },
  estate_clause_review_events: {
    data: [{ revision_id: revisionId, event_type: 'submitted' }],
    error: null,
  },
  estate_clause_publications: { data: null, error: null },
}), 'author-1')
```

Then assert:

```ts
expect(selfReview.response.status).toBe(200)
expect(selfReview.publish).toHaveBeenCalledWith(expect.objectContaining({
  revisionId,
  actorId: 'author-1',
  expectedCurrentRevisionId: null,
}))
```

Keep the missing-revision assertions at `404` with zero publish calls.

- [ ] **Step 2: Run the workflow test and verify the red state**

Run:

```bash
npx vitest run tests/estate-clause-workflow.test.ts
```

Expected: FAIL because the repository and route still reject `actorId === authorId` and still require `authorId` arguments.

- [ ] **Step 3: Remove only the application-level different-user gates**

Change the repository interfaces to:

```ts
export async function requestEstateClauseChanges(args: {
  client: EstateClauseClient
  revisionId: string
  actorId: string
  comment: string
}) {
  const result = await args.client.rpc('request_estate_clause_changes', {
    p_revision_id: args.revisionId,
    p_actor_id: args.actorId,
    p_comment: args.comment,
  })
  return requireData(result, 'Estate clause change request returned no event')
}

export async function publishEstateClauseRevision(args: {
  client: EstateClauseClient
  revisionId: string
  actorId: string
  expectedCurrentRevisionId: string | null
  currentTemplateSnapshotHash: string
}) {
  const result = await args.client.rpc('publish_estate_clause_revision', {
    p_revision_id: args.revisionId,
    p_actor_id: args.actorId,
    p_expected_current_revision_id: args.expectedCurrentRevisionId,
    p_current_template_snapshot_hash: args.currentTemplateSnapshotHash,
  })
  return requireData(result, 'Estate clause publication returned no result')
}
```

In the review route:

- remove the `revisionRow.author_id === userId` 403 response;
- remove `authorId` from both repository calls;
- remove the obsolete `different attorney|different administrator` branch from `workflowStatus`;
- keep `requireAdmin`, UUID/body parsing, submitted-state derivation, validation status, publication freshness, template snapshot hashing, and exception-to-status mapping unchanged.

- [ ] **Step 4: Run the focused server workflow suite**

Run:

```bash
npx vitest run tests/estate-clause-workflow.test.ts
npx eslint lib/estateClauses/repository.ts 'app/api/admin/settings/estate-clauses/[clauseId]/review/route.ts' tests/estate-clause-workflow.test.ts
```

Expected: all workflow tests PASS and scoped ESLint exits zero.

- [ ] **Step 5: Commit the server workflow**

```bash
git add lib/estateClauses/repository.ts 'app/api/admin/settings/estate-clauses/[clauseId]/review/route.ts' tests/estate-clause-workflow.test.ts
git commit -m "Enable solo attorney clause review"
```

---

### Task 3: Enable Deliberate Self-Publication in the Review UI

**Files:**
- Modify: `app/admin/settings/estate-clauses/EstateClauseReviewPanel.tsx:15-160`
- Modify: `tests/estate-clause-admin-ui.test.tsx:340-350`

**Interfaces:**
- Consumes: the Task 2 review route, unchanged preview endpoint, and existing `currentUserId` prop.
- Produces: a single review surface for authored and non-authored revisions; `selfAuthored` becomes informational and never controls access.

- [ ] **Step 1: Write the failing self-authored UI contract**

Replace `suppresses self-publication and explains the independent review rule` with:

```tsx
it('allows deliberate publication of a self-authored revision', async () => {
  const user = userEvent.setup()
  render(<EstateClauseLibrarySection currentUserId="reviewer" />)

  await user.click(await screen.findByRole('button', { name: 'Review Self Authored' }))

  expect(screen.getByText('Self-authored revision')).toBeTruthy()
  expect(screen.getByLabelText('Reviewer comments')).toBeTruthy()
  expect(screen.getByLabelText(/Type .* to confirm/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeTruthy()
  expect(screen.queryByText(/different attorney or administrator/i)).toBeNull()
})
```

- [ ] **Step 2: Run the UI test and verify the red state**

Run:

```bash
npx vitest run tests/estate-clause-admin-ui.test.tsx
```

Expected: FAIL because self-authored revisions still hide the action controls.

- [ ] **Step 3: Make authorship informational instead of prohibitive**

In `EstateClauseReviewPanel.tsx`:

- change the eyebrow from `Independent review` to `Attorney review`;
- keep `const selfAuthored = revision.authorId === currentUserId`;
- immediately after the author/submission metadata, render this only when `selfAuthored`:

```tsx
{selfAuthored && (
  <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
    <span className="font-semibold">Self-authored revision.</span>{' '}
    A successful preview and exact stable-key confirmation are still required before publication.
  </p>
)}
```

- delete the `selfAuthored ? warning : controls` conditional;
- render the existing request-change and publish control grid for every submitted revision;
- retain the current preview-evidence, exact stable-key, validation-status, and busy-state button conditions unchanged;
- keep the action text `Approve and publish` because the click remains the explicit approval event.

- [ ] **Step 4: Run the UI and workflow regression suites**

Run:

```bash
npx vitest run tests/estate-clause-admin-ui.test.tsx tests/estate-clause-workflow.test.ts
npx eslint app/admin/settings/estate-clauses/EstateClauseReviewPanel.tsx tests/estate-clause-admin-ui.test.tsx
```

Expected: UI and workflow tests PASS; scoped ESLint exits zero.

- [ ] **Step 5: Commit the UI change**

```bash
git add app/admin/settings/estate-clauses/EstateClauseReviewPanel.tsx tests/estate-clause-admin-ui.test.tsx
git commit -m "Show solo attorney publication controls"
```

---

### Task 4: Align the Operational Policy and Historical Design Record

**Files:**
- Modify: `OPERATIONS_RUNBOOK.md:104-305`
- Modify: `docs/superpowers/specs/2026-07-15-estate-clause-library-design.md:1-15`

**Interfaces:**
- Consumes: the approved policy in `docs/superpowers/specs/2026-07-16-solo-attorney-clause-publication-design.md`.
- Produces: one unambiguous operator procedure for solo-attorney review without changing the file-to-database cutover sequence.

- [ ] **Step 1: Update the runbook language**

Replace the rollout introduction with:

```md
`ESTATE_CLAUSE_SOURCE=file` is the safe default and rollback path. Do not set
the production value to `database` until every step below is complete. The
import is intentionally non-publishing: legal text becomes usable only after
an attorney deliberately previews and publishes the submitted revision. In
this solo-attorney deployment, the revision author may complete that review.
```

Replace Step 3 with:

```md
3. **Attorney review and publication.** Sign in to the clause-library UI as the
   attorney/admin. Correct validation failures and submit each working draft.
   For each submitted revision, compare the proposed and published language,
   generate and inspect the representative preview, type the exact stable key,
   and explicitly publish the approved revision. Self-authored publication is
   permitted, but submission and publication remain separate audited actions.
   Bundled clauses marked `draft` remain unpublished until their language
   receives affirmative attorney approval.
```

Change later references from `independent attorney review` to `deliberate attorney review`. Do not change the snapshot, parity, preview, promotion, or rollback commands and pass criteria.

- [ ] **Step 2: Add a supersession notice to the original design**

Immediately below the title of `2026-07-15-estate-clause-library-design.md`, add:

```md
> **Solo-attorney policy update (2026-07-16):** The different-user publication
> requirement in this historical design is superseded by
> `2026-07-16-solo-attorney-clause-publication-design.md`. All other validation,
> preview, audit, immutability, provenance, and cutover requirements remain in force.
```

- [ ] **Step 3: Check documentation consistency**

Run:

```bash
rg -n "different attorney|different authorized|independent attorney|author cannot|author must not|publisher.*different" OPERATIONS_RUNBOOK.md docs/superpowers/specs/2026-07-15-estate-clause-library-design.md
git diff --check
```

Expected: remaining matches appear only in the original historical design beneath its explicit supersession notice; the active runbook contains none.

- [ ] **Step 4: Commit the policy documentation**

```bash
git add OPERATIONS_RUNBOOK.md docs/superpowers/specs/2026-07-15-estate-clause-library-design.md
git commit -m "Document solo attorney publication policy"
```

---

### Task 5: Verify, Apply the Hosted Migration, and Deploy Safely

**Files:**
- Verify only; no additional source files are expected.

**Interfaces:**
- Consumes: Tasks 1-4 and the existing linked Supabase/Vercel projects.
- Produces: hosted RPCs that accept the authorized revision author, a deployed review UI, and evidence that file-source production drafting remains unchanged.

- [ ] **Step 1: Run the complete focused estate-clause suite**

Run:

```bash
npx vitest run \
  tests/estate-clause-schema.test.ts \
  tests/estate-clause-validation.test.ts \
  tests/estate-clause-workflow.test.ts \
  tests/estate-clause-admin-ui.test.tsx \
  tests/estate-clause-overrides.test.tsx \
  tests/estate-clause-provenance.test.ts \
  tests/estate-clause-parity.test.ts
```

Expected: all behavior tests PASS; `database cutover readiness` remains the single intentional red gate until attorney publication populates the fixture. Run the parity file separately with that test excluded if necessary to prove all non-cutover parity tests are green.

- [ ] **Step 2: Run static and production-build verification**

Run:

```bash
npx eslint \
  lib/estateClauses/repository.ts \
  'app/api/admin/settings/estate-clauses/[clauseId]/review/route.ts' \
  app/admin/settings/estate-clauses/EstateClauseReviewPanel.tsx \
  tests/estate-clause-schema.test.ts \
  tests/estate-clause-workflow.test.ts \
  tests/estate-clause-admin-ui.test.tsx
git diff --check
npm run build:next
```

Expected: scoped ESLint, diff check, compilation, TypeScript, page generation, and build traces all complete successfully.

- [ ] **Step 3: Inspect and apply only the new hosted migration**

Run from the linked project:

```bash
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

Expected: the dry run and push include only `20260716130000_solo_attorney_estate_clause_publication.sql`. Never use `supabase db reset`. If migration history differs, stop and reconcile history before applying SQL.

- [ ] **Step 4: Verify hosted definitions and privileges read-only**

Run this in the Supabase SQL editor:

```sql
select p.proname,
       p.prosecdef,
       p.proconfig,
       position('different attorney' in lower(pg_catalog.pg_get_functiondef(p.oid))) = 0 as allows_same_author,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array[
    'request_estate_clause_changes',
    'publish_estate_clause_revision',
    'revert_estate_clause_publication'
  ])
order by p.proname;
```

Expected: three rows; `prosecdef=true`; `proconfig={search_path=}`; `allows_same_author=true`; `anon_execute=false`; `authenticated_execute=false`; `service_role_execute=true`.

- [ ] **Step 5: Push the branch, integrate to main, and monitor Vercel**

```bash
git status -sb
git push -u origin codex/solo-attorney-clause-publication
```

Integrate only after Tasks 1-4 and Steps 1-4 are verified. Push the resulting `main` commit and monitor the production deployment until Vercel reports `READY`. Confirm `ESTATE_CLAUSE_SOURCE` remains `file` in production.

- [ ] **Step 6: Perform the solo-attorney workflow smoke test**

In production, sign in with the solo attorney/admin account and select one valid submitted baseline revision:

1. Open Template Center → Clause library → the submitted revision.
2. Confirm the page labels the revision as self-authored but shows request-change and publication controls.
3. Generate a representative preview and inspect the downloaded DOCX.
4. Type the exact stable key and publish.
5. Refresh and confirm the revision is current and the publication event identifies the same attorney account.
6. Confirm existing generated documents were not modified.

Expected: publication succeeds for the author only after preview and exact-key confirmation. Keep the remaining baseline clauses unpublished until each receives the same deliberate review.

- [ ] **Step 7: Continue the existing database cutover gate**

After all approved baseline revisions are published, export the sanitized fixture exactly as documented in `OPERATIONS_RUNBOOK.md`, run:

```bash
npx vitest run tests/estate-clause-parity.test.ts -t "database cutover readiness"
```

Expected: no missing representative-template publications, no draft publication, and no unexplained database/file rendering difference. Only then proceed to `ESTATE_CLAUSE_SOURCE=database` in preview; production cutover remains a later explicit decision.
