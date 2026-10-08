# Intake Form Builder Phase 2A Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the persistent, administrator-controlled form-template and immutable-version lifecycle that the visual intake builder will use, without changing which form any production intake renders.

**Architecture:** Keep untrusted definitions behind the existing strict compiler and code-owned field/block catalogs. Store drafts and immutable published versions in service-role-only Supabase tables, expose lifecycle operations through administrator-gated server routes, seed the two bundled definitions idempotently, and add a resolver that preserves bundled fallback for legacy rows while failing closed for an invalid pinned version. Database-backed selection and the visual composer remain disabled until later Phase 2 plans.

**Tech Stack:** Next.js App Router, TypeScript, React-free server modules, Supabase/Postgres with RLS, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-intake-form-builder-design.md`

## Global Constraints

- Only approved canonical fields and approved canonical compound blocks are available; definitions never contain database keys, drafting mappings, scripts, formulas, regular expressions, SQL, HTML, or Markdown.
- Form definitions contain presentation and orchestration metadata only; answers remain in existing canonical stores and no generic answers table or JSON answer column is added.
- Published and retired versions are immutable, and an intake pinned to a version is never silently moved to another version.
- Client and public delivery is server-compiled and never receives staff-only definition content.
- Builder routes require the existing strict administrator boundary (`requireAdministrator`), not the broader attorney/staff `requireAdmin` boundary.
- The service-role key remains server-only; `anon` and `authenticated` receive no direct table or lifecycle-function privileges.
- This slice is additive: `client_intake.form_version_id` remains nullable, no creation path starts pinning it, and `INTAKE_RENDERER_MODE` behavior does not change.
- Do not modify drafting internals, design-sheet generation, document generation, or `AdminIntakeSheet`.
- Do not deploy or repair linked Supabase migration history without separate user authorization.

## Review Focus

- A stale draft save must return a conflict without overwriting the newer definition; Task 3 pins this with compare-and-swap tests.
- A published or retired definition must reject mutation even through the service role; Task 1 pins this with database guard tests.
- Compiler-invalid drafts must save with diagnostics but cannot publish, and client delivery must exclude staff-only content; Tasks 3 and 6 pin these cases.
- Re-running the bundled seed with the same hashes must be a no-op, while hash drift must stop and require an explicit new version; Task 5 pins both cases.
- A legacy intake with `form_version_id = NULL` must resolve its bundled track, while a non-null missing or invalid pinned version must fail closed; Task 6 pins both cases.

---

### Task 1: Add the versioned database model and immutable lifecycle primitives

**Files:**
- Create: `supabase/migrations/<generated>_intake_form_builder_foundation.sql`
- Create: `tests/intake-form-builder-schema.test.ts`
- Modify: `packages/db-types/src/supabase.generated.ts`

**Interfaces:**
- Produces tables `intake_form_templates` and `intake_form_versions` plus nullable `client_intake.form_version_id`.
- Produces service-role-only RPCs `create_intake_form_template`, `save_intake_form_draft`, `create_next_intake_form_draft`, `publish_intake_form_draft`, `retire_intake_form_version`, `archive_intake_form_template`, and `discard_intake_form_draft`.
- Enforces one draft per template, unique template key/version, optimistic locking, immutable published/retired definitions, and pinned-version referential integrity.

- [ ] **Step 1: Reconcile the migration boundary before creating a file**

First review the current Supabase changelog for relevant breaking changes and
the current official guidance for RLS, table grants, and database functions:

- `https://supabase.com/changelog.md`
- `https://supabase.com/docs/guides/database/postgres/row-level-security.md`
- `https://supabase.com/docs/guides/database/functions.md`

Use the Supabase documentation connector when available and record any guidance
that changes the SQL below. Then run the read-only diagnostics from the linked
migration reconciliation workflow:

```sh
npx supabase --version
npx supabase migration list --linked
npx supabase db push --dry-run
```

