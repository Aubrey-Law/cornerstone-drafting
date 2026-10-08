# Canonical Intake Form Renderer Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded intake orchestration with strict bundled form definitions and a shared renderer while preserving the current estate and college-preparation behavior and retaining a temporary rollback renderer.

**Architecture:** Add a code-owned scalar-field catalog and compound-block catalog, parse bundled form definitions through a strict versioned compiler, and evaluate navigation, completion, validation, review, and submission from one compiled model. The client receives a server-compiled, audience-filtered definition; canonical adapters continue writing existing intake, contact, asset, fiduciary, and document stores.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, Zod 3, Vitest 4, Testing Library, the existing `@aubrey-law/estate-fields` workspace package, and existing Supabase-backed intake APIs without schema changes.

**Spec:** `docs/superpowers/specs/2026-10-08-intake-form-builder-design.md`

## Global Constraints

- Phase 1 adds no Supabase tables, migrations, generic answer JSON, custom questions, or builder UI.
- Only code-reviewed `SharedFieldId` and `IntakeBlockId` values may appear in a form definition.
- Form configuration cannot alter persistence keys, drafting mappings, normalization, catalog validation, or code-owned submission invariants.
- Existing answers remain in `client_intake`, contacts and matter contacts, asset records, fiduciary roles, and intake documents.
- Hidden questions retain stored values and are excluded from active form completion and validation.
- Client/public compiled output contains no staff-only sections or items.
- Existing public-token, autosave, contact-on-section-leave, review, and explicit-submit behavior remains intact.
- Only first name, last name, email, and phone remain submission-blocking for the existing estate form; later omissions remain visible without blocking.
- The current estate and college-preparation forms are behaviorally unchanged in Phase 1.
- Drafting internals, `buildDraftPayload`, document generation, and intake-to-design mapping semantics are not changed.
- The legacy renderer remains available behind a server-selected rollback mode until production parity is accepted.
- Follow repository policy: TDD, narrow commits, `npm run lint`, `npm run typecheck`, and `npm test`; compare unexplained failures with a clean checkout.

## Review Focus

- **Malformed or unknown definition input:** compilation must reject it with deterministic diagnostics and must never render a partial questionnaire; Task 2 and Task 5 test this.
- **A controlling answer hides a populated section:** the section disappears from active progress and validation while its stored answer remains unchanged; Task 2 and Task 5 test this.
- **Legacy stored select values:** retired values remain displayable and do not make an existing intake impossible to submit; Task 3 tests this through the scalar catalog.
- **Contact-only submit rule:** incomplete address, spouse, child, fiduciary, or asset answers still surface but do not block submission; Task 6 and Task 9 test this.
- **Track isolation:** college-preparation intakes never acquire estate spouse/assets/guardian sections or their validation, and estate intakes never acquire college sections; Task 6 and Task 9 test this.

---

### Task 1: Freeze legacy behavior in a parity matrix

**Files:**
- Create: `tests/fixtures/intakeFormParity.ts`
- Create: `tests/intake-form-legacy-parity.test.ts`
- Read: `lib/intakeSections.ts`
- Read: `lib/collegePrepSections.ts`

**Interfaces:**
- Consumes: current `getActiveSteps`, `getRequiredSteps`, `getStepIssues`, `getSubmissionErrors`, and `IntakeRow`.
- Produces: `INTAKE_PARITY_CASES: readonly IntakeParityCase[]` and `captureLegacyIntakeResult(data): IntakeParityResult`, used by Tasks 6 and 9.

- [ ] **Step 1: Create representative intake fixtures**

Create the fixture contract and cases covering blank estate, contact-only estate, married estate, children/minor children, legacy estate values, complete estate, blank college, under-18 college, and complete college:

```ts
export interface IntakeParityCase {
  name: string
  data: IntakeRow
}

export const CONTACT_ONLY: IntakeRow = {
  first_name: 'Jane',
  last_name: 'Example',
  email: 'jane@example.com',
  phone: '(617) 555-0100',
}

export const COMPLETE_ESTATE: IntakeRow = {
  ...CONTACT_ONLY,
  address_line1: '1 Main Street', city: 'Boston', state: 'MA', zip: '02108',
  date_of_birth: '1980-01-01', county: 'Suffolk', marital_status: 'single',
  has_children: false, estate_value: 'under_500k', asset_types: ['financial'],
  has_real_property: false, planning_goals: ['avoid_probate'],
  _fid_personal_rep_client: [{ first_name: 'Pat', last_name: 'Representative' }],
  _fid_poa_client: [{ first_name: 'Alex', last_name: 'Agent' }],
  _fid_hcp_client: [{ first_name: 'Casey', last_name: 'Proxy' }],
  _fid_trustee_client: [{ first_name: 'Taylor', last_name: 'Trustee' }],
}

export const COMPLETE_COLLEGE: IntakeRow = {
  ...CONTACT_ONLY,
  intake_track: 'college_prep',
  street_address: '12 Elm Street', city: 'Newton', state: 'MA', zip: '02458',
  county: 'Middlesex', date_of_birth: '2007-04-02',
  college_school_name: 'Northeastern University', college_school_city: 'Boston',
  college_school_state: 'MA', college_move_in_date: '2026-08-28',
  college_ferpa_release: true, college_ferpa_records: ['grades', 'billing'],
  _additional_contacts: [{ id: '1', first_name: 'Alma', last_name: 'Example', relationship: 'Mother' }],
  _fid_poa_client: [{ first_name: 'Alma', last_name: 'Example', priority: 1 }],
  _fid_hcp_client: [{ first_name: 'Alma', last_name: 'Example', priority: 1 }],
  college_hipaa_recipients: [{ id: 'r1', name: 'Alma Example', relationship: 'Mother' }],
  college_dpoa_effective: 'immediately', college_dpoa_powers: ['banking', 'tuition'],
  college_hipaa_scope: 'all', college_hipaa_expiration: 'none',
  college_living_will_include: 'yes', college_life_support: 'comfort_only',
  college_organ_donation: 'any',
}

export const INTAKE_PARITY_CASES: readonly IntakeParityCase[] = [
  { name: 'estate blank', data: {} },
  { name: 'estate contact only', data: CONTACT_ONLY },
  {
    name: 'estate married with minor child',
    data: {
      ...CONTACT_ONLY,
      marital_status: 'married',
      has_children: true,
      has_minor_children: true,
      _children: [{ first_name: 'Casey', last_name: 'Example', date_of_birth: '2018-01-02' }],
    },
  },
  { name: 'estate legacy value', data: { ...CONTACT_ONLY, estate_value: 'under_1m' } },
  { name: 'estate complete', data: COMPLETE_ESTATE },
  { name: 'college blank', data: { intake_track: 'college_prep' } },
  {
    name: 'college under eighteen',
    data: { ...CONTACT_ONLY, intake_track: 'college_prep', date_of_birth: '2010-01-01' },
  },
  { name: 'college complete', data: COMPLETE_COLLEGE },
]
```

