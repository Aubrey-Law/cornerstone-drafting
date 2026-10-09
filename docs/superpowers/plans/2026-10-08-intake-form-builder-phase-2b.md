# Intake Form Builder Phase 2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-only visual intake-form builder and read-only synthetic preview over the Phase 2A lifecycle, while leaving live intake rendering and version pinning unchanged.

**Architecture:** Extend the existing service-role lifecycle with an atomic append-only audit log and thin admin read/action endpoints. Keep form editing in a pure client-side state layer fed only by serializable projections of the code-owned catalogs, then compile unsaved definitions through the existing compiler for a disabled, in-memory preview. The Settings list and editor call the established Phase 2A APIs; no browser code accesses Supabase directly or receives executable catalog internals.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase/Postgres with RLS, Zod, existing Radix-based UI primitives, native HTML drag events plus accessible move buttons, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-08-intake-form-builder-phase-2b-design.md`

## Global Constraints

- Only code-approved canonical fields and compound blocks may be inserted; the UI and server compiler both enforce the catalog boundary.
- Definitions contain presentation and orchestration metadata only; do not add arbitrary questions, answer JSON, persistence keys, drafting mappings, scripts, formulas, regexes, SQL, HTML, or Markdown.
- Draft saving is explicit. Preview uses unsaved local state, while Publish requires a successfully saved, clean, compiler-valid draft.
- Published and retired definitions remain immutable. Existing intake rows and `client_intake.form_version_id` are never changed in Phase 2B.
- Preview uses synthetic in-memory answers and must not persist answers, contacts, uploads, submissions, or intake rows.
- Every page and API operation uses the administrator boundary. Attorneys who are not administrators, clients, public-link users, and anonymous users receive no builder access.
- Service-role credentials remain server-only. The new audit table has RLS enabled and no `anon` or `authenticated` table or function privileges.
- Do not modify drafting internals, draft payload generation, document generation, or `AdminIntakeSheet`.
- Do not activate database-backed intake selection or pin any intake; that remains Phase 2C.
- At execution time, create a fresh isolated worktree from current `origin/main` with `superpowers:using-git-worktrees`, then bring the approved spec and plan commits into that branch. Do not continue implementation on the stale, already-merged Phase 2A branch.
- Before implementing the Supabase slice, verify the current Supabase changelog and official RLS/function guidance. Do not deploy a linked migration or change linked migration history without separate user authorization.

## File structure

- `supabase/migrations/<generated>_intake_form_builder_audit.sql` — append-only lifecycle events and atomic audit writes in the existing lifecycle RPCs.
- `packages/db-types/src/supabase.generated.ts` — generated database types after the local migration.
- `lib/intake/forms/persistenceTypes.ts` — parsed audit-event and builder read-model row types.
- `lib/intake/forms/repository.ts` — service-role audit reads and atomic duplicate RPC wrapper.
- `lib/intake/forms/adminService.ts` — template-scoped detail/summary reads and lifecycle methods used by routes.
- `lib/intake/forms/builderCatalog.ts` — serializable, exhaustive projection of approved fields, blocks, constraints, and block configuration controls.
- `lib/intake/forms/editorState.ts` — pure immutable definition edits, ordering, dirty comparison, condition eligibility, and diagnostic targeting.
- `lib/intake/forms/previewScenarios.ts` — deterministic Empty, Single, Married, and Family synthetic answer records.
- `app/api/admin/settings/intake-forms/**/route.ts` — thin administrator routes for summaries, detail, create-next-draft, and existing mutations.
- `app/admin/settings/intake-forms/page.tsx` — admin-gated list loader.
- `app/admin/settings/intake-forms/IntakeFormsListClient.tsx` — template list plus create, duplicate, archive, and restore dialogs.
- `app/admin/settings/intake-forms/[templateId]/page.tsx` — admin-gated editor loader.
- `app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient.tsx` — Build/Preview coordination and saved/local draft state.
- `app/admin/settings/intake-forms/[templateId]/IntakeFormOutline.tsx` — selection, section/item ordering, and add/remove controls.
- `app/admin/settings/intake-forms/[templateId]/IntakeFormInspector.tsx` — form, section, field, block, and condition properties.
- `app/admin/settings/intake-forms/[templateId]/IntakeCatalogDrawer.tsx` — grouped approved-catalog search and insertion.
- `app/admin/settings/intake-forms/[templateId]/IntakeFormDiagnostics.tsx` — compiler diagnostics linked to editor controls.
- `app/admin/settings/intake-forms/[templateId]/IntakeFormPreview.tsx` — read-only dual-audience synthetic preview.
- `app/admin/settings/intake-forms/[templateId]/useIntakeFormDraft.ts` — save, conflict recovery, unsaved navigation, and lifecycle request state.
- `components/intake/formEngine/CompiledIntakeSections.tsx` — adds an explicit read-only override for preview without changing live behavior.

## Review Focus

- A stale save or stale publish must preserve the local definition and never overwrite the newer draft; Tasks 2 and 7 test both the API conflict and the editor recovery path.
- A definition that is structurally valid but lacks an unconditional shared review/submit block must save as a draft and remain unpublishable; Tasks 2, 4, and 7 pin this distinction.
- Moving a condition source after its dependent item must retain the condition, produce a diagnostic, and focus the affected control instead of silently rewriting the rule; Tasks 4 and 6 test this sequence.
- Previewing any scenario, audience, or compound block must make zero network writes even when controls are clicked; Task 8 tests disabled controls and a fetch spy.
- Discarding a draft must remove the mutable row while retaining one actor/time audit event with its version number; Task 1 tests the foreign-key and transaction behavior.

---

### Task 1: Add durable, atomic lifecycle audit events

**Files:**
- Create: `supabase/migrations/<generated>_intake_form_builder_audit.sql`
- Modify: `tests/intake-form-builder-schema.test.ts`
- Modify: `packages/db-types/src/supabase.generated.ts`

**Interfaces:**
- Produces table `public.intake_form_audit_events` with action values `create`, `save`, `create_next_draft`, `publish`, `retire`, `archive`, `restore`, `duplicate`, and `discard`.
- Produces service-role-only RPC `duplicate_intake_form_template(p_actor_id, p_source_version_id, p_key, p_name, p_description)`.
- Extends every Phase 2A lifecycle RPC so the mutation and exactly one success event commit or roll back together.

- [ ] **Step 1: Verify current Supabase guidance and migration state**

Read the current changelog and official RLS/database-function guidance using the Supabase documentation connector when available. Then run only read-only CLI diagnostics:

```sh
npx supabase --version
npx supabase migration list --linked
npx supabase db push --dry-run
```

Expected: the linked history is reconciled and the dry run selects no unrelated migration. Stop for user direction if history disagrees; do not use `migration repair`, `--include-all`, or a linked write.

- [ ] **Step 2: Create the migration with the pinned CLI**

```sh
npx supabase migration new intake_form_builder_audit
```

Use the generated path for the remaining steps; never invent the timestamp.

- [ ] **Step 3: Write failing schema and transaction tests**

Extend `tests/intake-form-builder-schema.test.ts` to locate the audit migration and assert:

```ts
expect(sql).toContain('CREATE TABLE public.intake_form_audit_events')
expect(sql).toContain("action IN ('create', 'save', 'create_next_draft', 'publish', 'retire', 'archive', 'restore', 'duplicate', 'discard')")
expect(sql).toMatch(/version_id uuid REFERENCES public\.intake_form_versions\(id\) ON DELETE SET NULL/i)
expect(sql).toMatch(/metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb/i)
expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
expect(sql).toMatch(/REVOKE ALL ON public\.intake_form_audit_events FROM PUBLIC, anon, authenticated/i)
expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.duplicate_intake_form_template\(/i)
expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.duplicate_intake_form_template\([\s\S]* TO service_role/i)
```

Add a local SQL probe to the existing schema test harness that invokes each lifecycle RPC and checks one event per successful call. For a stale save and a duplicate-key failure, assert the event count does not change. After `discard_intake_form_draft`, assert the event retains `template_id`, `version_number`, action `discard`, actor, and timestamp while `version_id IS NULL`.

- [ ] **Step 4: Run the focused test and verify failure**

```sh
npm test -- tests/intake-form-builder-schema.test.ts
```

Expected: FAIL because the audit table and atomic event writes do not exist.

- [ ] **Step 5: Implement the audit table and privileges**

Use this database-owned shape:

```sql
CREATE TABLE public.intake_form_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.intake_form_templates(id),
  version_id uuid REFERENCES public.intake_form_versions(id) ON DELETE SET NULL,
  version_number integer CHECK (version_number IS NULL OR version_number > 0),
  action text NOT NULL CHECK (action IN (
    'create', 'save', 'create_next_draft', 'publish', 'retire',
    'archive', 'restore', 'duplicate', 'discard'
  )),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intake_form_audit_events_template_time_idx
  ON public.intake_form_audit_events(template_id, occurred_at DESC);