Record the complete pending/orphaned/out-of-order result in the implementation notes. Stop before any schema edit if local and remote history disagree or if the dry run selects any file unrelated to this plan. Never use `migration repair` or `--include-all` as a shortcut.

- [ ] **Step 2: Create the migration through the pinned CLI**

Run:

```sh
npx supabase migration new intake_form_builder_foundation
```

Use the generated filename in every later command and test; do not hand-author a timestamp.

- [ ] **Step 3: Write the failing structural schema test**

Create `tests/intake-form-builder-schema.test.ts` so it locates the one migration ending in `_intake_form_builder_foundation.sql` and asserts these exact contracts:

```ts
expect(sql).toContain('CREATE TABLE public.intake_form_templates')
expect(sql).toContain('CREATE TABLE public.intake_form_versions')
expect(sql).toMatch(/ALTER TABLE public\.client_intake[\s\S]*ADD COLUMN[\s\S]*form_version_id uuid/i)
expect(sql).toContain("status IN ('draft', 'published', 'retired')")
expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*WHERE status = 'draft'/i)
expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
expect(sql).toMatch(/REVOKE ALL ON public\.intake_form_templates FROM PUBLIC, anon, authenticated/i)
expect(sql).toMatch(/REVOKE ALL ON public\.intake_form_versions FROM PUBLIC, anon, authenticated/i)
expect(sql).toContain('OLD.status IN (\'published\', \'retired\')')
for (const fn of lifecycleFunctions) {
  expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`, 'i'))
  expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]* TO service_role`, 'i'))
}
```

Also assert that no lifecycle function is granted to `anon` or `authenticated`, each `SECURITY DEFINER` function uses `SET search_path = ''`, and each function verifies `public.users.role = 'admin'` for `p_actor_id`.

- [ ] **Step 4: Run the schema test and verify it fails**

Run:

```sh
npm test -- tests/intake-form-builder-schema.test.ts
```

Expected: FAIL because the generated migration does not yet define the tables and functions.

- [ ] **Step 5: Implement the additive schema**

Define the tables with these database-owned constraints:

```sql
CREATE TABLE public.intake_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.intake_form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.intake_form_templates(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_by uuid NOT NULL REFERENCES public.users(id),
  published_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (template_id, version),
  CHECK ((status = 'draft' AND published_at IS NULL AND published_by IS NULL)
    OR (status IN ('published', 'retired') AND published_at IS NOT NULL AND published_by IS NOT NULL))
);

CREATE UNIQUE INDEX intake_form_versions_one_draft_idx
  ON public.intake_form_versions(template_id) WHERE status = 'draft';

ALTER TABLE public.client_intake
  ADD COLUMN form_version_id uuid REFERENCES public.intake_form_versions(id);
```

Add RLS to both new tables. Revoke all privileges from `PUBLIC`, `anon`, and `authenticated`; grant CRUD only to `service_role`. Do not add permissive browser policies.

- [ ] **Step 6: Implement atomic lifecycle functions and the immutability trigger**

Each lifecycle RPC must:

1. be `SECURITY DEFINER SET search_path = ''`;
2. reject a null actor and any actor whose `public.users.role` is not `admin`;
3. use `pg_advisory_xact_lock(hashtextextended(template_id::text, 0))` for version-number or status transitions;
4. revoke default `PUBLIC` execution and grant only to `service_role`;
5. return the affected IDs, version/status, lock version, and hash as JSONB.

The save operation must use a single guarded update:

```sql
UPDATE public.intake_form_versions
SET definition = p_definition,
    definition_hash = p_definition_hash,
    lock_version = lock_version + 1,
    updated_at = now()
WHERE id = p_version_id
  AND status = 'draft'
  AND lock_version = p_expected_lock_version
RETURNING id, template_id, version, status, lock_version, definition_hash, updated_at;
```