- [ ] **Step 2: Write the legacy capture test**

```ts
export interface IntakeParityResult {
  activeIds: string[]
  requiredIds: string[]
  completionById: Record<string, boolean>
  issuesById: Record<string, Array<{ message: string; severity: string; blocksSubmission: boolean }>>
  submissionErrors: Array<{ sectionId: string; message: string }>
}

export function captureLegacyIntakeResult(data: IntakeRow): IntakeParityResult {
  const active = getActiveSteps(data)
  return {
    activeIds: active.map((step) => step.id),
    requiredIds: getRequiredSteps(data).map((step) => step.id),
    completionById: Object.fromEntries(active.map((step) => [step.id, step.isComplete(data)])),
    issuesById: Object.fromEntries(active.map((step) => [
      step.id,
      getStepIssues(step.id, data).map((issue) => ({
        message: issue.message,
        severity: issue.severity,
        blocksSubmission: issue.blocksSubmission === true,
      })),
    ])),
    submissionErrors: getSubmissionErrors(data).map((issue) => ({
      sectionId: issue.sectionId,
      message: issue.message,
    })),
  }
}
```

Assert fixed high-value invariants instead of taking opaque snapshots: spouse and spouse-fiduciary visibility, guardian visibility, college/estate isolation, optional-section exclusion, contact-only submission, and the under-18 warning.

- [ ] **Step 3: Run the legacy parity test**

Run: `npx vitest run tests/intake-form-legacy-parity.test.ts`

Expected: PASS with all fixtures evaluated by the existing hard-coded implementation.

- [ ] **Step 4: Commit the characterization baseline**

```bash
git add tests/fixtures/intakeFormParity.ts tests/intake-form-legacy-parity.test.ts
git commit -m "test: freeze intake form behavior"
```

---

### Task 2: Define and validate the form-definition contract

**Files:**
- Create: `lib/intake/forms/types.ts`
- Create: `lib/intake/forms/schema.ts`
- Create: `lib/intake/forms/conditions.ts`
- Create: `tests/intake-form-definition.test.ts`

**Interfaces:**
- Consumes: `SharedFieldId` from `@aubrey-law/estate-fields/core`.
- Produces: `IntakeFormDefinition`, `IntakeFormSection`, `IntakeFormItem`, `IntakeCondition`, `IntakeAudience`, `parseIntakeFormDefinition(raw)`, `evaluateIntakeCondition(condition, resolveValue)`, and `collectConditionFieldIds(condition)`.

- [ ] **Step 1: Write failing strict-schema tests**

Cover a valid minimal definition, unknown top-level and nested keys, duplicate section IDs, duplicate item IDs, blank IDs, oversized labels/help text, an unsupported schema version, invalid condition value types, an empty `all`/`any`, and a condition referencing its own item.

```ts
it('rejects executable and unknown definition content', () => {
  const result = parseIntakeFormDefinition({
    schemaVersion: 1,
    key: 'estate',
    title: 'Estate',
    onLoad: 'alert(1)',
    sections: [],
  })
  expect(result.success).toBe(false)
  if (result.success) return
  expect(result.errors.join('\n')).toContain('onLoad')
})
```

- [ ] **Step 2: Run the definition tests and verify failure**

Run: `npx vitest run tests/intake-form-definition.test.ts`

Expected: FAIL because `lib/intake/forms/schema.ts` does not exist.

- [ ] **Step 3: Implement the serializable types**

Use discriminated unions and no function-valued properties:

```ts
export type IntakeAudience = 'client_and_staff' | 'staff_only'
export type IntakeRequirement = 'optional' | 'recommended' | 'required'
export type IntakeBlockId =
  | 'address'
  | 'spouse_details'
  | 'children'
  | 'financial_assets'
  | 'planning_objectives'
  | 'existing_document_uploads'
  | 'additional_contacts'
  | 'client_fiduciaries'
  | 'spouse_fiduciaries'
  | 'guardian'
  | 'college_parents'
  | 'college_agents'
  | 'college_hipaa_recipients'
  | 'review_submit'
  | 'attorney_plan_structure'
  | 'attorney_documents'

export type IntakeCondition =
  | { op: 'equals'; fieldId: SharedFieldId; value: string | boolean }
  | { op: 'not_equals'; fieldId: SharedFieldId; value: string | boolean }
  | { op: 'is_set'; fieldId: SharedFieldId }
  | { op: 'all' | 'any'; conditions: IntakeCondition[] }

export type IntakeFormItem =
  | {
      kind: 'field'
      id: string
      fieldId: SharedFieldId
      labelOverride?: string
      helpText?: string
      requirement?: IntakeRequirement
      condition?: IntakeCondition
    }
  | {
      kind: 'block'
      id: string
      blockId: IntakeBlockId
      titleOverride?: string
      helpText?: string
      config?: Record<string, unknown>
      condition?: IntakeCondition
    }

export interface IntakeFormSection {
  id: string
  title: string
  subtitle?: string
  timeEstimateMinutes?: number
  optional?: boolean
  audience: IntakeAudience
  condition?: IntakeCondition
  items: IntakeFormItem[]
}

export interface IntakeFormDefinition {
  schemaVersion: 1
  key: string
  title: string
  description?: string
  sections: IntakeFormSection[]
}
```