ALTER TABLE public.intake_form_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intake_form_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.intake_form_audit_events TO service_role;
```

Do not grant update or delete to application roles and do not add browser policies.

- [ ] **Step 6: Extend lifecycle RPCs transactionally**

Replace the Phase 2A functions with the same signatures and mutation guards, adding one `INSERT INTO public.intake_form_audit_events` before return. Capture version number before draft deletion. Use `CASE WHEN p_archived THEN 'archive' ELSE 'restore' END` for archive state changes.

Add `duplicate_intake_form_template` as one `SECURITY DEFINER SET search_path = ''` transaction that:

1. validates `p_actor_id` is an admin;
2. loads a source draft, published, or retired version;
3. creates a new template and version-1 draft with the copied definition and hash;
4. records action `duplicate` on the new template with metadata containing only `source_template_id` and `source_version_id`;
5. returns the new version metadata;
6. revokes `PUBLIC`, `anon`, and `authenticated` execution and grants only `service_role`.

`create_intake_form_template` records `create`; the duplicate RPC records only `duplicate`, not both actions.

- [ ] **Step 7: Apply and verify locally**

```sh
npx supabase db reset
npm test -- tests/intake-form-builder-schema.test.ts
npm run db:types:local
npm run check:db-types
```

Expected: the schema test passes, generated types include `intake_form_audit_events` and `duplicate_intake_form_template`, stale/failed mutations add no event, and direct anonymous/authenticated access fails.

- [ ] **Step 8: Commit the audit slice**

```sh
git add supabase/migrations tests/intake-form-builder-schema.test.ts packages/db-types/src/supabase.generated.ts
git commit -m "Add intake form lifecycle audit events"
```

### Task 2: Expose parsed builder read models and missing lifecycle routes

**Files:**
- Modify: `lib/intake/forms/persistenceTypes.ts`
- Modify: `lib/intake/forms/repository.ts`
- Modify: `lib/intake/forms/adminService.ts`
- Modify: `app/api/admin/settings/intake-forms/route.ts`
- Modify: `app/api/admin/settings/intake-forms/[templateId]/route.ts`
- Modify: `app/api/admin/settings/intake-forms/[templateId]/draft/route.ts`
- Modify: `tests/intake-form-admin-service.test.ts`
- Modify: `tests/intake-form-admin-routes.test.ts`

**Interfaces:**
- Produces `IntakeFormAuditEventRow`, `IntakeFormTemplateSummary`, and `IntakeFormEditorSnapshot`.
- Produces `listIntakeFormTemplateSummaries()`, `getIntakeFormEditorSnapshot(templateId)`, `listIntakeFormAuditEvents(templateId, limit)`, and `createNextIntakeFormTemplateDraft(input)`.
- `GET /api/admin/settings/intake-forms` returns `{ templates: IntakeFormTemplateSummary[] }`.
- `GET /api/admin/settings/intake-forms/[templateId]` returns an `IntakeFormEditorSnapshot`.
- `POST /api/admin/settings/intake-forms/[templateId]/draft` accepts `{ sourceVersionId }` and creates the one allowed next draft.

- [ ] **Step 1: Write failing repository/service tests**

Add exact public types:

```ts
export interface IntakeFormTemplateSummary {
  template: IntakeFormTemplateRow
  draft: IntakeFormVersionRow | null
  latestPublished: IntakeFormVersionRow | null
  latestVersion: IntakeFormVersionRow | null
}