Raise `Draft changed; refresh and try again` when no row returns. The immutability trigger must reject changes to `definition`, `definition_hash`, `template_id`, or `version` when `OLD.status IN ('published', 'retired')`; it may allow the single `published -> retired` status transition and no reverse transition.

Pin the remaining lifecycle behavior explicitly:

- `create_intake_form_template` creates one template and its version-1 draft in the same transaction and rejects a duplicate key.
- `create_next_intake_form_draft` locks the template, rejects an existing draft, copies the selected published/retired source definition, and assigns `max(version) + 1`.
- `publish_intake_form_draft` requires the expected lock version and definition hash, changes only `draft -> published`, and records `published_by`, `published_at`, and `updated_at` atomically.
- `retire_intake_form_version` changes only `published -> retired`; it never deletes or rewrites a pinned version.
- `archive_intake_form_template` changes only `archived_at` and `updated_at`; it never changes version status.
- `discard_intake_form_draft` deletes only a row whose status is `draft` and requires an explicit expected lock version.

- [ ] **Step 7: Apply and verify locally**

Start/reset only the local Supabase stack, then run:

```sh
npx supabase db reset
npm test -- tests/intake-form-builder-schema.test.ts
npm run db:types:local
npm run check:db-types
```

Use SQL assertions against the local database to prove: service-role lifecycle calls succeed, direct `anon`/`authenticated` reads fail, stale saves fail, and a direct update of a published definition fails. Run `NOTIFY pgrst, 'reload schema';` after any iterative local `ALTER TABLE` before testing through PostgREST.

- [ ] **Step 8: Commit the schema slice**

```sh
git add supabase/migrations tests/intake-form-builder-schema.test.ts packages/db-types/src/supabase.generated.ts
git commit -m "Add intake form versioning foundation"
```

### Task 2: Add deterministic definition hashing and persistence row types

**Files:**
- Create: `lib/intake/forms/hash.ts`
- Create: `lib/intake/forms/persistenceTypes.ts`
- Create: `tests/intake-form-definition-hash.test.ts`

**Interfaces:**
- Produces `canonicalizeIntakeFormDefinition(raw: unknown): IntakeFormDefinition`.
- Produces `hashIntakeFormDefinition(raw: unknown): string` as a lowercase 64-character SHA-256.
- Produces `IntakeFormTemplateRow`, `IntakeFormVersionRow`, and `IntakeFormVersionStatus` for server modules.

- [ ] **Step 1: Write failing hash tests**

Cover successful parsing, stable hashes for different object-key insertion order, different hashes for semantic changes, lowercase 64-character output, and rejection of an invalid definition:

```ts
expect(hashIntakeFormDefinition(ESTATE_INTAKE_FORM)).toMatch(/^[0-9a-f]{64}$/)
expect(hashIntakeFormDefinition(reorderedEstate)).toBe(hashIntakeFormDefinition(ESTATE_INTAKE_FORM))
expect(hashIntakeFormDefinition({ ...ESTATE_INTAKE_FORM, title: 'Changed' }))
  .not.toBe(hashIntakeFormDefinition(ESTATE_INTAKE_FORM))
expect(() => hashIntakeFormDefinition({ schemaVersion: 1 })).toThrow('Invalid intake form definition')
```

- [ ] **Step 2: Run the hash tests and verify they fail**

```sh
npm test -- tests/intake-form-definition-hash.test.ts
```

Expected: FAIL because `lib/intake/forms/hash.ts` does not exist.

- [ ] **Step 3: Implement canonical hashing**

Parse first with `parseIntakeFormDefinition`, recursively sort object keys while preserving array order, then hash `JSON.stringify(sortedDefinition)` with `node:crypto`:

```ts
export function hashIntakeFormDefinition(raw: unknown): string {
  const definition = canonicalizeIntakeFormDefinition(raw)
  return createHash('sha256').update(JSON.stringify(sortJson(definition))).digest('hex')
}
```

Do not accept functions, accessors, cyclic values, or non-JSON objects; the existing strict schema remains the source of truth.