Define the exact `IntakeBlockId` string union in `types.ts`. Task 4's registry
must use `satisfies Record<IntakeBlockId, IntakeBlockDefinition>` so the type
and registry cannot drift.

- [ ] **Step 4: Implement strict Zod parsing and semantic checks**

Use `.strict()` at every object level. Cap IDs at 80 characters, titles/labels at 160, subtitles/help text at 600, sections at 40, items per section at 100, and condition nesting at 5. Return stable path-prefixed strings:

```ts
export type ParseIntakeFormResult =
  | { success: true; data: IntakeFormDefinition }
  | { success: false; errors: string[] }

export function parseIntakeFormDefinition(raw: unknown): ParseIntakeFormResult {
  const parsed = intakeFormDefinitionSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) =>
        `${issue.path.join('.') || 'definition'}: ${issue.message}`,
      ),
    }
  }
  return validateUniqueIdsAndConditionDepth(parsed.data)
}
```

- [ ] **Step 5: Implement the pure condition evaluator**

Treat missing values as unset, trim strings for `is_set`, treat empty arrays as unset, and never mutate data:

```ts
export function evaluateIntakeCondition(
  condition: IntakeCondition | undefined,
  resolveValue: (fieldId: SharedFieldId) => unknown,
): boolean {
  if (!condition) return true
  if (condition.op === 'all') return condition.conditions.every((entry) => evaluateIntakeCondition(entry, resolveValue))
  if (condition.op === 'any') return condition.conditions.some((entry) => evaluateIntakeCondition(entry, resolveValue))
  const value = resolveValue(condition.fieldId)
  if (condition.op === 'is_set') return isSet(value)
  return condition.op === 'equals' ? value === condition.value : value !== condition.value
}
```

- [ ] **Step 6: Add hidden-value retention tests**

Evaluate a spouse condition with resolvers returning `married` and `single`.
Keep the original frozen intake row unchanged and assert its already-populated
`_spouse` value remains present after the condition returns false.

- [ ] **Step 7: Run the definition tests**

Run: `npx vitest run tests/intake-form-definition.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the definition contract**

```bash
git add lib/intake/forms/types.ts lib/intake/forms/schema.ts lib/intake/forms/conditions.ts tests/intake-form-definition.test.ts
git commit -m "feat: define canonical intake forms"
```

---

### Task 3: Complete the builder-enabled scalar field catalog

**Files:**
- Modify: `packages/estate-fields/src/core/types.ts`
- Modify: `packages/estate-fields/src/core/registry.ts`
- Modify: `packages/estate-fields/src/core/index.ts`
- Modify: `packages/estate-fields/src/react/IntakeField.tsx`
- Create: `packages/estate-fields/src/core/intakeCatalog.ts`
- Create: `components/intake/formEngine/CanonicalFieldItem.tsx`
- Create: `tests/intake-canonical-field-catalog.test.ts`
- Create: `tests/intake-canonical-field-item.test.tsx`

**Interfaces:**
- Consumes: existing `SharedFieldDef`, normalization helpers, options, `IntakeField`, and `FormField` primitives.
- Produces: `BuilderFieldDef`, `BUILDER_FIELD_IDS`, `getBuilderField(id)`, `readBuilderFieldValue(id, data)`, `writeBuilderFieldValue(id, value, update)`, and `<CanonicalFieldItem item data update disabled />`.

- [ ] **Step 1: Write a failing catalog-ownership test**

Assert every builder field resolves to one stable intake path, exposes an allowed control, and cannot supply its path from form JSON:

```ts
it('owns persistence and validation in code', () => {
  for (const id of BUILDER_FIELD_IDS) {
    const field = getBuilderField(id)
    expect(field.id).toBe(id)
    expect(field.read).toBeTypeOf('function')
    expect(field.write).toBeTypeOf('function')
    expect(['text', 'email', 'tel', 'date', 'textarea', 'select', 'boolean', 'multiselect'])
      .toContain(field.control)
  }
})
```

Assert these groups are present:

- identity/contact: `client_first_name`, `client_middle_name`, `client_last_name`, `client_suffix`, `client_prior_name`, `client_preferred_name`, `client_pronouns`, `client_dob`, `client_citizenship`, `client_email`, `client_phone`, `street`, `city`, `state`, `zip`, `county`;
- referral/family: `referral_source`, `referral_name`, `legal_insurance_plan`, `legal_insurance_member_id`, `marital_status`, `has_children`, `has_minor_children`, `marriage_date`;
- estate/goals: `estate_value`, `asset_types`, `planning_goals`, `has_existing_plan`, `has_divorce_settlement`, `has_ltc_insurance`, `has_prior_gift_tax`, `special_notes`;
- college: `college_school_name`, `college_move_in_date`,
  `college_school_city`, `college_school_state`, `college_studying_abroad`,
  `college_abroad_country`, `college_ferpa_release`, `college_ferpa_records`,
  `college_ferpa_recipients`, `college_family_circumstances`,
  `college_dpoa_effective`, `college_dpoa_powers`, `college_dpoa_withheld`,
  `college_dpoa_notes`, `college_hcp_limits`, `college_hcp_instructions`,
  `college_hipaa_scope`, `college_hipaa_different_scope`,
  `college_hipaa_excluded_categories`, `college_hipaa_expiration`,
  `college_hipaa_expiration_date`, `college_living_will_include`,
  `college_life_support`, `college_artificial_nutrition`,
  `college_ventilation`, `college_cpr`, `college_comfort_always`,
  `college_organ_donation`, `college_organ_donation_notes`,
  `college_other_medical_notes`, `college_excluded_people`, and
  `college_concerns`. `college_hipaa_recipients` is intentionally absent because
  it belongs to the compound block catalog as a repeatable person collection.

- [ ] **Step 2: Run the scalar catalog tests and verify failure**

Run: `npx vitest run tests/intake-canonical-field-catalog.test.ts`

Expected: FAIL because builder catalog metadata is absent.

- [ ] **Step 3: Extend field metadata without changing existing mappings**

Add optional catalog properties to `SharedFieldDef`:

```ts
export interface SharedFieldDef {
  // existing properties remain unchanged
  builderEnabled?: boolean
  baselineRequirement?: 'optional' | 'recommended' | 'required'
  validationProfile?: 'none' | 'email' | 'phone' | 'ma_county' | 'date'
}