export interface IntakeFormEditorSnapshot {
  template: IntakeFormTemplateRow
  versions: IntakeFormVersionRow[]
  draft: IntakeFormVersionRow | null
  auditEvents: IntakeFormAuditEventRow[]
}
```

Test stable key ordering, highest-version selection, archived templates remaining visible, a missing template returning `null`, malformed stored definitions failing closed, audit pagination limited to 50, cross-template source rejection, existing-draft conflicts, and atomic duplication using the new repository RPC instead of `createTemplateRow`.

- [ ] **Step 2: Run the service tests and verify failure**

```sh
npm test -- tests/intake-form-admin-service.test.ts tests/intake-form-admin-routes.test.ts
```

Expected: FAIL because summary/detail reads, audit parsing, draft POST, and atomic duplication are absent.

- [ ] **Step 3: Implement parsed repository methods**

Add a strict Zod parser for audit rows. `metadata` must be a plain JSON object. Implement:

```ts
export async function listAuditEventRows(
  templateId: string,
  limit = 50,
): Promise<IntakeFormAuditEventRow[]>

export async function duplicateTemplateRow(input: {
  actorId: string
  sourceVersionId: string
  key: string
  name: string
  description?: string | null
}): Promise<{ template: IntakeFormTemplateRow; draft: IntakeFormVersionRow }>
```

The duplicate wrapper reads the source definition before calling the RPC, validates the returned metadata against that copied definition with its rewritten key, and then loads the created template. No raw database JSON crosses `repository.ts`.

- [ ] **Step 4: Implement service read models and scoped mutation**

Build summaries from `listTemplateRows()` and `listVersionRows(template.id)`, selecting highest version numbers deterministically. Implement:

```ts
export async function createNextIntakeFormTemplateDraft(input: {
  templateId: string
  sourceVersionId: string
  actorId: string
}) {
  await requireTemplateVersion(input, input.sourceVersionId)
  return createNextIntakeFormDraft({
    sourceVersionId: input.sourceVersionId,
    actorId: input.actorId,
  })
}
```

`getIntakeFormEditorSnapshot` returns `null` only for an absent template; storage or parse errors propagate. Change duplication to call `duplicateTemplateRow` so the audit event and new identity are atomic.

- [ ] **Step 5: Extend the administrator routes**

Keep `requireAdministrator(req)` before params or body access. Add strict POST validation to the existing draft route:

```ts
const createNextSchema = z.object({ sourceVersionId: z.string().uuid() }).strict()