- [ ] **Step 4: Add persistence types and rerun tests**

Define the row fields exactly as the migration exposes them, using `IntakeFormDefinition` for `definition` only after repository parsing. Run:

```sh
npm test -- tests/intake-form-definition-hash.test.ts tests/intake-form-schema.test.ts tests/intake-form-compiler.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit the hashing slice**

```sh
git add lib/intake/forms/hash.ts lib/intake/forms/persistenceTypes.ts tests/intake-form-definition-hash.test.ts
git commit -m "Add deterministic intake form hashing"
```

### Task 3: Build the server-only repository and lifecycle service

**Files:**
- Create: `lib/intake/forms/repository.ts`
- Create: `lib/intake/forms/adminService.ts`
- Create: `tests/intake-form-admin-service.test.ts`

**Interfaces:**
- Produces `listIntakeFormTemplates()`, `getIntakeFormTemplate(templateId)`, `getIntakeFormVersion(versionId)`, and `getIntakeFormDraft(templateId)`.
- Produces `createIntakeFormTemplate`, `saveIntakeFormDraft`, `createNextIntakeFormDraft`, `publishIntakeFormDraft`, `retireIntakeFormVersion`, `archiveIntakeFormTemplate`, `discardIntakeFormDraft`, and `duplicateIntakeFormTemplate`.
- All mutation inputs require an explicit `actorId`; all writes flow through service-role-only RPCs.
- Draft saves return compiler diagnostics without requiring the draft to be publishable; publication requires zero compiler diagnostics for both audiences.

- [ ] **Step 1: Write failing lifecycle-service tests**

Mock only the repository boundary and assert real service behavior. A structurally valid but incomplete draft must save and return diagnostics:

```ts
await expect(saveIntakeFormDraft({
  versionId: 'version-1',
  expectedLockVersion: 3,
  definition: incompleteDefinition,
  actorId: 'admin-1',
})).resolves.toMatchObject({
  draft: { lockVersion: 4 },
  diagnostics: [{ path: 'sections', message: 'A shared unconditional review and submit path is required' }],
})

await expect(publishIntakeFormDraft({
  versionId: 'version-1',
  expectedLockVersion: 3,
  expectedDefinitionHash: '0'.repeat(64),
  actorId: 'admin-1',
})).rejects.toThrow('Definition changed; refresh and try again')
```

Also test: strict schema failures reject saves; both client and staff compilation run to produce save diagnostics; publishing rejects any diagnostic; staff-only content is absent from the client compilation; diagnostics are returned with stable paths; repository conflict messages map to a typed `IntakeFormConflictError`; retiring does not delete the row; duplication produces a new key and version-1 draft rather than sharing IDs.

- [ ] **Step 2: Run the service tests and verify they fail**

```sh
npm test -- tests/intake-form-admin-service.test.ts
```

Expected: FAIL because the repository and service modules do not exist.

- [ ] **Step 3: Implement repository reads and RPC wrappers**

Use `getAdminClient()` only inside `repository.ts`. Parse every `definition` read from Postgres with `parseIntakeFormDefinition`; throw `Stored intake form version <id> is invalid` rather than returning raw JSON. Keep Supabase query objects out of route handlers.

Use exact RPC wrapper signatures such as:

```ts
export async function saveDraftRow(input: {
  versionId: string
  expectedLockVersion: number
  definition: IntakeFormDefinition
  definitionHash: string
  actorId: string
}): Promise<IntakeFormVersionRow>
```

- [ ] **Step 4: Implement compiler-gated lifecycle methods**

`saveIntakeFormDraft` must parse and hash the definition, compile both audiences, persist the structurally valid draft even when compilation reports diagnostics, and return those diagnostics. `publishIntakeFormDraft` must compile both audiences and refuse the repository transition when either result fails:

```ts
function compileDiagnostics(definition: IntakeFormDefinition): IntakeFormDiagnostic[] {
  const diagnostics: IntakeFormDiagnostic[] = []
  for (const audience of ['client', 'staff'] as const) {
    const result = compileIntakeForm(definition, audience)
    if (!result.success) diagnostics.push(...result.errors)
  }
  return dedupeAndSortDiagnostics(diagnostics)
}
```

Publishing must require an empty diagnostic list and compare the stored hash and expected lock version supplied by the caller before calling the atomic RPC. No method may substitute a bundled form when stored data is invalid.

- [ ] **Step 5: Run focused and type tests**

```sh
npm test -- tests/intake-form-admin-service.test.ts tests/intake-form-compiler.test.ts tests/intake-form-schema.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit the service slice**