export interface BuilderFieldDef extends SharedFieldDef {
  builderEnabled: true
  baselineRequirement: 'optional' | 'recommended' | 'required'
  read: (data: Readonly<Record<string, unknown>>) => unknown
  write: (
    value: unknown,
    update: (field: string, value: unknown) => void,
  ) => void
}
```

Do not repurpose existing IDs or change any existing `designKey`,
`intakeToDesign`, option value, normalizer, or legacy value. Add granular name
IDs instead of redefining `client_name`.

- [ ] **Step 4: Add the scalar entries and options**

Move any college option constants needed by catalog entries from app-only files
into `packages/estate-fields/src/core/intakeCatalog.ts`, then re-export them
back through the existing app modules so callers retain the same values.
Boolean fields use the `boolean` control; multi-value fields use
`multiselect`; long narrative fields use `textarea`.

For nested or transformed values, define code-owned `read` and `write` adapters
in `intakeCatalog.ts`; form definitions still contain only the field ID.

- [ ] **Step 5: Extend the package field renderer**

Implement accessible textarea, checkbox/switch-equivalent boolean, and
multiselect rendering while preserving select legacy values:

```tsx
if (def.control === 'textarea') {
  return <textarea id={id} value={display} required={required} onChange={(event) => commit(event.target.value)} />
}

if (def.control === 'boolean') {
  return <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
}