export async function POST(req: Request, context: Context) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err
  try {
    const route = paramsSchema.safeParse(await context.params)
    if (!route.success) return badRequest()
    const body = createNextSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return badRequest()
    const result = await service.createNextIntakeFormTemplateDraft({
      templateId: route.data.templateId,
      sourceVersionId: body.data.sourceVersionId,
      actorId: userId!,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return failure(error)
  }
}
```

Update list/detail GET handlers to return the read models and preserve the existing sanitized 404/409/422/500 error contract.

- [ ] **Step 6: Add route authorization and failure tests**

Extend the table-driven route cases with detail-summary GET and draft POST. Assert anonymous, attorney, and staff denials occur before params/body/service access; malformed UUIDs and unknown body keys return 400; cross-template source returns 404; an existing draft conflict returns 409; unexpected errors never expose SQL, service-role, definition, or token text.

- [ ] **Step 7: Run focused verification and commit**

```sh
npm test -- tests/intake-form-admin-service.test.ts tests/intake-form-admin-routes.test.ts
npm run typecheck
git add lib/intake/forms/persistenceTypes.ts lib/intake/forms/repository.ts lib/intake/forms/adminService.ts app/api/admin/settings/intake-forms tests/intake-form-admin-service.test.ts tests/intake-form-admin-routes.test.ts
git commit -m "Expose intake form builder read models"
```

### Task 3: Project the approved catalogs into serializable builder metadata

**Files:**
- Create: `lib/intake/forms/builderCatalog.ts`
- Create: `tests/intake-form-builder-catalog.test.ts`

**Interfaces:**
- Produces `BuilderCatalogField`, `BuilderCatalogBlock`, `BuilderConfigControl`, `IntakeFormBuilderCatalog`, and `getIntakeFormBuilderCatalog()`.
- Returned data contains no functions, adapters, React components, persistence keys, design keys, or legacy storage details.

- [ ] **Step 1: Write failing catalog-boundary tests**

Assert every returned field resolves through `getBuilderField`, every returned block is one `IntakeBlockId`, IDs are unique, data survives `structuredClone` and JSON round-trip, and no serialized key matches `/intakeKey|designKey|householdKey|read|write|evaluate|persist/i`.

Also pin these user-facing constraints:

```ts
expect(catalog.fields.find(field => field.id === 'county')).toMatchObject({
  control: 'select',
  baselineRequirement: 'recommended',
  group: 'Client and household',
})
expect(catalog.blocks.find(block => block.id === 'address')?.configControls)
  .toEqual([
    { key: 'profile', label: 'Address profile', control: 'select', options: [
      { value: 'estate', label: 'Estate planning' },
      { value: 'college', label: 'College preparation' },
    ] },
    { key: 'includeCounty', label: 'Ask for Massachusetts county', control: 'boolean' },
  ])
```

- [ ] **Step 2: Run the catalog test and verify failure**

```sh
npm test -- tests/intake-form-builder-catalog.test.ts
```

Expected: FAIL because the projection does not exist.

- [ ] **Step 3: Implement field projection**

Map only `BUILDER_FIELD_IDS` through `getBuilderField`. Group IDs starting with `college_` as `College preparation`; client identity, contact, address, county, citizenship, and marital fields as `Client and household`; estate value, assets, planning goals, and special notes as `Estate planning`; remaining approved fields as `Background`.

Generate concise descriptions by control without exposing storage:

```ts
const CONTROL_DESCRIPTION = {
  text: 'Short plain-text answer.',
  email: 'Email address with code-owned validation.',
  tel: 'Telephone number with code-owned validation.',
  date: 'Calendar date with code-owned validation.',
  textarea: 'Long plain-text answer.',
  select: 'Choose one approved option.',
  boolean: 'Yes or no answer.',
  multiselect: 'Choose any approved options.',
} as const
```

Return copied option arrays, baseline requirement, validation profile, control type, group, label, description, and `audiences: ['client_and_staff', 'staff_only']`.

- [ ] **Step 4: Implement exhaustive block metadata**

Create an exhaustive `satisfies Record<IntakeBlockId, readonly [string, string, string]>` map with these labels/groups:

```ts
const BLOCK_COPY = {
  address: ['Address', 'Client and household', 'Canonical mailing address fields.'],
  spouse_details: ['Spouse details', 'Client and household', 'Spouse identity and contact details.'],
  children: ['Children', 'People and fiduciaries', 'Canonical child collection and relationship details.'],
  financial_assets: ['Financial assets', 'Estate planning', 'Estate asset categories and totals.'],
  planning_objectives: ['Planning objectives', 'Estate planning', 'Goals and reasons for planning.'],
  existing_document_uploads: ['Existing documents', 'Documents', 'Existing-plan document uploads.'],
  additional_contacts: ['Additional contacts', 'People and fiduciaries', 'Other matter-scoped people.'],
  client_fiduciaries: ['Client fiduciaries', 'People and fiduciaries', 'Client fiduciary choices and ranking.'],
  spouse_fiduciaries: ['Spouse fiduciaries', 'People and fiduciaries', 'Spouse fiduciary choices and ranking.'],
  guardian: ['Guardian', 'People and fiduciaries', 'Guardian choice for minor children.'],
  college_parents: ['Parents and guardians', 'College preparation', 'Student parent or guardian contacts.'],
  college_agents: ['College agents', 'College preparation', 'Financial and health-care agents.'],
  college_hipaa_recipients: ['HIPAA recipients', 'College preparation', 'People authorized to receive health information.'],
  review_submit: ['Review and submit', 'Workflow', 'Required shared review and submission path.'],
  attorney_plan_structure: ['Plan structure', 'Attorney only', 'Attorney plan-type selection.'],
  attorney_documents: ['Documents to prepare', 'Attorney only', 'Attorney document inclusion selection.'],
} as const satisfies Record<IntakeBlockId, readonly [string, string, string]>
```

Resolve audiences from `getIntakeBlock(id)`. Only `address` exposes the two config controls pinned above; every other V1 block returns `configControls: []`.

- [ ] **Step 5: Run tests and commit**

```sh
npm test -- tests/intake-form-builder-catalog.test.ts tests/intake-form-definition.test.ts tests/intake-form-compiler.test.ts
npm run typecheck
git add lib/intake/forms/builderCatalog.ts tests/intake-form-builder-catalog.test.ts
git commit -m "Add approved intake builder catalog projection"
```

### Task 4: Build the pure editor-state and preview-scenario foundations

**Files:**
- Create: `lib/intake/forms/editorState.ts`
- Create: `lib/intake/forms/previewScenarios.ts`
- Create: `tests/intake-form-editor-state.test.ts`
- Create: `tests/intake-form-preview-scenarios.test.ts`

**Interfaces:**
- Produces immutable editor functions `createBlankDefinition`, `addSection`, `updateSection`, `removeSection`, `moveSection`, `addItem`, `updateItem`, `removeItem`, and `moveItem`.
- Produces `eligibleConditionFields`, `targetForDiagnostic`, `definitionFingerprint`, and `selectionAfterRemoval`.
- Produces `INTAKE_PREVIEW_SCENARIOS` and `PreviewScenarioId`.

- [ ] **Step 1: Write failing immutable-state tests**

Use a two-section definition and assert every operation returns a new root without mutating the input. Pin clamped ordering, cross-section item moves, globally stable/generated IDs, duplicate field prevention, section removal selection repair, and item removal selection repair.

Use exact operation results such as:

```ts
expect(moveSection(definition, 'family', -1).sections.map(section => section.id))
  .toEqual(['family', 'personal'])
expect(moveItem(definition, { itemId: 'county', toSectionId: 'family', toIndex: 0 })
  .sections[1].items[0].id).toBe('county')
expect(original).toEqual(before)
```

- [ ] **Step 2: Add condition, dirty, and diagnostic tests**

Assert `eligibleConditionFields` returns only earlier approved scalar fields visible to the dependent section audience. Moving the source later retains the stored condition but removes it from eligibility and causes the existing compiler to report its path.

Pin diagnostic routing:

```ts
expect(targetForDiagnostic('sections.1.items.2.condition.value', definition))
  .toEqual({ kind: 'item', sectionId: 'family', itemId: 'guardian', control: 'condition' })
expect(targetForDiagnostic('sections.1.title', definition))
  .toEqual({ kind: 'section', sectionId: 'family', control: 'title' })
```

Assert `definitionFingerprint` is stable for a cloned definition, changes for edits and reordering, and never uses Node-only crypto so it can run in the browser.

- [ ] **Step 3: Run state tests and verify failure**

```sh
npm test -- tests/intake-form-editor-state.test.ts
```

Expected: FAIL because the state module does not exist.

- [ ] **Step 4: Implement immutable operations and stable IDs**

Define selection as:

```ts
export type EditorSelection =
  | { kind: 'form' }
  | { kind: 'section'; sectionId: string }
  | { kind: 'item'; sectionId: string; itemId: string }
```

Generate IDs as `section_<uuid>` and `item_<uuid>`, stripping hyphens so IDs stay under 80 characters. Inject an optional ID factory into add functions for deterministic tests. `moveItem` removes once, adjusts same-list indices, and inserts once; it must not copy the item or change its ID.

`definitionFingerprint` uses a browser-safe recursive key sort followed by `JSON.stringify`; it does not import `node:crypto` or the server-only hash module.

- [ ] **Step 5: Define deterministic preview scenarios**

Create deep-frozen records with these controlling facts:

```ts
export const INTAKE_PREVIEW_SCENARIOS = {
  empty: { label: 'Empty', answers: {} },
  single: { label: 'Single', answers: {
    first_name: 'Jordan', last_name: 'Lee', marital_status: 'Single', has_children: false,
  } },
  married: { label: 'Married', answers: {
    first_name: 'Jordan', last_name: 'Lee', marital_status: 'Married', has_children: false,
    _spouse: { first_name: 'Morgan', last_name: 'Lee' },
  } },
  family: { label: 'Family with children', answers: {
    first_name: 'Jordan', last_name: 'Lee', marital_status: 'Married',
    has_children: true, has_minor_children: true,
    _spouse: { first_name: 'Morgan', last_name: 'Lee' },
    _children: [{ first_name: 'Riley', last_name: 'Lee', relationship_type: 'Child' }],
  } },
} as const
```

Tests must prove consumers receive deep clones and cannot mutate the constants between scenario changes.

- [ ] **Step 6: Run tests and commit**

```sh
npm test -- tests/intake-form-editor-state.test.ts tests/intake-form-preview-scenarios.test.ts tests/intake-form-compiler.test.ts
npm run typecheck
git add lib/intake/forms/editorState.ts lib/intake/forms/previewScenarios.ts tests/intake-form-editor-state.test.ts tests/intake-form-preview-scenarios.test.ts
git commit -m "Add intake form editor state foundation"
```

### Task 5: Add the administrator template list and creation workflows

**Files:**
- Modify: `app/admin/settings/settingsNav.ts`
- Create: `app/admin/settings/intake-forms/page.tsx`
- Create: `app/admin/settings/intake-forms/IntakeFormsListClient.tsx`
- Modify: `tests/settings-nav.test.ts`
- Create: `tests/intake-form-builder-list.test.tsx`
- Create: `tests/intake-form-builder-pages.test.tsx`

**Interfaces:**
- `IntakeFormsListClient` consumes `initialTemplates: IntakeFormTemplateSummary[]`.
- New blank form POST body is `{ key, name, description, definition: { schemaVersion: 1, key, title: name, description?, sections: [] } }`.
- Duplicate POST body is `{ sourceVersionId, key, name, description }`.

- [ ] **Step 1: Write failing navigation and page-authorization tests**

Assert `settingsNavFor(true)` contains route `/admin/settings/intake-forms` labelled `Intake forms` in Workflow, while `settingsNavFor(false)` does not. Mark route items with `adminOnly?: boolean` and update filtering so admin-only applies to tabs and routes.

Mock `getCachedClaims` and `getCachedUserRole` in `tests/intake-form-builder-pages.test.tsx`. Assert admin loads data, while attorney, client, and absent auth reach `notFound()` before any repository/service read.

- [ ] **Step 2: Run page tests and verify failure**

```sh
npm test -- tests/settings-nav.test.ts tests/intake-form-builder-pages.test.tsx
```

Expected: FAIL because the route, pages, and route-level authorization do not exist.

- [ ] **Step 3: Add the server list page**

In `page.tsx`, load claims and role, call `notFound()` unless `role === 'admin'`, then call `listIntakeFormTemplateSummaries()`. Render `PageHeader` and an actionable retry error on failure rather than an empty list. Pass successful results to `IntakeFormsListClient`.

- [ ] **Step 4: Write failing list interaction tests**

Cover active-before-archived display, draft/published/retired badges, empty state, last-modified text, only valid actions, blank creation validation, duplicate source selection, archive/restore confirmation, and API failure preserving the current list.

Pin the create request:

```ts
expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/intake-forms', expect.objectContaining({
  method: 'POST',
  body: JSON.stringify({
    key: 'special_needs',
    name: 'Special Needs Planning',
    description: null,
    definition: {
      schemaVersion: 1,
      key: 'special_needs',
      title: 'Special Needs Planning',
      sections: [],
    },
  }),
}))
```

- [ ] **Step 5: Implement the list and dialogs**

Use the existing `PageHeader`, `Button`, `Badge`, `Dialog`, `AlertDialog`, `Input`, and `Textarea` primitives. Active rows appear first; archived rows sit under an `Archived` heading. On successful create or duplicate, navigate to `/admin/settings/intake-forms/<templateId>`. Archive/restore calls `PATCH /api/admin/settings/intake-forms/<templateId>` with `{ archived: true|false }`, then replaces only that summary with the server result or refreshes the list.

Do not label archive as delete. Do not optimistically remove a row before the server succeeds.

- [ ] **Step 6: Run tests and commit**

```sh
npm test -- tests/settings-nav.test.ts tests/intake-form-builder-pages.test.tsx tests/intake-form-builder-list.test.tsx
npm run typecheck
git add app/admin/settings/settingsNav.ts app/admin/settings/intake-forms tests/settings-nav.test.ts tests/intake-form-builder-pages.test.tsx tests/intake-form-builder-list.test.tsx
git commit -m "Add intake form settings list"
```

### Task 6: Build the form outline, catalog drawer, inspector, conditions, and diagnostics

**Files:**
- Create: `app/admin/settings/intake-forms/[templateId]/page.tsx`
- Create: `app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient.tsx`
- Create: `app/admin/settings/intake-forms/[templateId]/IntakeFormOutline.tsx`
- Create: `app/admin/settings/intake-forms/[templateId]/IntakeFormInspector.tsx`
- Create: `app/admin/settings/intake-forms/[templateId]/IntakeCatalogDrawer.tsx`
- Create: `app/admin/settings/intake-forms/[templateId]/IntakeFormDiagnostics.tsx`
- Create: `tests/intake-form-builder-editor.test.tsx`

**Interfaces:**
- Editor page consumes `IntakeFormEditorSnapshot` and `IntakeFormBuilderCatalog` from Tasks 2 and 3.
- `IntakeFormEditorClient` owns `localDefinition`, `savedDefinition`, `selection`, `mode: 'build' | 'preview'`, and compiler diagnostics.
- Child components receive definitions and typed callbacks; none call Supabase or mutate definitions directly.

- [ ] **Step 1: Write failing editor composition tests**

Render a draft snapshot and assert Build is default, form/section/item selection opens the correct inspector, stable key is read-only, labels/help/requirement/audience/time estimate update local state, and incomplete changes show `Unsaved changes` without issuing fetch.

Assert the inspector does not render a raw JSON textarea and text fields enforce schema lengths: title 160, description/help/subtitle 600, ID/key not editable.

- [ ] **Step 2: Write failing catalog and ordering tests**

Cover grouped search by label, description, and stable ID; already-used scalar fields disabled with an explanation; incompatible block audiences disabled; adding an approved field/block; section/item remove confirmation; native drag reorder; and Move up/Move down producing the same order.

Use `fireEvent.dragStart`, `fireEvent.dragOver`, and `fireEvent.drop` for pointer ordering, then separately click accessible buttons named `Move <label> up` and `Move <label> down`.

- [ ] **Step 3: Write failing condition and diagnostic tests**

Assert the editor offers only equals, not equals, is set, all, and any. The field picker contains only earlier eligible scalar fields; boolean values are true/false; select values come from approved options; unsupported multiselect comparisons are unavailable.

Move a controlling field after its dependent item and assert:

1. the condition remains in `localDefinition`;
2. the diagnostics panel reports the existing compiler message;
3. clicking the diagnostic switches to Build, selects the dependent item, and focuses its condition editor.

- [ ] **Step 4: Run editor tests and verify failure**

```sh
npm test -- tests/intake-form-builder-editor.test.tsx
```

Expected: FAIL because the editor components do not exist.

- [ ] **Step 5: Implement the admin-gated editor page**

Use the same role check as the list page. Validate `templateId` as a UUID before loading. Fetch `getIntakeFormEditorSnapshot(templateId)` and `getIntakeFormBuilderCatalog()` server-side. Call `notFound()` for absent/cross-template resources; show a retry error for operational failures.

- [ ] **Step 6: Implement outline and accessible ordering**

Use nested ordered lists and buttons, not clickable non-semantic divs. Native drag state stores `{ kind, id, sectionId? }`; drag-over dispatches the same pure `moveSection`/`moveItem` operations used by move buttons. Drag handles set a `text/plain` payload and expose an accessible label; moving never regenerates IDs.

On narrow layouts, render the inspector below the selected outline node. On `md` and wider, use a two-column grid with the inspector sticky inside its column.

- [ ] **Step 7: Implement catalog drawer and inspectors**

Use `Sheet` plus the existing command/search primitives. Group by catalog `group`, disable entries with a visible reason, and insert through `addItem`. Render only catalog-described address config controls; no generic object editor.

The condition editor recursively renders `all`/`any` children to the schema maximum depth of five, requires at least one child, and delegates validity to the existing compiler. Requirement options below the field baseline are disabled and explained.

- [ ] **Step 8: Implement diagnostics navigation**

Compile local state for both audiences, de-duplicate by path/message exactly as the service does, and render a persistent panel. `targetForDiagnostic` maps paths to form/section/item selection. Give each inspector input a stable DOM ID such as `intake-builder-section-title`; after selection, focus it with `requestAnimationFrame`.

- [ ] **Step 9: Run tests and commit**

```sh
npm test -- tests/intake-form-builder-editor.test.tsx tests/intake-form-editor-state.test.ts tests/intake-form-builder-catalog.test.ts tests/intake-form-compiler.test.ts
npm run typecheck
git add app/admin/settings/intake-forms/'[templateId]' tests/intake-form-builder-editor.test.tsx
git commit -m "Add intake form visual editor"
```

### Task 7: Add explicit saving, conflict recovery, lifecycle actions, and unsaved navigation

**Files:**
- Create: `app/admin/settings/intake-forms/[templateId]/useIntakeFormDraft.ts`
- Modify: `app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient.tsx`
- Modify: `app/admin/settings/intake-forms/[templateId]/IntakeFormDiagnostics.tsx`
- Create: `tests/intake-form-builder-save.test.tsx`
- Create: `tests/intake-form-builder-lifecycle.test.tsx`

**Interfaces:**
- Produces hook state `saveStatus: 'clean' | 'dirty' | 'saving' | 'error' | 'conflict'`.
- Produces `saveDraft`, `reloadLatest`, `copyLocalDefinition`, `publishDraft`, `discardDraft`, `retireVersion`, and `createNextDraft`.
- All successful mutations replace state from parsed server responses; no lifecycle action assumes success from HTTP status alone.

- [ ] **Step 1: Write failing save and conflict tests**

Assert local edits do not auto-save; Save draft sends version ID, expected lock version, and local definition; success updates the saved snapshot/hash/lock and clears dirty state; 422 retains edits and displays diagnostics; network/500 retains edits and offers retry.

For 409, assert local state remains visible and the conflict banner offers `Reload latest` and `Copy local definition`. Reload requires confirmation before replacement. Copy writes canonical pretty JSON to `navigator.clipboard`; when clipboard rejects, create and click a Blob download named `<template-key>-unsaved-intake-form.json`.

- [ ] **Step 2: Write failing unsaved-navigation tests**

Dispatch `beforeunload` and assert `preventDefault` only while dirty, saving, error, or conflict. Click an in-app link while dirty: Cancel keeps the page; Leave allows navigation. Meta/Ctrl/Shift/Alt clicks, downloads, `_blank`, and same-page anchors are not intercepted.

- [ ] **Step 3: Write failing lifecycle tests**

Pin these guards and requests:

- Publish is disabled when dirty, saving, conflicted, or diagnostics exist.
- Publish POST includes saved lock version and saved definition hash.
- A failed publish leaves the draft and editor state unchanged.
- A successful publish replaces the draft with an immutable version view.
- Edit on published/retired POSTs `{ sourceVersionId }` to the draft endpoint.
- Discard DELETE includes expected lock version and requires confirmation.
- Retire POST uses the version-scoped endpoint and requires confirmation.
- Archived templates cannot create a next draft until restored.

- [ ] **Step 4: Run tests and verify failure**

```sh
npm test -- tests/intake-form-builder-save.test.tsx tests/intake-form-builder-lifecycle.test.tsx
```

Expected: FAIL because the hook and lifecycle wiring do not exist.

- [ ] **Step 5: Implement explicit save and response parsing**

Keep request parsing centralized in the hook:

```ts
type IntakeFormApiError = {
  error?: string
  code?: string
  diagnostics?: IntakeFormDiagnostic[]
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new IntakeFormRequestError(response.status, body)
  if (!body || typeof body !== 'object') throw new Error('Invalid intake form response')
  return body as T
}
```

Use `definitionFingerprint(local) !== definitionFingerprint(saved)` for dirty state. Do not debounce or invoke Save from an effect.

- [ ] **Step 6: Implement conflict export and navigation protection**

On conflict, store no replacement server snapshot until `reloadLatest` succeeds. Pretty-print the strict local definition with two-space indentation. The clipboard fallback revokes its object URL after the synthetic download click.

Add `beforeunload` and capture-phase document click listeners with cleanup. The confirmation copy is: `You have unsaved intake form changes. Leave without saving them?`

- [ ] **Step 7: Implement lifecycle confirmations and state transitions**

Use `AlertDialog` for publish, discard, retire, and reload-latest replacement. Confirmation text names the template and version and states the immutable or recoverable consequence. After create-next, replace the editor snapshot with the returned draft. After discard, navigate to the latest immutable version or list. After archive/restore from the list, do not mutate version statuses.

- [ ] **Step 8: Run tests and commit**

```sh
npm test -- tests/intake-form-builder-save.test.tsx tests/intake-form-builder-lifecycle.test.tsx tests/intake-form-admin-routes.test.ts tests/intake-form-admin-service.test.ts
npm run typecheck
git add app/admin/settings/intake-forms/'[templateId]' tests/intake-form-builder-save.test.tsx tests/intake-form-builder-lifecycle.test.tsx
git commit -m "Add intake builder lifecycle controls"
```

### Task 8: Add read-only client/staff preview with synthetic scenarios

**Files:**
- Modify: `components/intake/formEngine/CompiledIntakeSections.tsx`
- Create: `app/admin/settings/intake-forms/[templateId]/IntakeFormPreview.tsx`
- Modify: `app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient.tsx`
- Create: `tests/intake-form-builder-preview.test.tsx`
- Modify: `tests/intake-compiled-sections.test.tsx`

**Interfaces:**
- Adds optional `readOnly?: boolean` to `CompiledIntakeSectionsProps`; default `false` preserves all live behavior.
- Preview compiles `localDefinition` for audience `client | staff`, evaluates a cloned synthetic answer record, and passes `readOnly` to the existing compiled form engine.

- [ ] **Step 1: Write failing renderer read-only tests**

Extend the compiled-renderer test to prove default behavior is unchanged and `readOnly` disables both canonical fields and compound-block fieldsets for client and staff audiences. Assert staff-only sections remain absent in client compilation and visible but disabled in staff preview.

- [ ] **Step 2: Write failing preview tests**

Render the editor with unsaved changes and assert Preview immediately shows the changed title/section order without Save. Switch Client/Staff and Empty/Single/Married/Family scenarios; assert spouse/child conditional sections follow the selected scenario.

Spy on `fetch` and Supabase auth, click every visible preview control plus review/upload affordances, and assert no network or auth call occurs. Assert compiler-invalid local state shows diagnostics rather than a partial form.

- [ ] **Step 3: Run preview tests and verify failure**

```sh
npm test -- tests/intake-form-builder-preview.test.tsx tests/intake-compiled-sections.test.tsx
```

Expected: FAIL because the preview and read-only override do not exist.

- [ ] **Step 4: Add the explicit read-only override**

Add `readOnly?: boolean` to `CompiledIntakeSectionsProps`, default it to false
in the existing parameter list, and change only the section disable value:

```tsx
<CompiledFormSection
  key={section.id}
  {...itemProps}
  section={section}
  number={index + 1 + numberOffset}
  open={openId === section.id}
  disabled={readOnly || (isStaff && section.audience === 'client_and_staff')}
  showValidation={showValidation}
  onToggle={() => onToggle(section.id)}
  onContinue={next && onContinue ? () => onContinue(section.id, next.id) : !next && onLastContinue ? () => onLastContinue(section.id) : undefined}
  continueLabel={onLastContinue ? next ? `Continue to ${next.title}${next.timeEstimate ? ` · ~${next.timeEstimate} min` : ''}` : 'Review questionnaire' : undefined}