```sh
git add lib/intake/forms/repository.ts lib/intake/forms/adminService.ts tests/intake-form-admin-service.test.ts
git commit -m "Add intake form lifecycle service"
```

### Task 4: Expose administrator-only lifecycle routes

**Files:**
- Create: `app/api/admin/settings/intake-forms/route.ts`
- Create: `app/api/admin/settings/intake-forms/[templateId]/route.ts`
- Create: `app/api/admin/settings/intake-forms/[templateId]/draft/route.ts`
- Create: `app/api/admin/settings/intake-forms/[templateId]/publish/route.ts`
- Create: `app/api/admin/settings/intake-forms/[templateId]/duplicate/route.ts`
- Create: `app/api/admin/settings/intake-forms/[templateId]/versions/[versionId]/retire/route.ts`
- Create: `tests/intake-form-admin-routes.test.ts`

**Interfaces:**
- `GET/POST /api/admin/settings/intake-forms` lists templates or creates a template with its version-1 draft.
- `GET/PATCH /api/admin/settings/intake-forms/:templateId` reads metadata or archives/unarchives it.
- `GET/PUT/DELETE /api/admin/settings/intake-forms/:templateId/draft` reads, compare-and-swap saves, or explicitly discards the single draft.
- `POST /api/admin/settings/intake-forms/:templateId/publish` publishes the current compiler-valid draft.
- `POST /api/admin/settings/intake-forms/:templateId/duplicate` creates a new template and draft from the selected source definition.
- `POST /api/admin/settings/intake-forms/:templateId/versions/:versionId/retire` retires one published version.

- [ ] **Step 1: Write failing authorization and response tests**

For every route, assert `requireAdministrator(req)` runs before body parsing or repository access. Cover 401, attorney/staff 403, admin success, malformed/strict-schema-invalid body 400 or 422, missing resource 404, stale lock/hash 409, publish-time compiler diagnostics 422, draft-save diagnostics with 200, and unexpected persistence errors 500.

Pin the conflict response shape:

```ts
expect(response.status).toBe(409)
await expect(response.json()).resolves.toEqual({
  error: 'Draft changed; refresh and try again',
  code: 'INTAKE_FORM_CONFLICT',
})
```

- [ ] **Step 2: Run route tests and verify they fail**

```sh
npm test -- tests/intake-form-admin-routes.test.ts
```

Expected: FAIL because the route modules do not exist.

- [ ] **Step 3: Implement thin route handlers**

Each handler must:

1. call `requireAdministrator(req)` first;
2. parse only documented fields and reject unknown/missing required values;
3. call one `adminService` method;
4. map typed validation/conflict/not-found errors to 422/409/404;
5. return draft-save diagnostics to the administrator, but no raw Supabase error, SQL text, service key, or uncompiled definition to a client/public route.

Use `export const runtime = 'nodejs'` because hashing uses `node:crypto`.

- [ ] **Step 4: Run route, service, and authorization tests**