if (def.control === 'multiselect') {
  const selected = new Set(Array.isArray(value) ? value.map(String) : [])
  return (
    <fieldset id={id}>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={selected.has(option.value)}
            onChange={(event) => {
              const next = new Set(selected)
              if (event.target.checked) next.add(option.value)
              else next.delete(option.value)
              onChange([...next])
            }}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
```

When a stored select value is listed in `legacyValues`, append a disabled
selected option carrying that value's existing display label; do not normalize
it to blank.

- [ ] **Step 6: Implement `CanonicalFieldItem`**

Resolve label, help text, requiredness, value, and update behavior from the
compiled field item plus catalog metadata. The component must not accept an
`intakeKey` prop:

```tsx
export function CanonicalFieldItem({ item, data, update, disabled }: Props) {
  const def = getBuilderField(item.fieldId)
  const value = readBuilderFieldValue(item.fieldId, data)
  return (
    <FormField label={item.labelOverride ?? def.label} optional={item.requirement === 'optional'}>
      <IntakeField
        fieldId={item.fieldId}
        value={value}
        required={item.effectiveRequirement === 'required'}
        onChange={(next) => { if (!disabled) writeBuilderFieldValue(item.fieldId, next, update) }}
      />
      {item.helpText ? <p>{item.helpText}</p> : null}
    </FormField>
  )
}
```

Define `CanonicalFieldRenderItem` beside the component with `kind: 'field'`,
`fieldId`, resolved label/help text, and `effectiveRequirement`. Task 5's
`CompiledFieldItem` extends that interface so Task 3 does not depend on a type
that has not been introduced yet.

- [ ] **Step 7: Test controls, labels, writes, and legacy values**

Use Testing Library to select county, toggle a boolean, change a narrative
field, and verify the canonical update key. Render a retired estate-value option
and assert it remains selected and visible.

- [ ] **Step 8: Run scalar catalog and field tests**

Run: `npx vitest run tests/intake-canonical-field-catalog.test.ts tests/intake-canonical-field-item.test.tsx tests/estate-fields-ownership.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the scalar catalog**

```bash
git add packages/estate-fields/src components/intake/formEngine/CanonicalFieldItem.tsx tests/intake-canonical-field-catalog.test.ts tests/intake-canonical-field-item.test.tsx
git commit -m "feat: catalog canonical intake fields"
```

---

### Task 4: Add the approved compound-block catalog

**Files:**
- Create: `lib/intake/forms/blockRegistry.ts`
- Create: `components/intake/formEngine/blockRenderers.tsx`
- Modify: `components/intake/IntakeWizard.tsx`
- Modify: `components/intake/IntakeFamilySteps.tsx`
- Modify: `components/intake/IntakeChildrenStep.tsx`
- Modify: `components/intake/collegePrep/CollegePrepSteps.tsx`
- Create: `tests/intake-block-registry.test.ts`
- Create: `tests/intake-block-renderers.test.tsx`

**Interfaces:**
- Consumes: existing `StepProps`, contact/fiduciary persistence, upload components, review choices, and existing step component internals.
- Produces: `IntakeBlockId`, `IntakeBlockDefinition`, `INTAKE_BLOCK_REGISTRY`, `getIntakeBlock(id)`, `evaluateIntakeBlock(id, config, data)`, `persistIntakeBlockOnLeave(id, data, context)`, and `INTAKE_BLOCK_RENDERERS`.

- [ ] **Step 1: Write failing registry tests for the approved block IDs**

Require exactly these Phase 1 IDs:

```ts
const EXPECTED_BLOCKS = [
  'address',
  'spouse_details',
  'children',
  'financial_assets',
  'planning_objectives',
  'existing_document_uploads',
  'additional_contacts',
  'client_fiduciaries',
  'spouse_fiduciaries',
  'guardian',
  'college_parents',
  'college_agents',
  'college_hipaa_recipients',
  'review_submit',
  'attorney_plan_structure',
  'attorney_documents',
] as const
```

Assert each block declares allowed audiences, a strict config parser, a pure
evaluator, whether it persists on section leave, and a matching client renderer.

- [ ] **Step 2: Run block registry tests and verify failure**

Run: `npx vitest run tests/intake-block-registry.test.ts`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the pure block registry**

```ts
export interface BlockEvaluation {
  complete: boolean
  issues: IntakeSectionIssueDraft[]
}

export interface IntakeSectionIssueDraft {
  message: string
  severity: 'error' | 'warning'
  blocksSubmission?: boolean
}

export interface IntakeBlockDefinition<Config = unknown> {
  id: IntakeBlockId
  audiences: readonly IntakeAudience[]
  configSchema: z.ZodType<Config>
  evaluate: (config: Config, data: IntakeRow) => BlockEvaluation
  persistOnLeave: boolean
}
```

Keep React imports out of this file so compiler and evaluator tests remain
server-safe. Move the current completion and issue rules from section switch
statements into the owning field or block evaluator without changing copy,
severity, or `blocksSubmission`.

- [ ] **Step 4: Extract narrow block renderers from current step components**

Export components with the common `StepProps` shape for each approved block.
For example, `StepEstate` becomes a composition of scalar field items plus
`FinancialAssetsBlock`; `StepGoals` becomes scalar items plus
`PlanningObjectivesBlock` and `ExistingDocumentUploadsBlock`. Preserve the old
step exports as compositions so the rollback renderer remains unchanged.

Create a renderer map with exhaustive typing:

```tsx
export const INTAKE_BLOCK_RENDERERS = {
  address: AddressBlock,
  spouse_details: SpouseDetailsBlock,
  children: ChildrenBlock,
  financial_assets: FinancialAssetsBlock,
  planning_objectives: PlanningObjectivesBlock,
  existing_document_uploads: ExistingDocumentUploadsBlock,
  additional_contacts: AdditionalContactsBlock,
  client_fiduciaries: ClientFiduciariesBlock,
  spouse_fiduciaries: SpouseFiduciariesBlock,
  guardian: GuardianBlock,
  college_parents: CollegeParentsBlock,
  college_agents: CollegeAgentsBlock,
  college_hipaa_recipients: CollegeHipaaRecipientsBlock,
  review_submit: ReviewSubmitBlock,
  attorney_plan_structure: AttorneyPlanStructureBlock,
  attorney_documents: AttorneyDocumentsBlock,
} satisfies Record<IntakeBlockId, React.ComponentType<IntakeBlockRendererProps>>
```

- [ ] **Step 5: Move contact persistence behind block IDs**

Replace section-name checks inside the new renderer path with
`persistIntakeBlockOnLeave`. Map the contact-backed blocks to the existing
save helpers; non-contact blocks return immediately. Do not change the public
token or matter-contact authorization paths.

- [ ] **Step 6: Test matter-scoped and hidden block behavior**

Assert `spouse_details`, `children`, and fiduciary blocks preserve hydrated
contact data; hidden blocks are not evaluated by the form evaluator; and
`financial_assets` never receives an arbitrary persistence key through config.

- [ ] **Step 7: Run block tests and existing contact tests**

Run: `npx vitest run tests/intake-block-registry.test.ts tests/intake-block-renderers.test.tsx tests/intake-children-save.test.ts tests/intake-fiduciary-snapshot.test.ts tests/intake-hydration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the block catalog**

```bash
git add lib/intake/forms/blockRegistry.ts components/intake/formEngine/blockRenderers.tsx components/intake/IntakeWizard.tsx components/intake/IntakeFamilySteps.tsx components/intake/IntakeChildrenStep.tsx components/intake/collegePrep/CollegePrepSteps.tsx tests/intake-block-registry.test.ts tests/intake-block-renderers.test.tsx
git commit -m "feat: catalog canonical intake blocks"
```

---

### Task 5: Compile and evaluate canonical forms

**Files:**
- Create: `lib/intake/forms/compiler.ts`
- Create: `lib/intake/forms/evaluator.ts`
- Create: `tests/intake-form-compiler.test.ts`
- Create: `tests/intake-form-evaluator.test.ts`

**Interfaces:**
- Consumes: `parseIntakeFormDefinition`, `evaluateIntakeCondition`, scalar catalog, and block registry.
- Produces: `compileIntakeForm(raw, audience): CompileIntakeFormResult`, `CompiledIntakeForm`, `CompiledIntakeSection`, `CompiledIntakeItem`, and `evaluateCompiledIntakeForm(form, data): IntakeFormEvaluation`.

- [ ] **Step 1: Write failing compiler tests**

Test unknown field/block IDs, unsupported block config, duplicate use of a
single-use field, forward condition references, condition value/type mismatch,
staff-only stripping, requirement weakening, missing review/submit path, and a
valid client form.

```ts
it('removes staff-only content instead of marking it hidden', () => {
  const result = compileIntakeForm(FORM_WITH_INTERNAL_SECTION, 'client')
  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.form.sections.map((section) => section.id)).toEqual(['personal', 'review'])
  expect(JSON.stringify(result.form)).not.toContain('internal_signing')
})
```

- [ ] **Step 2: Run compiler/evaluator tests and verify failure**

Run: `npx vitest run tests/intake-form-compiler.test.ts tests/intake-form-evaluator.test.ts`

Expected: FAIL because compiler and evaluator modules do not exist.

- [ ] **Step 3: Implement deterministic compilation**

Return serializable data only. Resolve effective label/help text/requirement,
validate block config through its registry schema, collect all diagnostics, and
sort diagnostics by definition path:

```ts
export type CompileIntakeFormResult =
  | { success: true; form: CompiledIntakeForm }
  | { success: false; errors: Array<{ path: string; message: string }> }

export function compileIntakeForm(raw: unknown, audience: 'client' | 'staff'): CompileIntakeFormResult {
  const parsed = parseIntakeFormDefinition(raw)
  if (!parsed.success) return { success: false, errors: parsed.errors.map(toDiagnostic) }
  return compileParsedForm(parsed.data, audience)
}
```

Compilation must clone config data, never attach React components/functions,
and never include a staff-only section in client output.

- [ ] **Step 4: Implement one evaluation result for all consumers**

```ts
export interface IntakeFormEvaluation {
  activeSections: EvaluatedIntakeSection[]
  requiredSections: EvaluatedIntakeSection[]
  issues: IntakeSectionIssue[]
  submissionErrors: IntakeSectionIssue[]
  completedRequired: number
  percentComplete: number
  remainingMinutes: number
}
```

For each section, evaluate its condition, then its active items. Aggregate
scalar and block issues, compute completion from active required/recommended
items and block evaluation, and derive submission errors only from issues whose
code-owned metadata sets `blocksSubmission`.

Pass conditions a resolver implemented as
`(fieldId) => readBuilderFieldValue(fieldId, data)`. Conditions never read a
form-supplied path and never assume the field ID equals the stored intake key.

- [ ] **Step 5: Pin the Review Focus cases**

Add tests proving a populated spouse block becomes inactive when marital status
changes to single without mutating `_spouse`; retired options stay evaluable;
staff sections are absent for clients; and contact-only answers yield no
submission errors despite later section issues.

- [ ] **Step 6: Run compiler and evaluator tests**

Run: `npx vitest run tests/intake-form-compiler.test.ts tests/intake-form-evaluator.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit compiler and evaluator**

```bash
git add lib/intake/forms/compiler.ts lib/intake/forms/evaluator.ts tests/intake-form-compiler.test.ts tests/intake-form-evaluator.test.ts
git commit -m "feat: compile and evaluate intake forms"
```

---

### Task 6: Encode the estate and college-preparation definitions

**Files:**
- Create: `lib/intake/forms/definitions/estate.ts`
- Create: `lib/intake/forms/definitions/collegePrep.ts`
- Create: `lib/intake/forms/definitions/index.ts`
- Create: `tests/intake-form-bundled-definitions.test.ts`
- Modify: `tests/intake-form-legacy-parity.test.ts`

**Interfaces:**
- Consumes: form types/compiler/evaluator and `INTAKE_PARITY_CASES`.
- Produces: `ESTATE_INTAKE_FORM`, `COLLEGE_PREP_INTAKE_FORM`, `getBundledIntakeForm(track)`, `compileBundledIntakeForm(track, audience)`, and `evaluateBundledIntakeForm(track, audience, data)`.

- [ ] **Step 1: Write failing structural tests for both definitions**

Assert stable keys, section order, titles, estimates, conditions, audience, and
review path. The estate IDs must be:

```ts
[
  'referral', 'personal', 'family', 'spouse', 'children', 'estate', 'goals',
  'additional_contacts', 'fiduciaries', 'spouse_fiduciaries', 'guardian', 'review',
]
```

The college IDs must be:

```ts
[
  'cp_student', 'cp_school', 'cp_parents', 'cp_agents', 'cp_dpoa',
  'cp_healthcare', 'cp_hipaa', 'cp_living_will', 'cp_other', 'review',
]
```

Compile each definition for client and staff and assert success.

- [ ] **Step 2: Run bundled-definition tests and verify failure**

Run: `npx vitest run tests/intake-form-bundled-definitions.test.ts`

Expected: FAIL because the definitions do not exist.

- [ ] **Step 3: Encode the estate definition**

Represent ordinary questions as `field` items and use only approved blocks for
address, spouse details, children, financial assets, planning objectives,
uploads, contacts, fiduciaries, guardian, and review. Encode the existing
conditions exactly:

```ts
condition: { op: 'equals', fieldId: 'marital_status', value: 'married' }
condition: { op: 'equals', fieldId: 'has_children', value: true }
condition: { op: 'equals', fieldId: 'has_minor_children', value: true }
```

Keep the current title, subtitle, optional status, time estimate, warning copy,
and contact-only blocking behavior.

- [ ] **Step 4: Encode the college-preparation definition**

Use shared identity/address fields, approved parent/agent/HIPAA-recipient blocks,
and canonical college scalar fields. Preserve the `cp_` IDs, fixed package copy,
optional health-care/other sections, under-18 warning, FERPA dependencies,
HIPAA expiration rules, and review-choice semantics.

- [ ] **Step 5: Compare compiled results with every legacy fixture**

Extend `tests/intake-form-legacy-parity.test.ts`:

```ts
it.each(INTAKE_PARITY_CASES)('$name matches the compiled definition', ({ data }) => {
  const legacy = captureLegacyIntakeResult(data)
  const track = getIntakeTrack(data)
  const compiled = compileBundledIntakeForm(track, 'client')
  expect(compiled.success).toBe(true)
  if (!compiled.success) return
  expect(captureCompiledIntakeResult(compiled.form, data)).toEqual(legacy)
})
```

Implement `captureCompiledIntakeResult` in that test beside
`captureLegacyIntakeResult`; normalize active IDs, required IDs, completion,
issue message/severity/blocking, and submission errors into the same
`IntakeParityResult` shape before comparison.

Do not update expected legacy output to make the new engine pass; fix the
definition, catalog metadata, or evaluator.

- [ ] **Step 6: Run definition and parity tests**

Run: `npx vitest run tests/intake-form-bundled-definitions.test.ts tests/intake-form-legacy-parity.test.ts tests/college-prep-intake.test.ts tests/intake-submission-contact-only.test.ts`

Expected: PASS with exact parity for all fixtures.

- [ ] **Step 7: Commit bundled forms**

```bash
git add lib/intake/forms/definitions tests/intake-form-bundled-definitions.test.ts tests/intake-form-legacy-parity.test.ts
git commit -m "feat: bundle canonical intake definitions"
```

---

### Task 7: Render compiled sections and items

**Files:**
- Create: `components/intake/formEngine/CompiledFormSection.tsx`
- Create: `components/intake/formEngine/CompiledFormItem.tsx`
- Create: `components/intake/formEngine/CompiledIntakeSections.tsx`
- Create: `tests/intake-compiled-sections.test.tsx`

**Interfaces:**
- Consumes: `CompiledIntakeForm`, `IntakeFormEvaluation`, `CanonicalFieldItem`, block renderer registry, `GuidedSection`, `StepProps`, and section-issue presentation.
- Produces: `<CompiledIntakeSections form evaluation data update intakeId publicIntakeToken mode openId onToggle onContinue />`.

- [ ] **Step 1: Write failing renderer tests**

Render a two-section compiled form and verify field labels/help text, block
rendering, section number/title/subtitle, issue copy, read-only staff behavior,
continue navigation, and that an inactive item does not appear.

```tsx
expect(screen.getByRole('heading', { name: 'Personal Information' })).toBeInTheDocument()
expect(screen.getByLabelText('First name')).toBeEnabled()
expect(screen.queryByText('Spouse Information')).not.toBeInTheDocument()
```

- [ ] **Step 2: Run renderer tests and verify failure**

Run: `npx vitest run tests/intake-compiled-sections.test.tsx`

Expected: FAIL because compiled renderers do not exist.

- [ ] **Step 3: Implement exhaustive item dispatch**

```tsx
export function CompiledFormItem(props: CompiledFormItemProps) {
  if (props.item.kind === 'field') return <CanonicalFieldItem {...fieldProps(props)} />
  const Block = INTAKE_BLOCK_RENDERERS[props.item.blockId]
  return <Block {...blockProps(props)} />
}
```

No default fallback may silently hide an unknown item; TypeScript exhaustiveness
and compiler validation make unknown items unreachable.

- [ ] **Step 4: Implement section rendering from the shared evaluation**

Use `evaluation.activeSections` for order, completeness, issues, estimates, and
progress. Do not recompute conditions or validation inside React. In staff
read-only mode, pass `disabled` rather than relying only on `pointer-events`.

- [ ] **Step 5: Test keyboard/accessibility behavior**

Verify section toggles are buttons with accessible names, labels remain bound
to fields, disabled staff inputs are actually disabled, and issue containers
use `role="alert"` only when an error exists.

- [ ] **Step 6: Run renderer and primitive tests**

Run: `npx vitest run tests/intake-compiled-sections.test.tsx tests/intake-form-primitives.test.tsx tests/intake-form-validation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the compiled renderer**

```bash
git add components/intake/formEngine tests/intake-compiled-sections.test.tsx
git commit -m "feat: render compiled intake sections"
```

---

### Task 8: Integrate the schema-driven interview with a rollback path

**Files:**
- Rename: `components/intake/GuidedInterview.tsx` to `components/intake/LegacyGuidedInterview.tsx`
- Create: `components/intake/SchemaDrivenGuidedInterview.tsx`
- Create: `components/intake/GuidedInterview.tsx`
- Create: `lib/intake/forms/rendererMode.ts`
- Modify: `app/intake/(shell)/page.tsx`
- Modify: `VERCEL_ENV_CHECKLIST.md`
- Modify: `tests/intake-auth.test.ts`
- Create: `tests/intake-renderer-mode.test.ts`
- Create: `tests/schema-driven-guided-interview.test.tsx`

**Interfaces:**
- Consumes: bundled compiler/evaluator, compiled section renderer, current autosave/contact hooks, current review modal, public token, and attorney mode.
- Produces: unchanged default `<GuidedInterview />` import plus `resolveIntakeRendererMode(env): 'legacy' | 'compiled'` and the server-selected `rendererMode` prop.

- [ ] **Step 1: Write failing renderer-mode tests**

```ts
it.each([
  [undefined, 'legacy'],
  ['', 'legacy'],
  ['legacy', 'legacy'],
  ['compiled', 'compiled'],
  ['nonsense', 'legacy'],
])('maps %s to %s', (raw, expected) => {
  expect(resolveIntakeRendererMode({ INTAKE_RENDERER_MODE: raw })).toBe(expected)
})
```

The fail-safe default is legacy until the final task records full parity.

- [ ] **Step 2: Run mode tests and verify failure**

Run: `npx vitest run tests/intake-renderer-mode.test.ts`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Preserve the legacy component and public exports**

Use `git mv` for the current file. Create a wrapper at the original path that
re-exports `ReviewModal` and dispatches by explicit prop:

```tsx
export default function GuidedInterview(props: GuidedInterviewProps & { rendererMode: IntakeRendererMode }) {
  return props.rendererMode === 'compiled'
    ? <SchemaDrivenGuidedInterview {...props} />
    : <LegacyGuidedInterview {...props} />
}

export { ReviewModal } from './LegacyGuidedInterview'
```

Do not read `process.env` inside a client component.

- [ ] **Step 4: Build `SchemaDrivenGuidedInterview` around existing workflows**

Reuse the current `useAutoSave`, contact hydration/persistence, public-token
headers, session authorization, submit request, attorney-save callback, review
modal, legal/readiness flags, and visual shell. Replace only section discovery,
completion, progress, remaining time, issue lookup, and section rendering with
the compiled form/evaluation.

Before submit, call `flush()`, persist every active dirty block that declares
`persistOnLeave`, re-evaluate the latest `dataRef`, and block only on the
resulting `submissionErrors`.

- [ ] **Step 5: Compile on the server and filter by audience**

In `app/intake/(shell)/page.tsx`, resolve the track from hydrated intake data,
compile the bundled definition for `client`, and fail closed when compilation
fails. The staff audience remains covered at the compiler/component level until
the Phase 3 matter Intake tab mounts it:

```tsx
const rendererMode = resolveIntakeRendererMode(process.env)
const compiled = compileBundledIntakeForm(getIntakeTrack(intakeRow), 'client')
if (!compiled.success) {
  console.error('Invalid bundled intake form', compiled.errors)
  return <p role="alert">This questionnaire is temporarily unavailable. Please contact the firm.</p>
}

return <GuidedInterview {...props} rendererMode={rendererMode} compiledForm={compiled.form} />
```

Do not serialize the unfiltered source definition to the client.

- [ ] **Step 6: Document the temporary server flag**

Add `INTAKE_RENDERER_MODE=legacy|compiled` to `VERCEL_ENV_CHECKLIST.md`, state
that absent/invalid values choose legacy during Phase 1, and state that it is a
temporary rollback control removed only after production acceptance.

- [ ] **Step 7: Test client, public-link, submitted, and attorney flows**

Mock autosave/fetch/session boundaries and assert:

- client editing calls the canonical update key;
- public-token submission sends `X-Intake-Token` and no bearer token;
- authenticated submission sends the bearer token;
- failed flush prevents submission;
- submitted client mode stays locked;
- attorney mode is read-only for client answers;
- staff-only compiled sections never occur in client props;
- leaving a contact-backed section invokes its block persistence.

- [ ] **Step 8: Run integration-focused tests**

Run: `npx vitest run tests/intake-renderer-mode.test.ts tests/schema-driven-guided-interview.test.tsx tests/intake-auth.test.ts tests/intake-auth-form.test.tsx tests/public-intake-start-form.test.tsx tests/intake-save-writes-as-service-role.test.ts tests/intake-route-review-choices.test.ts`

Expected: PASS in both renderer modes.

- [ ] **Step 9: Commit the guarded integration**

```bash
git add components/intake/LegacyGuidedInterview.tsx components/intake/SchemaDrivenGuidedInterview.tsx components/intake/GuidedInterview.tsx lib/intake/forms/rendererMode.ts 'app/intake/(shell)/page.tsx' VERCEL_ENV_CHECKLIST.md tests/intake-auth.test.ts tests/intake-renderer-mode.test.ts tests/schema-driven-guided-interview.test.tsx
git commit -m "feat: add schema driven intake renderer"
```

---

### Task 9: Move shared intake selectors to the compiled engine and verify Phase 1

**Files:**
- Create: `lib/intake/legacySections.ts`
- Modify: `lib/intakeSections.ts`
- Modify: `lib/collegePrepSections.ts`
- Modify: `lib/leads/intakeProgress.ts`
- Modify: `components/intake/LegacyGuidedInterview.tsx`
- Modify: `tests/intake-form-legacy-parity.test.ts`
- Modify: `tests/college-prep-intake.test.ts`
- Modify: `tests/intake-submission-contact-only.test.ts`
- Modify: `docs/superpowers/specs/2026-10-08-intake-form-builder-design.md`

**Interfaces:**
- Consumes: bundled compiled definitions and evaluator.
- Produces: backward-compatible `getActiveSteps`, `getRequiredSteps`, `getStepById`, `getStepIssues`, `getStepErrors`, `getSubmissionErrors`, and `isReadyToReview` backed by the compiled engine for non-legacy callers.

- [ ] **Step 1: Move the frozen implementation behind an explicit legacy module**

Move the old step arrays and switch-based issue functions to
`lib/intake/legacySections.ts`. Update `LegacyGuidedInterview` to import that
module directly. Preserve old exports temporarily for parity tests only.

- [ ] **Step 2: Implement compatibility selectors over compiled definitions**

Keep the existing public signatures so leads, progress displays, and other
callers do not need a flag-day rewrite:

```ts
export function getActiveSteps(data: IntakeRow): IntakeStep[] {
  const result = evaluateBundledIntakeForm(getIntakeTrack(data), 'client', data)
  return result.activeSections.map(toCompatibilityStep)
}

export function getSubmissionErrors(data: IntakeRow): IntakeSectionIssue[] {
  return evaluateBundledIntakeForm(getIntakeTrack(data), 'client', data).submissionErrors
}
```

`toCompatibilityStep(step).isComplete(row)` must re-evaluate that section with
the supplied row; it must not close over the row used to create the step.

- [ ] **Step 3: Run old-versus-new parity across the full fixture matrix**

The test must import legacy capture from `legacySections` and production capture
from `intakeSections`, then compare exact active IDs, required IDs, completion,
issue messages/severity/blocking, and submission errors for every fixture.

Add explicit assertions that contact-only submission remains allowed and that
college-preparation never receives estate validation.

- [ ] **Step 4: Run every intake-focused test**

Run:

```bash
npx vitest run \
  tests/intake-*.test.ts \
  tests/intake-*.test.tsx \
  tests/college-prep-intake.test.ts \
  tests/lead-intake-progress.test.ts \
  tests/lead-intake-contact-progress.test.ts \
  tests/public-intake-start-form.test.tsx \
  tests/admin-intake-sheet-form.test.tsx
```

Expected: PASS. If shell glob expansion includes a non-test path, replace the
expanded command with the explicit failing test paths rather than weakening the
suite.

- [ ] **Step 5: Run repository verification**

Run, in order:

```bash
npm run lint
npm run typecheck
npm test
```

Expected: all commands PASS. If a command fails on an unrelated pre-existing
baseline, run the same command from a clean `origin/main` worktree and record
both outputs before classifying it as non-regression.

- [ ] **Step 6: Perform two manual smoke checks in compiled mode**

With the local Supabase/browser fixture and `INTAKE_RENDERER_MODE=compiled`:

1. Sign in as `client@example.com`, change marital status between single and
   married, verify spouse visibility/data retention, navigate freely, refresh,
   review, and submit.
2. Open a college-preparation intake, verify no estate/spouse/asset/guardian
   sections, exercise FERPA and HIPAA conditions, refresh, review, and submit.

Record the date and outcome in the spec's status section. Do not claim these
checks passed if the local Supabase stack or browser fixture is unavailable.

- [ ] **Step 7: Update the design status without claiming Phase 2**

Change the spec status to `Phase 1 implemented and verified` only after the
automated and manual checks pass. Add the verification commands and state that
the builder database/UI and detailed Phase 3 enhancements remain unimplemented.

- [ ] **Step 8: Commit the compiled selectors and verification record**

```bash
git add lib/intake/legacySections.ts lib/intakeSections.ts lib/collegePrepSections.ts lib/leads/intakeProgress.ts components/intake/LegacyGuidedInterview.tsx tests/intake-form-legacy-parity.test.ts tests/college-prep-intake.test.ts tests/intake-submission-contact-only.test.ts docs/superpowers/specs/2026-10-08-intake-form-builder-design.md
git commit -m "refactor: use compiled intake form definitions"
```

- [ ] **Step 9: Review the branch diff**

Run:

```bash
git status -sb
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: a clean worktree, no whitespace errors, only Phase 1 files, and one
reviewable commit per task. Do not push, open a pull request, deploy, or change
production environment variables without separate user authorization.

## Phase 1 completion boundary

Phase 1 is complete only when both bundled definitions compile, the full parity
matrix matches the legacy implementation, existing intake tests pass, the
compiled client and college-preparation smoke checks are observed, and the
legacy mode remains available for rollback. Completion does not authorize the
Phase 2 Supabase schema, administrative builder, production flag change, Phase
3 matter Intake tab, answer attribution, shared-person enhancements, or asset
enhancements.