/>
```

Keep `readOnly` default false and run the existing live renderer regression tests.

- [ ] **Step 5: Implement the full-width Preview mode**

Use existing `Tabs`, `Select`, and compiled renderer components. Maintain only UI state for audience, scenario, and open section. Clone scenario answers on selection, add `intake_track` from the definition key, call `evaluateCompiledIntakeForm`, and pass a no-op update plus `readOnly`.

Preview does not render `SchemaDrivenGuidedInterview`, `useAutoSave`, `useContacts`, or a submit handler. It renders `CompiledIntakeSections` directly, so no intake ID, token, upload, or persistence adapter exists.

- [ ] **Step 6: Run tests and commit**

```sh
npm test -- tests/intake-form-builder-preview.test.tsx tests/intake-compiled-sections.test.tsx tests/intake-form-preview-scenarios.test.ts tests/intake-form-legacy-parity.test.ts
npm run typecheck
git add components/intake/formEngine/CompiledIntakeSections.tsx app/admin/settings/intake-forms/'[templateId]'/IntakeFormPreview.tsx app/admin/settings/intake-forms/'[templateId]'/IntakeFormEditorClient.tsx tests/intake-form-builder-preview.test.tsx tests/intake-compiled-sections.test.tsx
git commit -m "Add intake builder synthetic preview"
```

### Task 9: Complete accessibility, responsive behavior, regression verification, and release notes

**Files:**
- Modify: `tests/intake-form-builder-editor.test.tsx`
- Modify: `tests/intake-form-builder-list.test.tsx`
- Modify: `tests/intake-form-builder-preview.test.tsx`
- Modify: `docs/superpowers/specs/2026-10-08-intake-form-builder-phase-2b-design.md`
- Modify: `docs/superpowers/specs/2026-10-08-intake-form-builder-design.md`

**Interfaces:**
- Produces the final verified Phase 2B branch; no new product interface is introduced in this task.

- [ ] **Step 1: Add the final accessibility and review-focus tests**

Assert every dialog/sheet has an accessible title and description, catalog search has a label, selected outline nodes expose `aria-current` or `aria-selected`, drag handles and move buttons have unique accessible names, diagnostics are announced, focus returns after closing the drawer/dialog, and the narrow layout renders the inspector after the selected item rather than off-screen.

Re-run the five Review Focus scenarios explicitly in their owning test files and add any missing assertion before proceeding.

- [ ] **Step 2: Run the complete focused suite**

```sh
npx vitest run \
  tests/intake-form-builder-schema.test.ts \
  tests/intake-form-admin-service.test.ts \
  tests/intake-form-admin-routes.test.ts \
  tests/intake-form-builder-catalog.test.ts \
  tests/intake-form-editor-state.test.ts \
  tests/intake-form-preview-scenarios.test.ts \
  tests/settings-nav.test.ts \
  tests/intake-form-builder-pages.test.tsx \
  tests/intake-form-builder-list.test.tsx \
  tests/intake-form-builder-editor.test.tsx \
  tests/intake-form-builder-save.test.tsx \
  tests/intake-form-builder-lifecycle.test.tsx \
  tests/intake-form-builder-preview.test.tsx \
  tests/intake-compiled-sections.test.tsx \
  tests/intake-form-legacy-parity.test.ts