```sh
npm test -- tests/intake-form-admin-routes.test.ts tests/intake-form-admin-service.test.ts tests/rls-security-policies.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit the route slice**

```sh
git add app/api/admin/settings/intake-forms tests/intake-form-admin-routes.test.ts
git commit -m "Add administrator intake form APIs"
```

### Task 5: Add deterministic bundled-form installation

**Files:**
- Create: `scripts/installBundledIntakeForms.ts`
- Create: `tests/intake-form-bundled-install.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `buildBundledIntakeFormInstallPlan(existing)` for pure dry-run testing.
- Adds `npm run intake:forms:install -- --dry-run` and an explicit `--apply` mode.
- Installs `ESTATE_INTAKE_FORM` and `COLLEGE_PREP_INTAKE_FORM` as initial published versions through the lifecycle service.

- [ ] **Step 1: Write failing install-plan tests**

Cover these exact outcomes:

```ts
expect(planForEmpty.map(step => step.action)).toEqual(['create_and_publish', 'create_and_publish'])
expect(planForMatching.map(step => step.action)).toEqual(['noop', 'noop'])
expect(() => buildBundledIntakeFormInstallPlan(hashDrift)).toThrow(
  'Published bundled form differs; create and review a new draft explicitly',
)
```

Also assert each fixture compiles for client and staff before any database call and the college/estate hashes are stable snapshots.

- [ ] **Step 2: Run installer tests and verify they fail**

```sh
npm test -- tests/intake-form-bundled-install.test.ts
```

Expected: FAIL because the install planner does not exist.

- [ ] **Step 3: Implement dry-run-first installation**

The command must default to dry-run, require `--apply` for writes, print keys/hashes/actions but never credentials, and use the two keys `estate` and `college_prep`. Existing matching publications are no-ops. Existing mismatched publications stop the whole run before the first write; the installer must never create a surprise version 2.

Add package scripts:

```json
{
  "intake:forms:install": "tsx scripts/installBundledIntakeForms.ts"
}
```

- [ ] **Step 4: Verify idempotence against local Supabase**

Run:

```sh
npm run intake:forms:install -- --dry-run
npm run intake:forms:install -- --apply
npm run intake:forms:install -- --apply
```

Expected: the first apply creates and publishes exactly two version-1 rows; the second apply reports two no-ops and creates no rows.

- [ ] **Step 5: Commit the installer slice**

```sh
git add scripts/installBundledIntakeForms.ts tests/intake-form-bundled-install.test.ts package.json package-lock.json
git commit -m "Add bundled intake form installer"
```

### Task 6: Add the pinned-version resolver without activating it

**Files:**
- Create: `lib/intake/forms/resolver.ts`
- Create: `tests/intake-form-persistent-resolver.test.ts`

**Interfaces:**
- Produces `resolveIntakeForm(input: { formVersionId: string | null; track: IntakeTrack; audience: 'client' | 'staff' }): Promise<{ source: 'bundled' | 'persistent'; versionId: string | null; form: CompiledIntakeForm }>`.
- Leaves all current page/route callers on `compileBundledIntakeForm`; activation is reserved for a later plan.

- [ ] **Step 1: Write failing resolver tests**

Test these branches:

```ts
await expect(resolveIntakeForm({ formVersionId: null, track: 'estate', audience: 'client' }))
  .resolves.toMatchObject({ source: 'bundled', versionId: null, form: { key: 'estate' } })

await expect(resolveIntakeForm({ formVersionId: 'version-1', track: 'estate', audience: 'client' }))
  .resolves.toMatchObject({ source: 'persistent', versionId: 'version-1' })

await expect(resolveIntakeForm({ formVersionId: 'missing', track: 'estate', audience: 'client' }))
  .rejects.toThrow('Pinned intake form version is unavailable')
```

Also prove that a stored invalid definition fails closed, a stored `staff_only` section is absent from client output, a retired pinned version still resolves, and a draft version never resolves for an intake.

- [ ] **Step 2: Run resolver tests and verify they fail**

```sh
npm test -- tests/intake-form-persistent-resolver.test.ts
```

Expected: FAIL because the persistent resolver does not exist.

- [ ] **Step 3: Implement the explicit resolver boundary**

Use bundled forms only when `formVersionId` is null. For a non-null ID, fetch exactly that version, require status `published` or `retired`, compile for the requested audience, and throw a sanitized `IntakeFormUnavailableError` on a missing/invalid record. Never query “latest” and never fall back from a bad pinned version.

- [ ] **Step 4: Prove this slice does not activate persistent rendering**

Add a source guard to the test asserting that `app/intake`, public intake routes, and `SchemaDrivenGuidedInterview` do not import `resolver.ts` in this branch. Run:

```sh
npm test -- tests/intake-form-persistent-resolver.test.ts tests/intake-form-bundled-definitions.test.ts tests/intake-rollback-entry.test.tsx
npm run typecheck
```

- [ ] **Step 5: Commit the resolver slice**

```sh
git add lib/intake/forms/resolver.ts tests/intake-form-persistent-resolver.test.ts
git commit -m "Add persistent intake form resolver"
```

### Task 7: Verify the complete Phase 2A foundation and document the release boundary

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-intake-form-builder-design.md`

**Interfaces:**
- Records what Phase 2A implements, what remains disabled, and the exact verification evidence.
- Does not claim the visual builder, database-backed selection, intake pinning, or Phase 3 staff Intake tab are complete.

- [ ] **Step 1: Run the focused intake-builder suite**

```sh
npx vitest run tests/intake-form-*.test.ts tests/intake-form-*.test.tsx tests/intake-rollback-entry.test.tsx
```

Expected: all focused files pass with zero failures and no accessibility/compiler warnings.

- [ ] **Step 2: Run repository verification**

```sh
npm run lint
npm run typecheck
npm test
npm run check:db-types
git diff --check origin/main...HEAD
```

If the loopback-listener database suites fail with sandbox `EPERM 127.0.0.1`, rerun the complete suite with approved local-listener permission; do not report the restricted run as a source failure.

- [ ] **Step 3: Verify local database behavior and migration replay**

```sh
npx supabase db reset
npx supabase migration list --local
npm run intake:forms:install -- --apply
npm run intake:forms:install -- --apply
```

Query the local catalog to verify the two templates, exactly two version-1 published rows, no drafts, enabled RLS, revoked `anon`/`authenticated` privileges, immutable published definitions, and nullable `client_intake.form_version_id`.

- [ ] **Step 4: Update the design verification record**

Add a dated Phase 2A record stating:

- version tables, service-only lifecycle, deterministic bundled installation, and dormant resolver are implemented;
- current intake creation/rendering still uses bundled definitions and does not set `form_version_id`;
- the visual composer, preview UI, production database installation, runtime activation/pinning, and all Phase 3 work remain unimplemented;
- migration deployment is separately authorized and was not performed as part of code review.

- [ ] **Step 5: Commit the verification record**

```sh
git add docs/superpowers/specs/2026-10-08-intake-form-builder-design.md
git commit -m "Record intake builder foundation verification"
```

- [ ] **Step 6: Request independent review before push**

Give the reviewer `origin/main..HEAD` and require findings on authorization, RLS/grants, `SECURITY DEFINER` ownership checks, optimistic concurrency, publication immutability, seed idempotence, fail-closed pinned resolution, and accidental runtime activation. Fix every Critical or Important finding and rerun the affected verification.

## Later Phase 2 plans

The following work is deliberately not part of this implementation plan:

1. **Phase 2B — Visual builder:** administrator template list, section/item composer, canonical catalog picker, condition editor, conflict UI, and dual client/staff preview.
2. **Phase 2C — Activation and pinning:** select published versions for new intakes, pin every creation path, switch client/public rendering to the persistent resolver, retain bundled fallback for null legacy rows, and exercise version-1/version-2 acceptance.
3. **Phase 3 — Detailed intake experience:** matter Intake tab, staff renderer, people/fiduciary/asset enhancements, estate total, and answer attribution.

No later plan starts until Phase 2A is merged and its database migration has an explicitly authorized deployment/reconciliation path.