```

Expected: all focused tests pass with no accessibility warnings.

- [ ] **Step 3: Run repository verification**

```sh
npm run lint
npm run typecheck
npm test
git diff --check origin/main...HEAD
```

If the full suite reports an existing failure, reproduce it in a clean checkout of the same `origin/main` SHA before classifying it as pre-existing. Do not report a passing result from a partial run.

- [ ] **Step 4: Perform local authenticated browser acceptance**

Use only the local Supabase stack:

```sh
npx supabase db reset
npm run seed:browser-fixture
npm run dev
```

At desktop and narrow widths, verify with the administrator fixture:

1. blank create → add approved fields/blocks → pointer and move-button reorder → save invalid draft;
2. resolve diagnostics → Married and Family conditional preview → client/staff preview → save → publish;
3. create next draft and verify published version is read-only;
4. open two sessions, save in one, receive conflict in the other, export local JSON, then reload latest;
5. duplicate, retire, archive, restore, and discard while verifying version history and audit rows;
6. sign in as a non-admin and confirm both pages and APIs deny access;
7. query local `client_intake` and prove no row was created or repinned by preview or builder actions;
8. smoke the existing estate and college client/public/staff intake surfaces and drafting entry link.

Record exact URLs, viewport widths, observed results, and any console warnings. Browser authentication against a remote environment still requires explicit user approval; local fixture authentication does not authorize production access.

- [ ] **Step 5: Update verification records**

Change the focused Phase 2B spec status to implemented only after all required automated and browser checks pass. Update the umbrella design status and append a Phase 2B verification record containing exact commands, counts, local migration state, browser scenarios, and remaining Phase 2C/Phase 3 exclusions. Do not claim linked deployment or production QA unless separately authorized and actually performed.

- [ ] **Step 6: Request whole-branch review and address findings**

Use `superpowers:requesting-code-review` with the full `origin/main...HEAD` diff. Resolve every correctness, security, accessibility, and regression finding, rerun the affected focused tests, then rerun the complete verification commands before the final commit.

- [ ] **Step 7: Commit the verification record**

```sh
git add tests/intake-form-builder-editor.test.tsx tests/intake-form-builder-list.test.tsx tests/intake-form-builder-preview.test.tsx docs/superpowers/specs/2026-10-08-intake-form-builder-phase-2b-design.md docs/superpowers/specs/2026-10-08-intake-form-builder-design.md
git commit -m "Verify intake form builder Phase 2B"
```

Do not push, create a pull request, deploy the migration, install production data, or run authenticated production browser QA until the user separately authorizes those actions.
