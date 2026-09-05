# Prompt Objects and the Field-Audit Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move prompts into the database with versioning, migrate the existing review playbook into them unchanged, and run one prompt that reads no document — a design-sheet issue spotter whose verified findings become tasks.

**Architecture:** One `runPrompt` with three seams for what genuinely differs by kind: what a unit of work is, what a reference points at, and what a finding becomes. Review supplies (rule × document, quote → text-layer offsets, nothing). Field audit supplies (check × matter, claim → design-sheet field, a task). Input resolution, the model call with tool-forced output, run recording, fail-soft and disposition are shared and kind-blind.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres with RLS, zod, Anthropic SDK with tool-forced output and prompt caching, vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-prompt-engine-field-audit-design.md`

---

## File structure

**`packages/citations/src/`** — kind-agnostic engine pieces, no app imports:
- `prompt/body.ts` (new) — the zod discriminated union for prompt bodies, both arms.
- `prompt/inputs.ts` (new) — source allow-list, `resolveInputs`.
- `fieldAudit/types.ts` (new) — `FieldAuditFinding`, `FieldReference`, `FieldAuditResult`.
- `fieldAudit/verify.ts` (new) — `verifyFieldReference`, the field analogue of `verifyQuote`.
- `fieldAudit/runFieldAudit.ts` (new) — the engine, tool-forced, per-check fail-soft.
- `review/types.ts` (modify) — `reviewPlaybookSchema` re-exported into the body union unchanged.

**`apps/workbench/lib/`** — app wiring, typed Supabase queries:
- `prompts/repository.ts` (new) — read the published version of a prompt by slug.
- `prompts/designSheet.ts` (new) — read a matter's design sheet for input resolution.
- `review/playbook.ts` (modify) — read from the database instead of the bundled JSON.
- `fieldAudit/run.ts` (new) — assemble context, call the engine.
- `fieldAudit/persist.ts` (new) — save a field-audit run, findings and field references.
- `fieldAudit/tasks.ts` (new) — `emitTasks` and superseding.

**`apps/workbench/app/prompts/`** — the new page:
- `page.tsx`, `PromptsWorkspace.tsx`, `actions.ts`.

**Deleted:** `tools/workflows/review/ma-trust-firm-qa.json` and its package export.

---

## Task 1: The prompt body schema

**Files:**
- Create: `packages/citations/src/prompt/body.ts`
- Test: `apps/workbench/tests/prompt-body.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'

const reviewBody = {
  kind: 'review' as const,
  inputs: [],
  rules: [{ number: '1', statement: 'Our exculpation language carves out gross negligence.', risk: 'high' as const }],
}

const auditBody = {
  kind: 'field_audit' as const,
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: true }],
  checks: [
    {
      number: '1',
      statement: 'Every stated concern is answered somewhere in the plan.',
      risk: 'blocker' as const,
      reads: ['concerns', 'goals_notes'],
      taskTemplate: { title: 'Concern unanswered', description: 'Review the design sheet.', priority: 'high' },
    },
  ],
}

describe('the prompt body schema', () => {
  it('accepts a review body unchanged from the playbook shape', () => {
    expect(promptBodySchema.safeParse(reviewBody).success).toBe(true)
  })

  it('accepts a field audit body', () => {
    expect(promptBodySchema.safeParse(auditBody).success).toBe(true)
  })

  it('refuses a field audit body wearing the review kind', () => {
    // The database enforces this with a composite key; the schema is the same
    // rule stated where the author will meet it first.
    const crossed = { ...auditBody, kind: 'review' as const }
    expect(promptBodySchema.safeParse(crossed).success).toBe(false)
  })

  it('refuses a check that reads no fields', () => {
    // A check with no `reads` can produce no verifiable reference, so its
    // findings could never become tasks. Refuse it at authoring time.
    const noReads = { ...auditBody, checks: [{ ...auditBody.checks[0], reads: [] }] }
    expect(promptBodySchema.safeParse(noReads).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/prompt-body.test.ts`
Expected: FAIL — cannot resolve `@aubrey-law/citations/prompt/body`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/citations/src/prompt/body.ts
import { z } from 'zod'
import { reviewRuleSchema } from '../review/types'

/**
 * What a prompt is, in two arms.
 *
 * Discriminated on `kind` rather than validated by convention, because the two
 * bodies have nothing in common beyond their inputs and the database enforces
 * the same split with a composite foreign key. A schema that accepted either
 * shape under either name would leave that constraint as the only thing
 * catching a mistake, and it would catch it at insert time rather than while
 * someone is writing the prompt.
 */
export const promptInputSchema = z.object({
  key: z.string().min(1),
  /** A dotted path checked against the allow-list in ./inputs at publish time. */
  source: z.string().min(1),
  required: z.boolean(),
})

export const fieldAuditCheckSchema = z.object({
  number: z.string().min(1),
  statement: z.string().min(1),
  risk: z.enum(['blocker', 'high', 'medium', 'low']),
  /**
   * The design-sheet fields this check may consult, and the only ones its
   * references may name. A check with none could produce no verifiable
   * reference, so its findings could never become tasks — which makes it a
   * check that cannot act, not a lenient one.
   */
  reads: z.array(z.string().min(1)).min(1),
  taskTemplate: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(['low', 'normal', 'high']),
  }),
})

export const reviewBodySchema = z.object({
  kind: z.literal('review'),
  inputs: z.array(promptInputSchema),
  rules: z.array(reviewRuleSchema).min(1),
})

export const fieldAuditBodySchema = z.object({
  kind: z.literal('field_audit'),
  inputs: z.array(promptInputSchema),
  checks: z.array(fieldAuditCheckSchema).min(1),
})

export const promptBodySchema = z.discriminatedUnion('kind', [
  reviewBodySchema,
  fieldAuditBodySchema,
])

export type PromptKind = z.infer<typeof promptBodySchema>['kind']
export type PromptBody = z.infer<typeof promptBodySchema>
export type FieldAuditBody = z.infer<typeof fieldAuditBodySchema>
export type FieldAuditCheck = z.infer<typeof fieldAuditCheckSchema>
export type PromptInput = z.infer<typeof promptInputSchema>
```

Add the subpath export to `packages/citations/package.json` `exports`:
`"./prompt/body": "./src/prompt/body.ts"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/prompt-body.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/citations/src/prompt/body.ts packages/citations/package.json apps/workbench/tests/prompt-body.test.ts
git commit -m "A prompt body is one of two shapes, told apart by kind"
```

---

## Task 2: Input sources and resolution

**Files:**
- Create: `packages/citations/src/prompt/inputs.ts`
- Test: `apps/workbench/tests/prompt-inputs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { SOURCE_ALLOW_LIST, resolveInputs, unknownSources } from '@aubrey-law/citations/prompt/inputs'

const declarations = [
  { key: 'concerns', source: 'design_sheet.concerns', required: true },
  { key: 'notes', source: 'design_sheet.goals_notes', required: false },
]

describe('resolving a prompt’s declared inputs', () => {
  it('reads each declared source from the row it names', () => {
    const resolved = resolveInputs(declarations, {
      design_sheet: { concerns: 'Provide for my son', goals_notes: null },
      matter: { name: 'Smith Family Trust' },
    })
    expect(resolved).toEqual({ ok: true, values: { concerns: 'Provide for my son', notes: null } })
  })

  it('refuses when a required input has no value, naming the field', () => {
    // A plan reviewed against facts that were not supplied reads exactly like
    // one that was. The run has to stop, and it has to say which field.
    const resolved = resolveInputs(declarations, {
      design_sheet: { concerns: null, goals_notes: 'x' },
      matter: { name: 'Smith Family Trust' },
    })
    expect(resolved).toEqual({ ok: false, missing: ['design_sheet.concerns'] })
  })

  it('names a source that is not on the allow-list', () => {
    expect(unknownSources([{ key: 'x', source: 'design_sheet.not_a_column', required: true }]))
      .toEqual(['design_sheet.not_a_column'])
    expect(unknownSources(declarations)).toEqual([])
  })

  it('allows only columns that exist on the tables it names', () => {
    // Every entry is a real column. This is the assertion that would have
    // caught `matters.title`, and it is checked against the generated types
    // in tests/query-columns.test.ts rather than against this list.
    for (const path of Object.keys(SOURCE_ALLOW_LIST)) {
      expect(path).toMatch(/^(design_sheet|matter)\.[a-z_]+$/)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/prompt-inputs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/citations/src/prompt/inputs.ts
import type { PromptInput } from './body'

/**
 * Every source a prompt may declare, and the column behind it.
 *
 * An allow-list rather than a dotted-path evaluator, because the alternative is
 * letting prompt content name any column in the database and reading whatever
 * it asks for. Prompt bodies will eventually be authored in a screen; the set
 * of facts a prompt can see is not something an author should be able to widen
 * by typing.
 *
 * Checked at publish time, not run time — see `unknownSources`.
 */
export const SOURCE_ALLOW_LIST: Record<string, { table: 'design_sheet' | 'matter'; column: string }> = {
  'design_sheet.concerns': { table: 'design_sheet', column: 'concerns' },
  'design_sheet.goals_notes': { table: 'design_sheet', column: 'goals_notes' },
  'design_sheet.drafting_notes': { table: 'design_sheet', column: 'drafting_notes' },
  'design_sheet.children': { table: 'design_sheet', column: 'children' },
  'design_sheet.assets': { table: 'design_sheet', column: 'assets' },
  'design_sheet.specific_bequests': { table: 'design_sheet', column: 'specific_bequests' },
  'design_sheet.disinheritances': { table: 'design_sheet', column: 'disinheritances' },
  'design_sheet.residuary_beneficiary': { table: 'design_sheet', column: 'residuary_beneficiary' },
  'design_sheet.residual_beneficiary_individuals': { table: 'design_sheet', column: 'residual_beneficiary_individuals' },
  'design_sheet.residuary_distribution': { table: 'design_sheet', column: 'residuary_distribution' },
  'design_sheet.spouse_citizenship': { table: 'design_sheet', column: 'spouse_citizenship' },
  'design_sheet.include_qdot': { table: 'design_sheet', column: 'include_qdot' },
  'design_sheet.marital_trust_type': { table: 'design_sheet', column: 'marital_trust_type' },
  'design_sheet.real_property_transfer': { table: 'design_sheet', column: 'real_property_transfer' },
  'design_sheet.state': { table: 'design_sheet', column: 'state' },
  'design_sheet.client_domicile': { table: 'design_sheet', column: 'client_domicile' },
  'design_sheet.marital_status': { table: 'design_sheet', column: 'marital_status' },
  'design_sheet.trust_name': { table: 'design_sheet', column: 'trust_name' },
  'design_sheet.plan_type': { table: 'design_sheet', column: 'plan_type' },
  'matter.name': { table: 'matter', column: 'name' },
}

export type SourceRows = {
  design_sheet: Record<string, unknown>
  matter: Record<string, unknown>
}

export type ResolvedInputs =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; missing: string[] }

/** Declared sources with no entry in the allow-list. Empty means publishable. */
export function unknownSources(declarations: PromptInput[]): string[] {
  return declarations.map(d => d.source).filter(source => !(source in SOURCE_ALLOW_LIST))
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Declared inputs, read from rows already fetched.
 *
 * Pure, with the rows passed in, following the split that has kept TS2589 out
 * of lib/auth/session.ts: the policy is a function of data, and the typed query
 * lives at the call site.
 */
export function resolveInputs(declarations: PromptInput[], rows: SourceRows): ResolvedInputs {
  const values: Record<string, unknown> = {}
  const missing: string[] = []

  for (const declaration of declarations) {
    const entry = SOURCE_ALLOW_LIST[declaration.source]
    if (!entry) {
      missing.push(declaration.source)
      continue
    }
    const value = rows[entry.table]?.[entry.column] ?? null
    if (declaration.required && isEmpty(value)) {
      missing.push(declaration.source)
      continue
    }
    values[declaration.key] = value ?? null
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, values }
}
```

Add to `packages/citations/package.json` exports: `"./prompt/inputs": "./src/prompt/inputs.ts"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/prompt-inputs.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the allow-list names real columns**

Add to `apps/workbench/tests/prompt-inputs.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'

it('names only columns the generated types actually have', () => {
  // The matters.title lesson: a list of column names is an assumption until
  // something compares it to the schema.
  const generated = fs.readFileSync(
    path.resolve(__dirname, '../../../packages/db-types/src/supabase.generated.ts'),
    'utf8',
  )
  const rowBlock = (table: string) =>
    generated.slice(generated.indexOf(`      ${table}: {`)).split('        }')[0]
  const designSheet = rowBlock('design_sheets')
  const matters = rowBlock('matters')

  for (const [pathName, entry] of Object.entries(SOURCE_ALLOW_LIST)) {
    const block = entry.table === 'design_sheet' ? designSheet : matters
    expect(block, `${pathName} names a column that does not exist`).toContain(`\n          ${entry.column}:`)
  }
})
```

Run: `cd apps/workbench && npx vitest run tests/prompt-inputs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/citations/src/prompt/inputs.ts packages/citations/package.json apps/workbench/tests/prompt-inputs.test.ts
git commit -m "A prompt may read only the facts the allow-list names"
```

---

## Task 3: Verifying a field reference

**Files:**
- Create: `packages/citations/src/fieldAudit/types.ts`, `packages/citations/src/fieldAudit/verify.ts`
- Test: `apps/workbench/tests/field-reference-verify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { verifyFieldReference } from '@aubrey-law/citations/fieldAudit/verify'

const values = {
  concerns: 'Make sure my son Daniel is provided for',
  spouse_citizenship: 'Green card holder',
  include_qdot: null,
}

describe('verifying what a check claimed a field says', () => {
  it('verifies a claim that matches the field', () => {
    const result = verifyFieldReference(values, ['concerns'], {
      fieldKey: 'concerns',
      claimedValue: 'Make sure my son Daniel is provided for',
    })
    expect(result).toEqual({
      fieldKey: 'concerns',
      claimedValue: 'Make sure my son Daniel is provided for',
      actualValue: 'Make sure my son Daniel is provided for',
      verification: 'verified',
    })
  })

  it('verifies despite whitespace and case, which are not the claim', () => {
    const result = verifyFieldReference(values, ['spouse_citizenship'], {
      fieldKey: 'spouse_citizenship',
      claimedValue: '  green card HOLDER ',
    })
    expect(result.verification).toBe('verified')
  })

  it('refuses a claim the field does not support, and keeps what the field says', () => {
    // The analogue of attemptedQuote: the rate at which claims survive is the
    // measure, and it cannot be measured without recording the near miss.
    const result = verifyFieldReference(values, ['concerns'], {
      fieldKey: 'concerns',
      claimedValue: 'Make sure my daughter Danielle is provided for',
    })
    expect(result.verification).toBe('unverified')
    expect(result.actualValue).toBe('Make sure my son Daniel is provided for')
  })

  it('refuses a reference to a field the check was not allowed to read', () => {
    // `reads` is the check's declared scope. A reference outside it is a
    // finding resting on something nobody authorised it to consult.
    const result = verifyFieldReference(values, ['concerns'], {
      fieldKey: 'spouse_citizenship',
      claimedValue: 'Green card holder',
    })
    expect(result.verification).toBe('unverified')
    expect(result.actualValue).toBeNull()
  })

  it('verifies a claim of emptiness against an empty field', () => {
    // Absence is the finding this check set exists to catch, so "this field is
    // empty" has to be a claim that can be verified rather than one that
    // always fails for want of anything to match.
    const result = verifyFieldReference(values, ['include_qdot'], {
      fieldKey: 'include_qdot',
      claimedValue: null,
    })
    expect(result.verification).toBe('verified')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/field-reference-verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/citations/src/fieldAudit/types.ts
export type FieldVerification = 'verified' | 'unverified' | 'stale'

export interface FieldReferenceClaim {
  fieldKey: string
  /** What the model says the field holds. Null claims the field is empty. */
  claimedValue: string | null
}

export interface FieldReference extends FieldReferenceClaim {
  /** What the field actually holds. Null when the field was out of scope. */
  actualValue: string | null
  verification: FieldVerification
}

export type FieldAuditOutcome = 'compliant' | 'deviation' | 'absent' | 'not_applicable'

export interface FieldAuditFinding {
  checkNumber: string
  outcome: FieldAuditOutcome
  severity: 'blocker' | 'high' | 'medium' | 'low' | null
  rationale: string
  references: FieldReference[]
}

export interface FieldAuditResult {
  promptSlug: string
  promptVersion: number
  findings: FieldAuditFinding[]
  failures: Array<{ checkNumber: string; reason: string }>
}
```

```ts
// packages/citations/src/fieldAudit/verify.ts
import type { FieldReference, FieldReferenceClaim } from './types'

/** Whitespace and case are presentation, not substance. Nothing else is folded. */
function normalise(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Checks one claim about one field against what the field holds.
 *
 * The field analogue of `verifyQuote`, and it follows the same rule: what the
 * model produced is a *claim* until this function finds it in the source. The
 * difference is only in what the source is.
 *
 * A reference outside the check's declared `reads` fails without being
 * compared. The scope is part of the check, and a finding resting on a field
 * nobody authorised it to read is not better for happening to be right.
 */
export function verifyFieldReference(
  values: Record<string, unknown>,
  reads: string[],
  claim: FieldReferenceClaim,
): FieldReference {
  if (!reads.includes(claim.fieldKey)) {
    return { ...claim, actualValue: null, verification: 'unverified' }
  }

  const actual = values[claim.fieldKey] ?? null
  const actualText = actual === null ? null : typeof actual === 'string' ? actual : JSON.stringify(actual)
  const matches = normalise(actual) === normalise(claim.claimedValue)

  return {
    ...claim,
    actualValue: actualText,
    verification: matches ? 'verified' : 'unverified',
  }
}
```

Add exports: `"./fieldAudit/types"` and `"./fieldAudit/verify"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/field-reference-verify.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/citations/src/fieldAudit packages/citations/package.json apps/workbench/tests/field-reference-verify.test.ts
git commit -m "A claim about a field is checked against the field"
```

---

## Task 4: The migration

**Files:**
- Create: `supabase/migrations/20261028000000_prompt_objects.sql`
- Test: `apps/workbench/tests/prompt-schema.test.ts`

- [ ] **Step 1: Verify the assumption the migration rests on**

The spec assumes `workflow_runs` is empty, which makes dropping `playbook_slug` free.
Migration history is not evidence — read the table.

Run, with the workbench `.env.local` present:

```bash
node -e "
const fs=require('fs');
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^[\"']|[\"']\$/g,'');}
const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(u+'/rest/v1/workflow_runs?select=id',{headers:{apikey:k,Authorization:'Bearer '+k,Prefer:'count=exact'}})
  .then(r=>console.log('workflow_runs rows:',r.headers.get('content-range')));
"
```

Expected: `*/0`. **If it is not zero, stop and add a backfill step** — `prompt_version_id`
is resolved from `playbook_slug` + `playbook_version` before the columns are dropped.

- [ ] **Step 2: Write the failing test**

```ts
// apps/workbench/tests/prompt-schema.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261028000000_prompt_objects.sql'),
  'utf8',
)

describe('the prompt object migration', () => {
  it('makes a version immutable and hash-checked', () => {
    expect(sql).toMatch(/content_hash text not null check \(content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  })

  it('stops a review prompt taking a field-audit body', () => {
    // The composite key is the whole point of the idiom: the kind travels with
    // the foreign key, so the pairing is the database's problem, not care's.
    expect(sql).toMatch(/foreign key \(prompt_id, kind\)[\s\n]*references public\.prompts\(id, kind\)/)
  })

  it('allows exactly one published version per prompt', () => {
    expect(sql).toMatch(/create table if not exists public\.prompt_publications \([\s\S]*prompt_id uuid primary key/)
  })

  it('still requires a document for a review run, and not for anything else', () => {
    expect(sql).toMatch(/kind <> 'review' or \(document_version_id is not null and text_layer_id is not null\)/)
  })

  it('drops the columns the foreign key replaces', () => {
    expect(sql).toContain('drop column if exists playbook_slug')
    expect(sql).toContain('drop column if exists playbook_version')
  })

  it('protects every new table with row level security', () => {
    for (const table of ['prompts', 'prompt_versions', 'prompt_publications', 'workflow_field_references']) {
      expect(sql, `${table} has no RLS`).toContain(`alter table public.${table} enable row level security`)
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/prompt-schema.test.ts`
Expected: FAIL — ENOENT, the migration does not exist.

- [ ] **Step 4: Write the migration**

```sql
-- Prompts become objects, and a run stops assuming a document.
--
-- The review path put its rules in a bundled JSON file, which was right while
-- there was one playbook and wrong the moment there were two kinds. This is the
-- clause library's immutability idiom applied to prompts: a subject, immutable
-- versions carrying a content hash, and a publication pointer that says which
-- version is current.
--
-- The composite foreign key is the load-bearing part. `kind` travels with the
-- key, so a review prompt cannot acquire a field-audit body — not by convention
-- but because the reference will not resolve.

create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  kind text not null check (kind = any (array['review', 'field_audit'])),

  -- Which matters this prompt is offered for, and at which stage. Empty means
  -- "any": a prompt nobody has scoped is still usable, just not filtered.
  stages text[] not null default '{}',
  matter_types text[] not null default '{}',

  is_system boolean not null default false,
  created_at timestamptz not null default now(),

  -- The composite target. Redundant against the primary key alone, and there
  -- so a child row can reference the pair.
  unique (id, kind)
);

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  kind text not null check (kind = any (array['review', 'field_audit'])),

  version_number integer not null check (version_number > 0),
  body jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  change_summary text,
  validation_status text not null default 'valid'
    check (validation_status = any (array['valid', 'invalid'])),

  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,

  unique (prompt_id, version_number),
  -- The pairing a plain prompt_id reference would not enforce.
  foreign key (prompt_id, kind) references public.prompts(id, kind),
  -- The composite target for the publication pointer below.
  unique (id, prompt_id)
);

create table if not exists public.prompt_publications (
  -- Primary key, not merely unique: one current version per prompt, by shape.
  prompt_id uuid primary key references public.prompts(id) on delete cascade,
  version_id uuid not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.users(id) on delete set null,

  foreign key (version_id, prompt_id)
    references public.prompt_versions(id, prompt_id) on delete restrict
);

-- A run is no longer only a review.
alter table public.workflow_runs
  add column if not exists prompt_version_id uuid references public.prompt_versions(id),
  add column if not exists kind text not null default 'review'
    check (kind = any (array['review', 'field_audit']));

-- A field audit reads no document. A review still must have one, and the
-- constraint has to be checkable on the row, which is why `kind` is carried
-- here rather than joined for.
alter table public.workflow_runs
  alter column document_version_id drop not null;

alter table public.workflow_runs
  drop constraint if exists workflow_runs_review_needs_document;

alter table public.workflow_runs
  add constraint workflow_runs_review_needs_document
  check (kind <> 'review' or (document_version_id is not null and text_layer_id is not null));

-- Replaced by prompt_version_id. Safe because the table is empty; if it is
-- not, backfill before this migration runs.
alter table public.workflow_runs drop column if exists playbook_slug;
alter table public.workflow_runs drop column if exists playbook_version;

-- The evidence behind a field-audit finding, kept separate from citations
-- because the check is different: a citation is offsets into a text layer, a
-- field reference is a value in a row. One table would be half-null in every
-- row and would describe neither check well.
create table if not exists public.workflow_field_references (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.workflow_findings(id) on delete cascade,

  field_key text not null,
  claimed_value text,
  actual_value text,
  verification text not null
    check (verification = any (array['verified', 'unverified', 'stale'])),

  created_at timestamptz not null default now()
);

create index if not exists workflow_field_references_finding_idx
  on public.workflow_field_references(finding_id);

alter table public.prompts enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.prompt_publications enable row level security;
alter table public.workflow_field_references enable row level security;

create policy "Staff read prompts" on public.prompts
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = any (array['admin', 'staff'])));

create policy "Staff read prompt versions" on public.prompt_versions
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = any (array['admin', 'staff'])));

create policy "Staff read prompt publications" on public.prompt_publications
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = any (array['admin', 'staff'])));

create policy "Staff read field references" on public.workflow_field_references
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = any (array['admin', 'staff'])));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/prompt-schema.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Apply the migration and confirm the objects exist**

Migration history can record a migration whose SQL never ran. Check for the objects.

```bash
npx supabase db push
```

Then verify against PostgREST:

```bash
node scripts/checkDbColumns.mjs
```

Expected: the column check passes. Then confirm the four tables are exposed by re-running
the OpenAPI probe from Task 4 Step 1 against `prompts`, `prompt_versions`,
`prompt_publications` and `workflow_field_references`. Each must report a column count,
not `ABSENT`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261028000000_prompt_objects.sql apps/workbench/tests/prompt-schema.test.ts
git commit -m "Prompts become versioned objects, and a run stops assuming a document"
```

---

## Task 5: Reading a published prompt

**Files:**
- Create: `apps/workbench/lib/prompts/repository.ts`
- Test: `apps/workbench/tests/prompt-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { toPublishedPrompt } from '@/lib/prompts/repository'

const row = {
  id: 'v1',
  version_number: 3,
  body: { kind: 'review', inputs: [], rules: [{ number: '1', statement: 'A rule.', risk: 'high' }] },
  prompts: { slug: 'ma-trust-firm-qa', title: 'Firm QA', kind: 'review' },
}

describe('turning a published version row into a prompt', () => {
  it('parses the body against the schema', () => {
    const prompt = toPublishedPrompt(row)
    expect(prompt).toEqual({
      versionId: 'v1',
      versionNumber: 3,
      slug: 'ma-trust-firm-qa',
      title: 'Firm QA',
      body: row.body,
    })
  })

  it('throws when the stored body does not match its declared kind', () => {
    // A body that drifted out of schema would otherwise surface as a run that
    // quietly skipped a rule — the failure this product cannot have.
    const crossed = { ...row, body: { kind: 'review', inputs: [], checks: [] } }
    expect(() => toPublishedPrompt(crossed)).toThrow(/does not match/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/prompt-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/workbench/lib/prompts/repository.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { promptBodySchema, type PromptBody } from '@aubrey-law/citations/prompt/body'

export interface PublishedPrompt {
  versionId: string
  versionNumber: number
  slug: string
  title: string
  body: PromptBody
}

/**
 * Pure half: a row in, a validated prompt out.
 *
 * Validation happens on read as well as on publish. The body is jsonb, so
 * nothing in the database stops a hand-run UPDATE from putting the wrong shape
 * in a published row, and a prompt that silently skipped a rule is the failure
 * this product cannot have.
 */
export function toPublishedPrompt(row: {
  id: string
  version_number: number
  body: unknown
  prompts: { slug: string; title: string; kind: string } | null
}): PublishedPrompt {
  const parsed = promptBodySchema.safeParse(row.body)
  if (!parsed.success) {
    throw new Error(
      `Published prompt ${row.prompts?.slug ?? row.id} does not match the expected shape: ${parsed.error.message}`,
    )
  }
  if (row.prompts && parsed.data.kind !== row.prompts.kind) {
    throw new Error(
      `Published prompt ${row.prompts.slug} does not match: declared ${row.prompts.kind}, body is ${parsed.data.kind}`,
    )
  }
  return {
    versionId: row.id,
    versionNumber: row.version_number,
    slug: row.prompts?.slug ?? '',
    title: row.prompts?.title ?? '',
    body: parsed.data,
  }
}

/** The currently published version of one prompt, by slug. */
export async function loadPublishedPrompt(
  client: SupabaseClient<WorkbenchDatabase>,
  slug: string,
): Promise<PublishedPrompt | null> {
  const { data: prompt, error: promptError } = await client
    .from('prompts')
    .select('id, slug, title, kind')
    .eq('slug', slug)
    .maybeSingle()
  if (promptError) throw new Error(`Could not load prompt ${slug}: ${promptError.message}`)
  if (!prompt) return null

  const { data: publication, error: publicationError } = await client
    .from('prompt_publications')
    .select('version_id')
    .eq('prompt_id', prompt.id)
    .maybeSingle()
  if (publicationError) throw new Error(`Could not load the published version of ${slug}: ${publicationError.message}`)
  if (!publication) return null

  const { data: version, error: versionError } = await client
    .from('prompt_versions')
    .select('id, version_number, body')
    .eq('id', publication.version_id)
    .maybeSingle()
  if (versionError) throw new Error(`Could not load version for ${slug}: ${versionError.message}`)
  if (!version) return null

  return toPublishedPrompt({ ...version, prompts: prompt })
}

/** Every published prompt, for the picker. */
export async function loadPublishedPrompts(
  client: SupabaseClient<WorkbenchDatabase>,
): Promise<PublishedPrompt[]> {
  const { data: prompts, error } = await client
    .from('prompts')
    .select('id, slug, title, kind')
  if (error) throw new Error(`Could not load prompts: ${error.message}`)
  if (!prompts || prompts.length === 0) return []

  const loaded = await Promise.all(prompts.map(p => loadPublishedPrompt(client, p.slug)))
  return loaded.filter((p): p is PublishedPrompt => p !== null)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/prompt-repository.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/workbench/lib/prompts/repository.ts apps/workbench/tests/prompt-repository.test.ts
git commit -m "Read the published version of a prompt from the database"
```

---

## Task 6: Move the review playbook into the database

**Files:**
- Create: `supabase/migrations/20261028010000_seed_review_playbook.sql`
- Modify: `apps/workbench/lib/review/playbook.ts`, `apps/workbench/app/review/page.tsx`
- Delete: `tools/workflows/review/ma-trust-firm-qa.json` and its `package.json` export
- Test: `apps/workbench/tests/review-playbook.test.ts` (existing, rewritten)

- [ ] **Step 1: Compute the content hash of the playbook as it stands**

```bash
node -e "
const c=require('crypto'), fs=require('fs');
const json=JSON.parse(fs.readFileSync('tools/workflows/review/ma-trust-firm-qa.json','utf8'));
const body={kind:'review',inputs:[],rules:json.rules};
console.log(c.createHash('sha256').update(JSON.stringify(body)).digest('hex'));
"
```

Record the hash. It goes into the seed migration and into the test in Step 3.

- [ ] **Step 2: Write the seed migration**

Substitute the recorded hash for `<HASH>` and the playbook's rules for `<RULES>`
(the `rules` array from the JSON, verbatim).

```sql
-- The one playbook that exists, moved out of the bundle.
--
-- Inserted rather than left as a file because the prompt object has to hold
-- both kinds to be worth having, and a review that still read a JSON import
-- would leave that claim untested with two sources of truth for what a prompt
-- is. The body is the file's `rules` array unchanged, so every phase 3 result
-- stays valid — a test asserts the hash below against the file's content at
-- migration time.

insert into public.prompts (slug, title, kind, matter_types, is_system)
values ('ma-trust-firm-qa', 'Massachusetts revocable trust — firm quality review', 'review', '{}', true)
on conflict (slug) do nothing;

insert into public.prompt_versions (prompt_id, kind, version_number, body, content_hash, change_summary)
select p.id, 'review', 1,
  jsonb_build_object('kind', 'review', 'inputs', '[]'::jsonb, 'rules', '<RULES>'::jsonb),
  '<HASH>',
  'Moved from tools/workflows/review/ma-trust-firm-qa.json, unchanged.'
from public.prompts p where p.slug = 'ma-trust-firm-qa'
on conflict (prompt_id, version_number) do nothing;

insert into public.prompt_publications (prompt_id, version_id)
select v.prompt_id, v.id
from public.prompt_versions v
join public.prompts p on p.id = v.prompt_id
where p.slug = 'ma-trust-firm-qa' and v.version_number = 1
on conflict (prompt_id) do nothing;
```

- [ ] **Step 3: Rewrite the playbook test**

Replace `apps/workbench/tests/review-playbook.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'
import { toPublishedPrompt } from '@/lib/prompts/repository'
import fs from 'node:fs'
import path from 'node:path'

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261028010000_seed_review_playbook.sql'),
  'utf8',
)

describe('the review playbook, now a published prompt', () => {
  it('is seeded as a published review prompt', () => {
    expect(migration).toContain("'ma-trust-firm-qa'")
    expect(migration).toContain('insert into public.prompt_publications')
  })

  it('carries a body that parses as a review', () => {
    const body = JSON.parse(
      migration.slice(migration.indexOf("'[") + 1, migration.indexOf("]'::jsonb") + 1),
    )
    const parsed = promptBodySchema.safeParse({ kind: 'review', inputs: [], rules: body })
    expect(parsed.success).toBe(true)
  })

  it('states a content hash that matches the body it seeds', () => {
    // The hash cannot be compared against the JSON file, because this task
    // deletes it — that is the point of the task. So it is checked against the
    // body actually seeded, which is what the hash is for: proving later that
    // a published version is the one that was reviewed.
    const rules = JSON.parse(
      migration.slice(migration.indexOf("'[") + 1, migration.indexOf("]'::jsonb") + 1),
    )
    const stated = migration.match(/'([0-9a-f]{64})'/)?.[1]
    const computed = createHash('sha256')
      .update(JSON.stringify({ kind: 'review', inputs: [], rules }))
      .digest('hex')
    expect(stated).toBe(computed)
  })

  it('rejects a published row whose body contradicts its kind', () => {
    expect(() =>
      toPublishedPrompt({
        id: 'v', version_number: 1,
        body: { kind: 'field_audit', inputs: [], checks: [{ number: '1', statement: 's', risk: 'low', reads: ['a'], taskTemplate: { title: 't', description: 'd', priority: 'normal' } }] },
        prompts: { slug: 'ma-trust-firm-qa', title: 'x', kind: 'review' },
      }),
    ).toThrow(/does not match/)
  })
})
```

- [ ] **Step 4: Point the review at the database**

Replace `apps/workbench/lib/review/playbook.ts` entirely:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import type { ReviewPlaybook } from '@aubrey-law/citations/review/types'

/**
 * The playbook, read from the published prompt rather than from a bundle.
 *
 * It used to be a module import — deliberately, because an `fs.readFileSync`
 * is invisible to Next's bundle tracing and threw ENOENT in production after
 * building and deploying clean. The database has neither problem, and it is
 * where a prompt library has to live once there is more than one prompt and
 * more than one kind.
 */
export const REVIEW_PLAYBOOK_SLUG = 'ma-trust-firm-qa'

export async function loadReviewPlaybook(
  client: SupabaseClient<WorkbenchDatabase>,
): Promise<ReviewPlaybook> {
  const prompt = await loadPublishedPrompt(client, REVIEW_PLAYBOOK_SLUG)
  if (!prompt) {
    throw new Error(
      `No published prompt with slug ${REVIEW_PLAYBOOK_SLUG}. The review cannot run without one.`,
    )
  }
  if (prompt.body.kind !== 'review') {
    throw new Error(`Prompt ${REVIEW_PLAYBOOK_SLUG} is a ${prompt.body.kind}, not a review.`)
  }
  return {
    slug: prompt.slug,
    title: prompt.title,
    version: prompt.versionNumber,
    rules: prompt.body.rules,
  }
}
```

Update `apps/workbench/app/review/page.tsx` line 22 from
`const playbook = loadReviewPlaybook()` to
`const playbook = await loadReviewPlaybook(getAdminClient())`, and update the other
call site found by:

```bash
grep -rn "loadReviewPlaybook" apps/workbench --include="*.ts*" | grep -v "\.test\."
```

- [ ] **Step 5: Delete the file and its export**

```bash
git rm tools/workflows/review/ma-trust-firm-qa.json
```

Remove the `"./review/ma-trust-firm-qa.json"` entry from
`tools/workflows/package.json` `exports`.

- [ ] **Step 6: Run the full workbench suite**

Run: `cd apps/workbench && npm run verify`
Expected: PASS. Any test still importing the JSON fails here and is updated to read
from a stubbed client.

- [ ] **Step 7: Apply and verify against the real database**

```bash
npx supabase db push
```

Then confirm the review still loads its rules:

```bash
node -e "
const fs=require('fs');
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^[\"']|[\"']\$/g,'');}
const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(u+'/rest/v1/prompt_versions?select=version_number,content_hash,body',{headers:{apikey:k,Authorization:'Bearer '+k}})
  .then(r=>r.json()).then(v=>console.log('rules:',v[0]?.body?.rules?.length,'hash:',v[0]?.content_hash));
"
```

Expected: the rule count matches the JSON that was deleted.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "The review reads its playbook from the database, not the bundle"
```

---

## Task 7: The field-audit engine

**Files:**
- Create: `packages/citations/src/fieldAudit/runFieldAudit.ts`
- Test: `apps/workbench/tests/field-audit-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { runFieldAudit, FIELD_AUDIT_TOOL_NAME } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditBody } from '@aubrey-law/citations/prompt/body'

const body: FieldAuditBody = {
  kind: 'field_audit',
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: true }],
  checks: [
    {
      number: '1',
      statement: 'Every stated concern is answered somewhere in the plan.',
      risk: 'blocker',
      reads: ['concerns', 'residuary_beneficiary'],
      taskTemplate: { title: 'Concern unanswered', description: 'Check the design sheet.', priority: 'high' },
    },
  ],
}

const values = { concerns: 'Provide for my son Daniel', residuary_beneficiary: 'Spouse' }

const reply = (input: unknown) => ({
  content: [{ type: 'tool_use', name: FIELD_AUDIT_TOOL_NAME, input }],
}) as never

describe('running a field audit', () => {
  it('keeps a finding whose references check out', async () => {
    const result = await runFieldAudit(
      { promptSlug: 'p', promptVersion: 1, values },
      body,
      {
        callModel: async () => reply({
          outcome: 'deviation',
          rationale: 'Daniel is named as a concern but the residuary runs to the spouse alone.',
          references: [{ field_key: 'concerns', claimed_value: 'Provide for my son Daniel' }],
        }),
      },
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].references[0].verification).toBe('verified')
    expect(result.findings[0].severity).toBe('blocker')
  })

  it('keeps the finding but marks the reference when the claim is wrong', async () => {
    const result = await runFieldAudit(
      { promptSlug: 'p', promptVersion: 1, values },
      body,
      {
        callModel: async () => reply({
          outcome: 'deviation',
          rationale: 'x',
          references: [{ field_key: 'concerns', claimed_value: 'Provide for my daughter' }],
        }),
      },
    )
    expect(result.findings[0].references[0].verification).toBe('unverified')
    expect(result.findings[0].references[0].actualValue).toBe('Provide for my son Daniel')
  })

  it('survives one check throwing, and says which', async () => {
    // Per-check fail-soft, the same rule the review follows: one check losing
    // its call must not cost the audit, and a check that never ran is not a
    // check that found nothing.
    const result = await runFieldAudit(
      { promptSlug: 'p', promptVersion: 1, values },
      body,
      { callModel: async () => { throw new Error('network') } },
    )
    expect(result.findings).toHaveLength(0)
    expect(result.failures).toEqual([{ checkNumber: '1', reason: 'network' }])
  })

  it('carries no severity when the check found nothing', async () => {
    const result = await runFieldAudit(
      { promptSlug: 'p', promptVersion: 1, values },
      body,
      { callModel: async () => reply({ outcome: 'compliant', rationale: 'Answered.', references: [] }) },
    )
    expect(result.findings[0].severity).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/field-audit-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/citations/src/fieldAudit/runFieldAudit.ts
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import type { FieldAuditBody, FieldAuditCheck } from '../prompt/body'
import type { ModelCaller, ModelRequest, ModelResponse } from '../review/model'
import type { FieldAuditFinding, FieldAuditResult, FieldAuditOutcome } from './types'
import { verifyFieldReference } from './verify'

export const FIELD_AUDIT_TOOL_NAME = 'report_check'

export const FIELD_AUDIT_TOOL = {
  name: FIELD_AUDIT_TOOL_NAME,
  description: 'Report the conclusion for exactly one check against this matter’s design sheet.',
  input_schema: {
    type: 'object' as const,
    properties: {
      outcome: {
        type: 'string',
        enum: ['compliant', 'deviation', 'absent', 'not_applicable'],
        description:
          'compliant: the design sheet satisfies the check. deviation: it addresses the point but not acceptably. absent: it is silent where the check requires an answer. not_applicable: the check does not bear on this matter.',
      },
      rationale: {
        type: 'string',
        description: 'One or two sentences. Say what the design sheet records, not what it should record.',
      },
      references: {
        type: 'array',
        description:
          'The fields this conclusion rests on. Copy each value exactly as it appears. A reference whose value does not match the field is discarded and your finding loses its support.',
        items: {
          type: 'object',
          properties: {
            field_key: { type: 'string' },
            claimed_value: { type: ['string', 'null'] },
          },
          required: ['field_key', 'claimed_value'],
          additionalProperties: false,
        },
      },
    },
    required: ['outcome', 'rationale', 'references'],
    additionalProperties: false,
  },
}

const SYSTEM_INSTRUCTIONS = `
You are checking one matter's design sheet against one firm position at a time.

Rules for every answer:
- Quote field values exactly. Copy the characters as they appear; do not tidy
  punctuation, summarise, or paraphrase. A value that does not match the field
  is discarded and your finding loses its support.
- Reference only the fields the check lists. A conclusion resting on anything
  else cannot be checked and will be dropped.
- Report what the design sheet records, not what you would prefer it recorded.
- If the sheet is silent on a point the check requires, the outcome is "absent".
  Say so rather than referencing something adjacent.
- Do not report a problem you cannot reference. An unsupported finding is worse
  than a missed one.

${PROMPT_INJECTION_GUARDRAIL}
`.trim()

export interface FieldAuditContext {
  promptSlug: string
  promptVersion: number
  values: Record<string, unknown>
  matterId?: string | null
  userId?: string | null
}

export interface RunFieldAuditDependencies {
  callModel: ModelCaller
  model?: string
}

function sheetForPrompt(values: Record<string, unknown>): string {
  const lines = Object.entries(values).map(
    ([key, value]) => `[${key}] ${value === null || value === undefined ? '(empty)' : typeof value === 'string' ? value : JSON.stringify(value)}`,
  )
  return quoteUserContent('design_sheet', lines.join('\n\n'))
}

function checkMessage(check: FieldAuditCheck): string {
  return [
    `Check ${check.number}: ${check.statement}`,
    '',
    `Fields you may reference: ${check.reads.join(', ')}`,
    '',
    `Report your conclusion for this check only, using the ${FIELD_AUDIT_TOOL_NAME} tool.`,
  ].join('\n')
}

function readToolInput(response: ModelResponse): Record<string, unknown> | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === FIELD_AUDIT_TOOL_NAME) {
      return block.input as Record<string, unknown>
    }
  }
  return null
}

/**
 * Runs one field-audit prompt against one matter's resolved inputs.
 *
 * The same shape as `runReviewPlaybook`, and deliberately so: one call per
 * check against a cached prefix, per-check fail-soft, and every claim verified
 * against its source before it counts. What differs is only what the source is
 * — a row rather than a text layer — which is the seam this slice exists to
 * find out is real.
 *
 * Written as its own loop here and rewritten as an adapter over `runPrompt` in
 * Task 7b. Building the second engine before extracting the shared one is the
 * order on purpose: an abstraction taken from two working examples is
 * discovered, one designed before the second exists is guessed.
 */
export async function runFieldAudit(
  context: FieldAuditContext,
  body: FieldAuditBody,
  deps: RunFieldAuditDependencies,
): Promise<FieldAuditResult> {
  const model = deps.model ?? 'claude-sonnet-5'
  const sheet = sheetForPrompt(context.values)

  const findings: FieldAuditFinding[] = []
  const failures: FieldAuditResult['failures'] = []

  for (const check of body.checks) {
    let input: Record<string, unknown> | null
    try {
      const response = await deps.callModel(
        {
          model,
          max_tokens: 1024,
          system: [
            { type: 'text', text: SYSTEM_INSTRUCTIONS },
            { type: 'text', text: sheet, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: checkMessage(check) }],
          tools: [FIELD_AUDIT_TOOL],
          tool_choice: { type: 'tool', name: FIELD_AUDIT_TOOL_NAME },
        } as ModelRequest,
        {
          route: 'prompt/field-audit',
          matterId: context.matterId ?? null,
          userId: context.userId ?? null,
          contextType: 'matter',
        },
      )
      input = readToolInput(response)
    } catch (error) {
      failures.push({ checkNumber: check.number, reason: (error as Error).message })
      continue
    }

    if (!input) {
      failures.push({ checkNumber: check.number, reason: 'Model returned no tool call' })
      continue
    }

    const outcome = input.outcome
    if (outcome !== 'compliant' && outcome !== 'deviation' && outcome !== 'absent' && outcome !== 'not_applicable') {
      failures.push({ checkNumber: check.number, reason: `Unrecognised outcome ${String(outcome)}` })
      continue
    }

    const claims = Array.isArray(input.references) ? input.references : []
    const references = claims.map(claim =>
      verifyFieldReference(context.values, check.reads, {
        fieldKey: String((claim as Record<string, unknown>).field_key ?? ''),
        claimedValue:
          (claim as Record<string, unknown>).claimed_value === null
            ? null
            : String((claim as Record<string, unknown>).claimed_value ?? ''),
      }),
    )

    findings.push({
      checkNumber: check.number,
      outcome: outcome as FieldAuditOutcome,
      severity: outcome === 'deviation' || outcome === 'absent' ? check.risk : null,
      rationale: typeof input.rationale === 'string' ? input.rationale : '',
      references,
    })
  }

  return { promptSlug: context.promptSlug, promptVersion: context.promptVersion, findings, failures }
}

/**
 * The findings that may become tasks.
 *
 * One gate rather than a filter at each call site, matching
 * `exportableFindings` in the review path — "only verified evidence leaves the
 * tool" is the rule the whole design rests on, and it should be enforceable in
 * one place.
 */
export function actionableFindings(result: FieldAuditResult): FieldAuditFinding[] {
  return result.findings.filter(
    finding =>
      (finding.outcome === 'deviation' || finding.outcome === 'absent') &&
      finding.references.length > 0 &&
      finding.references.every(reference => reference.verification === 'verified'),
  )
}
```

Add the export: `"./fieldAudit/runFieldAudit": "./src/fieldAudit/runFieldAudit.ts"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/field-audit-run.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the gate test**

```ts
it('lets no finding through whose references did not check out', async () => {
  const result = await runFieldAudit(
    { promptSlug: 'p', promptVersion: 1, values },
    body,
    {
      callModel: async () => reply({
        outcome: 'deviation', rationale: 'x',
        references: [
          { field_key: 'concerns', claimed_value: 'Provide for my son Daniel' },
          { field_key: 'residuary_beneficiary', claimed_value: 'Children' },
        ],
      }),
    },
  )
  // One reference verified, one did not. The finding is still shown to a
  // person, but it never becomes a task.
  expect(result.findings).toHaveLength(1)
  expect(actionableFindings(result)).toEqual([])
})
```

Run: `cd apps/workbench && npx vitest run tests/field-audit-run.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/citations/src/fieldAudit/runFieldAudit.ts packages/citations/package.json apps/workbench/tests/field-audit-run.test.ts
git commit -m "A field audit runs one check at a time and verifies every claim"
```

---

## Task 7b: Extract the one engine

The approved architecture is **one** `runPrompt` with three seams, not two engines side by
side. Tasks 1–7 deliberately build the second kind first: an abstraction extracted from
two working examples is discovered, while one designed before the second example exists is
guessed. Both now exist, so extract it — and the extraction is only honest if neither
kind's behaviour changes, which is what the existing suites prove.

**Files:**
- Create: `packages/citations/src/prompt/runPrompt.ts`
- Modify: `packages/citations/src/review/runReview.ts`, `packages/citations/src/fieldAudit/runFieldAudit.ts`
- Test: `apps/workbench/tests/run-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { runPrompt } from '@aubrey-law/citations/prompt/runPrompt'

const seams = {
  units: [{ id: '1', risk: 'high' as const }, { id: '2', risk: 'low' as const }],
  requestFor: (unit: { id: string }) => ({
    model: 'm', max_tokens: 16, system: [{ type: 'text' as const, text: 's' }],
    messages: [{ role: 'user' as const, content: unit.id }],
    tools: [{ name: 't', description: 'd', input_schema: { type: 'object' as const, properties: {}, required: [] } }],
    tool_choice: { type: 'tool' as const, name: 't' },
  }),
  toolName: 't',
  findingFor: (unit: { id: string; risk: 'high' | 'low' }, input: Record<string, unknown>) =>
    ({ unitId: unit.id, outcome: String(input.outcome), risk: unit.risk }),
}

const reply = (input: unknown) => ({ content: [{ type: 'tool_use', name: 't', input }] }) as never

describe('the shared prompt engine', () => {
  it('runs one call per unit and collects a finding for each', async () => {
    const result = await runPrompt(seams, {
      callModel: async () => reply({ outcome: 'deviation' }),
      context: { route: 'test' },
    })
    expect(result.findings).toHaveLength(2)
    expect(result.failures).toEqual([])
  })

  it('loses only the unit whose call threw', async () => {
    // Per-unit fail-soft is the property both kinds depend on, so it lives
    // here rather than being implemented twice and drifting.
    let call = 0
    const result = await runPrompt(seams, {
      callModel: async () => { call += 1; if (call === 1) throw new Error('network'); return reply({ outcome: 'compliant' }) },
      context: { route: 'test' },
    })
    expect(result.findings).toHaveLength(1)
    expect(result.failures).toEqual([{ unitId: '1', reason: 'network' }])
  })

  it('records a unit that came back with no tool call', async () => {
    const result = await runPrompt(seams, {
      callModel: async () => ({ content: [{ type: 'text', text: 'hello' }] }) as never,
      context: { route: 'test' },
    })
    expect(result.findings).toEqual([])
    expect(result.failures).toEqual([
      { unitId: '1', reason: 'Model returned no tool call' },
      { unitId: '2', reason: 'Model returned no tool call' },
    ])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/run-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the shared engine**

```ts
// packages/citations/src/prompt/runPrompt.ts
import type { ModelCallContext, ModelCaller, ModelRequest, ModelResponse } from '../review/model'

/**
 * The loop both kinds of prompt share.
 *
 * One call per unit against a cached prefix, per-unit fail-soft, and the tool
 * call read out by name. What a unit *is*, what the request says, and what a
 * response becomes are the caller's — those are the three things that genuinely
 * differ between a rule ladder and a field audit, and they are the only three.
 *
 * Extracted from the two working engines rather than designed before either
 * existed. Verification is deliberately not a seam here: it happens inside
 * `findingFor`, because what counts as evidence differs so completely between
 * offsets in a text layer and a value in a row that a shared signature would
 * describe neither.
 */
export interface PromptSeams<Unit, Finding> {
  /** One unit of work: a rule against a document, or a check against a matter. */
  units: Unit[]
  requestFor: (unit: Unit) => ModelRequest
  toolName: string
  /** Turns the tool input into a finding, verifying its evidence on the way. */
  findingFor: (unit: Unit, input: Record<string, unknown>) => Finding | null
  /** How a unit names itself in a failure. Defaults to `String(index + 1)`. */
  idFor?: (unit: Unit, index: number) => string
}

export interface RunPromptDependencies {
  callModel: ModelCaller
  context: ModelCallContext
}

export interface PromptRunResult<Finding> {
  findings: Finding[]
  failures: Array<{ unitId: string; reason: string }>
}

function readToolInput(response: ModelResponse, toolName: string): Record<string, unknown> | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === toolName) {
      return block.input as Record<string, unknown>
    }
  }
  return null
}

export async function runPrompt<Unit, Finding>(
  seams: PromptSeams<Unit, Finding>,
  deps: RunPromptDependencies,
): Promise<PromptRunResult<Finding>> {
  const findings: Finding[] = []
  const failures: Array<{ unitId: string; reason: string }> = []
  const idFor = seams.idFor ?? ((_unit: Unit, index: number) => String(index + 1))

  for (const [index, unit] of seams.units.entries()) {
    const unitId = idFor(unit, index)
    let input: Record<string, unknown> | null
    try {
      const response = await deps.callModel(seams.requestFor(unit), deps.context)
      input = readToolInput(response, seams.toolName)
    } catch (error) {
      // One unit losing its call must not cost the run.
      failures.push({ unitId, reason: (error as Error).message })
      continue
    }

    if (!input) {
      failures.push({ unitId, reason: 'Model returned no tool call' })
      continue
    }

    const finding = seams.findingFor(unit, input)
    if (finding === null) {
      failures.push({ unitId, reason: 'Model returned an unusable answer' })
      continue
    }
    findings.push(finding)
  }

  return { findings, failures }
}
```

Add the export: `"./prompt/runPrompt": "./src/prompt/runPrompt.ts"`.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/run-prompt.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Rewrite both engines as adapters**

In `runFieldAudit.ts`, replace the `for (const check of body.checks)` loop with a call to
`runPrompt`, keeping every existing export and signature:

```ts
const run = await runPrompt<FieldAuditCheck, FieldAuditFinding>(
  {
    units: body.checks,
    idFor: check => check.number,
    toolName: FIELD_AUDIT_TOOL_NAME,
    requestFor: check => ({
      model,
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM_INSTRUCTIONS },
        { type: 'text', text: sheet, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: checkMessage(check) }],
      tools: [FIELD_AUDIT_TOOL],
      tool_choice: { type: 'tool', name: FIELD_AUDIT_TOOL_NAME },
    }) as ModelRequest,
    findingFor: (check, input) => {
      const outcome = input.outcome
      if (outcome !== 'compliant' && outcome !== 'deviation' && outcome !== 'absent' && outcome !== 'not_applicable') {
        return null
      }
      const claims = Array.isArray(input.references) ? input.references : []
      return {
        checkNumber: check.number,
        outcome: outcome as FieldAuditOutcome,
        severity: outcome === 'deviation' || outcome === 'absent' ? check.risk : null,
        rationale: typeof input.rationale === 'string' ? input.rationale : '',
        references: claims.map(claim =>
          verifyFieldReference(context.values, check.reads, {
            fieldKey: String((claim as Record<string, unknown>).field_key ?? ''),
            claimedValue:
              (claim as Record<string, unknown>).claimed_value === null
                ? null
                : String((claim as Record<string, unknown>).claimed_value ?? ''),
          }),
        ),
      }
    },
  },
  { callModel: deps.callModel, context: { route: 'prompt/field-audit', matterId: context.matterId ?? null, userId: context.userId ?? null, contextType: 'matter' } },
)

return {
  promptSlug: context.promptSlug,
  promptVersion: context.promptVersion,
  findings: run.findings,
  failures: run.failures.map(f => ({ checkNumber: f.unitId, reason: f.reason })),
}
```

Apply the same change to `runReviewPlaybook` in `runReview.ts`: `units: playbook.rules`,
`idFor: rule => rule.number`, the request as it is built today, and `findingFor` holding
the existing outcome check and `verifyQuote` call. Map failures back to
`{ ruleNumber, reason }`.

- [ ] **Step 6: Prove neither kind changed**

Run: `cd apps/workbench && npm run verify`
Expected: PASS, with every existing review test unchanged and untouched. **If any review
test needed editing, the extraction changed behaviour — revert and redo it.** That the
review suite passes without modification is the only evidence that this was a refactor.

- [ ] **Step 7: Commit**

```bash
git add packages/citations/src/prompt/runPrompt.ts packages/citations/src/review/runReview.ts packages/citations/src/fieldAudit/runFieldAudit.ts packages/citations/package.json apps/workbench/tests/run-prompt.test.ts
git commit -m "One engine, with the three seams the two kinds actually needed"
```

---

## Task 8: The six checks

**Files:**
- Create: `supabase/migrations/20261028020000_seed_design_sheet_audit.sql`
- Test: `apps/workbench/tests/design-sheet-audit-content.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'
import { unknownSources } from '@aubrey-law/citations/prompt/inputs'

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261028020000_seed_design_sheet_audit.sql'),
  'utf8',
)
const body = JSON.parse(migration.slice(migration.indexOf('$body$') + 6, migration.lastIndexOf('$body$')))

describe('the design-sheet audit prompt', () => {
  it('parses as a field audit', () => {
    expect(promptBodySchema.safeParse(body).success).toBe(true)
  })

  it('carries the six approved checks, with check 1 at blocker', () => {
    expect(body.checks).toHaveLength(6)
    expect(body.checks[0].risk).toBe('blocker')
  })

  it('declares every field its checks read', () => {
    // A check may only reference fields the prompt actually resolved. One that
    // reads a field nobody fetched would produce references that fail
    // verification for a reason that is the prompt's fault, not the model's.
    const declared = new Set(body.inputs.map((i: { key: string }) => i.key))
    for (const check of body.checks) {
      for (const field of check.reads) {
        expect(declared, `check ${check.number} reads undeclared ${field}`).toContain(field)
      }
    }
  })

  it('declares only sources the allow-list permits', () => {
    // `unknownSources` is the publish-time gate. Until there is an authoring
    // screen to call it, a seeded prompt is a publish and this is where the
    // gate runs — so the function has a caller from the day it exists.
    expect(unknownSources(body.inputs)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/design-sheet-audit-content.test.ts`
Expected: FAIL — ENOENT.

- [ ] **Step 3: Write the seed migration**

```sql
-- The design-sheet issue spotter: six checks, none of them an `if`.
--
-- Deliberately not deterministic field comparisons. `staggered_distributions`
-- set with `distribution_age` null is a boolean test, and six of those would
-- prove only that a model can do `if` while paying it to. What a model can do
-- and a checker cannot is read the client's own words against the structured
-- decisions that will drive the drafting, so every check below is of that
-- shape.
--
-- No check for a fiduciary without a successor: the fiduciary matrix already
-- finds that deterministically against contact_roles, and found 14 of 33 chains
-- in live data. Two sources of truth for one question is worse than one.

insert into public.prompts (slug, title, kind, stages, matter_types, is_system)
values (
  'ma-design-sheet-audit',
  'Massachusetts design sheet — issue spotter',
  'field_audit',
  array['design', 'drafting'],
  '{}',
  true
) on conflict (slug) do nothing;

insert into public.prompt_versions (prompt_id, kind, version_number, body, content_hash, change_summary)
select p.id, 'field_audit', 1, $body$
{
  "kind": "field_audit",
  "inputs": [
    { "key": "concerns", "source": "design_sheet.concerns", "required": true },
    { "key": "goals_notes", "source": "design_sheet.goals_notes", "required": false },
    { "key": "drafting_notes", "source": "design_sheet.drafting_notes", "required": false },
    { "key": "children", "source": "design_sheet.children", "required": false },
    { "key": "assets", "source": "design_sheet.assets", "required": false },
    { "key": "specific_bequests", "source": "design_sheet.specific_bequests", "required": false },
    { "key": "disinheritances", "source": "design_sheet.disinheritances", "required": false },
    { "key": "residuary_beneficiary", "source": "design_sheet.residuary_beneficiary", "required": false },
    { "key": "residual_beneficiary_individuals", "source": "design_sheet.residual_beneficiary_individuals", "required": false },
    { "key": "residuary_distribution", "source": "design_sheet.residuary_distribution", "required": false },
    { "key": "spouse_citizenship", "source": "design_sheet.spouse_citizenship", "required": false },
    { "key": "include_qdot", "source": "design_sheet.include_qdot", "required": false },
    { "key": "marital_trust_type", "source": "design_sheet.marital_trust_type", "required": false },
    { "key": "real_property_transfer", "source": "design_sheet.real_property_transfer", "required": false },
    { "key": "state", "source": "design_sheet.state", "required": false },
    { "key": "client_domicile", "source": "design_sheet.client_domicile", "required": false }
  ],
  "checks": [
    {
      "number": "1",
      "statement": "Every concern the client stated is answered somewhere in the plan's structured decisions. A concern recorded in their own words and then left unaddressed by the residuary, the trust type or the fiduciary appointments is the failure this review exists to catch — the client said what mattered to them and the plan did not respond to it.",
      "risk": "blocker",
      "reads": ["concerns", "goals_notes", "residuary_beneficiary", "residual_beneficiary_individuals", "residuary_distribution", "marital_trust_type"],
      "taskTemplate": {
        "title": "A stated concern is not answered by the plan",
        "description": "The design sheet records a concern that the structured decisions do not address. Confirm whether the plan should change or the concern is recorded elsewhere.",
        "priority": "high"
      }
    },
    {
      "number": "2",
      "statement": "Every person named in the client's free text appears in the structured decisions. A child or intended beneficiary who is mentioned by name in the concerns or notes but appears in no beneficiary or fiduciary field will be absent from the drafted instrument, and nobody will notice until it is signed.",
      "risk": "blocker",
      "reads": ["concerns", "goals_notes", "drafting_notes", "children", "residual_beneficiary_individuals", "residuary_beneficiary"],
      "taskTemplate": {
        "title": "A person named in the notes is missing from the plan",
        "description": "Someone is named in the design sheet's free text but appears in none of the beneficiary or fiduciary fields. Confirm whether they were meant to be included.",
        "priority": "high"
      }
    },
    {
      "number": "3",
      "statement": "Every specific bequest names something the asset list contains. A bequest of property the client does not own, or no longer owns, adeems — the beneficiary takes nothing, and the gift the client believed they had made silently fails.",
      "risk": "high",
      "reads": ["specific_bequests", "assets"],
      "taskTemplate": {
        "title": "A specific bequest names an asset not on the list",
        "description": "A specific bequest refers to property the asset list does not record. Confirm ownership before drafting, or the gift may adeem.",
        "priority": "normal"
      }
    },
    {
      "number": "4",
      "statement": "Every disinheritance is deliberate on its face and consistent with the residuary. An omission that reads as accidental invites a pretermitted-heir claim under MUPC c. 190B § 2-302, and a person recorded as disinherited who nonetheless appears among the residuary beneficiaries is a contradiction the drafting cannot resolve.",
      "risk": "high",
      "reads": ["disinheritances", "residuary_beneficiary", "residual_beneficiary_individuals", "concerns"],
      "taskTemplate": {
        "title": "A disinheritance is unclear or contradicted",
        "description": "The disinheritance record either states no reason or conflicts with the residuary. Confirm the intent and make the omission explicit in the drafting.",
        "priority": "normal"
      }
    },
    {
      "number": "5",
      "statement": "A spouse who is not a United States citizen has a QDOT, or a recorded decision not to use one. IRC § 2056(d) denies the unlimited marital deduction outright for a non-citizen spouse absent a qualified domestic trust, and the citizenship field is free text where 'green card', 'permanent resident' and 'not a citizen' all appear and all mean the same thing here.",
      "risk": "blocker",
      "reads": ["spouse_citizenship", "include_qdot", "marital_trust_type"],
      "taskTemplate": {
        "title": "Non-citizen spouse with no QDOT decision",
        "description": "The spouse appears not to be a US citizen and no QDOT decision is recorded. IRC 2056(d) denies the marital deduction without one.",
        "priority": "high"
      }
    },
    {
      "number": "6",
      "statement": "Every parcel of real property in the asset list has a transfer decision, and property outside Massachusetts has a plan for it. A trust that does not hold the house is the failure the funding tracker exists to catch, one stage earlier; and a Massachusetts trust alone does not avoid ancillary probate in the state where the other property sits.",
      "risk": "high",
      "reads": ["assets", "real_property_transfer", "state", "client_domicile"],
      "taskTemplate": {
        "title": "Real property with no transfer decision",
        "description": "The asset list records real property with no transfer decision, or property outside Massachusetts with no ancillary plan. Confirm how each parcel reaches the trust.",
        "priority": "high"
      }
    }
  ]
}
$body$::jsonb,
  '<HASH — from the command below>',
  'The six checks approved by the owner on 2026-09-05.'
from public.prompts p where p.slug = 'ma-design-sheet-audit'
on conflict (prompt_id, version_number) do nothing;

insert into public.prompt_publications (prompt_id, version_id)
select v.prompt_id, v.id
from public.prompt_versions v
join public.prompts p on p.id = v.prompt_id
where p.slug = 'ma-design-sheet-audit' and v.version_number = 1
on conflict (prompt_id) do nothing;
```

Replace the `encode(...)` expression with the literal hash produced by:

```bash
node -e "
const c=require('crypto'), fs=require('fs');
const sql=fs.readFileSync('supabase/migrations/20261028020000_seed_design_sheet_audit.sql','utf8');
const body=sql.slice(sql.indexOf('\$body\$')+6, sql.indexOf('\$body\$::jsonb'));
console.log(c.createHash('sha256').update(JSON.stringify(JSON.parse(body))).digest('hex'));
"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/design-sheet-audit-content.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Apply and commit**

```bash
npx supabase db push
git add supabase/migrations/20261028020000_seed_design_sheet_audit.sql apps/workbench/tests/design-sheet-audit-content.test.ts
git commit -m "Six checks that read the client's words against the plan"
```

---

## Task 9: Persisting a field-audit run

**Files:**
- Create: `apps/workbench/lib/fieldAudit/persist.ts`
- Test: `apps/workbench/tests/field-audit-persist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { runStatusForAudit, findingRowsFor, referenceRowsFor } from '@/lib/fieldAudit/persist'

const result = {
  promptSlug: 'ma-design-sheet-audit',
  promptVersion: 1,
  findings: [
    {
      checkNumber: '1', outcome: 'deviation' as const, severity: 'blocker' as const,
      rationale: 'Unanswered.',
      references: [{ fieldKey: 'concerns', claimedValue: 'x', actualValue: 'x', verification: 'verified' as const }],
    },
  ],
  failures: [{ checkNumber: '2', reason: 'network' }],
}

describe('storing a field-audit run', () => {
  it('calls a run with failures partial, never completed', () => {
    expect(runStatusForAudit({ findingCount: 1, failedCount: 1 })).toBe('partial')
    expect(runStatusForAudit({ findingCount: 1, failedCount: 0 })).toBe('completed')
    expect(runStatusForAudit({ findingCount: 0, failedCount: 3 })).toBe('failed')
  })

  it('maps a finding onto the shared findings table', () => {
    // The same table the review writes, keyed by check number in rule_number.
    // One findings table was the plan's decision and it holds here.
    expect(findingRowsFor('run-1', result)).toEqual([
      {
        run_id: 'run-1', rule_number: '1', outcome: 'deviation', severity: 'blocker',
        rationale: 'Unanswered.', proposed_language: null,
        citation_refusal: null, attempted_quote: null, disposition: 'open',
      },
    ])
  })

  it('stores every reference, verified or not', () => {
    // The unverified ones are the measure of whether this works at all.
    expect(referenceRowsFor('finding-1', result.findings[0])).toEqual([
      { finding_id: 'finding-1', field_key: 'concerns', claimed_value: 'x', actual_value: 'x', verification: 'verified' },
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/field-audit-persist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/workbench/lib/fieldAudit/persist.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { FieldAuditFinding, FieldAuditResult } from '@aubrey-law/citations/fieldAudit/types'

export type RunStatus = 'completed' | 'partial' | 'failed'

/**
 * `partial` is the honest word when some checks ran and some did not.
 *
 * The same rule the review follows, and enforced by a database constraint
 * besides: a run reporting only its findings would overstate its own coverage.
 */
export function runStatusForAudit(counts: { findingCount: number; failedCount: number }): RunStatus {
  if (counts.failedCount === 0) return 'completed'
  return counts.findingCount === 0 ? 'failed' : 'partial'
}

export function findingRowsFor(runId: string, result: FieldAuditResult) {
  return result.findings.map(finding => ({
    run_id: runId,
    rule_number: finding.checkNumber,
    outcome: finding.outcome,
    severity: finding.severity,
    rationale: finding.rationale,
    proposed_language: null,
    citation_refusal: null,
    attempted_quote: null,
    disposition: 'open',
  }))
}

export function referenceRowsFor(findingId: string, finding: FieldAuditFinding) {
  return finding.references.map(reference => ({
    finding_id: findingId,
    field_key: reference.fieldKey,
    claimed_value: reference.claimedValue,
    actual_value: reference.actualValue,
    verification: reference.verification,
  }))
}

export interface SaveAuditInput {
  matterId: string
  promptVersionId: string
  result: FieldAuditResult
  model: string
  userId: string | null
}

export async function saveAuditRun(
  client: SupabaseClient<WorkbenchDatabase>,
  input: SaveAuditInput,
): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const counts = {
    findingCount: input.result.findings.length,
    failedCount: input.result.failures.length,
  }

  const { data: run, error: runError } = await client
    .from('workflow_runs')
    .insert({
      matter_id: input.matterId,
      kind: 'field_audit',
      prompt_version_id: input.promptVersionId,
      document_version_id: null,
      text_layer_id: null,
      model: input.model,
      status: runStatusForAudit(counts),
      rule_total: counts.findingCount + counts.failedCount,
      finding_count: counts.findingCount,
      failed_count: counts.failedCount,
      failures: input.result.failures,
      finished_at: new Date().toISOString(),
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (runError || !run) return { ok: false, message: `Could not record the run: ${runError?.message}` }

  for (const finding of input.result.findings) {
    const [row] = findingRowsFor(run.id, { ...input.result, findings: [finding] })
    const { data: stored, error: findingError } = await client
      .from('workflow_findings')
      .insert(row)
      .select('id')
      .single()
    if (findingError || !stored) {
      return { ok: false, message: `Could not store a finding: ${findingError?.message}` }
    }

    const references = referenceRowsFor(stored.id, finding)
    if (references.length > 0) {
      const { error: referenceError } = await client
        .from('workflow_field_references')
        .insert(references)
      if (referenceError) {
        return { ok: false, message: `Could not store a reference: ${referenceError.message}` }
      }
    }
  }

  return { ok: true, runId: run.id }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/field-audit-persist.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/workbench/lib/fieldAudit/persist.ts apps/workbench/tests/field-audit-persist.test.ts
git commit -m "Record a field-audit run, its findings, and every reference"
```

---

## Task 10: Findings become tasks

**Files:**
- Create: `apps/workbench/lib/fieldAudit/tasks.ts`
- Test: `apps/workbench/tests/field-audit-tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { taskRowsFor, tasksToSupersede, PROMPT_TASK_SOURCE } from '@/lib/fieldAudit/tasks'

const check = {
  number: '1', statement: 's', risk: 'blocker' as const, reads: ['concerns'],
  taskTemplate: { title: 'A stated concern is not answered', description: 'Check it.', priority: 'high' as const },
}

const finding = {
  checkNumber: '1', outcome: 'deviation' as const, severity: 'blocker' as const,
  rationale: 'The residuary runs to the spouse alone.',
  references: [{ fieldKey: 'concerns', claimedValue: 'x', actualValue: 'x', verification: 'verified' as const }],
}

describe('turning verified findings into tasks', () => {
  it('writes one task per finding, tagged with the run', () => {
    expect(taskRowsFor('matter-1', 'run-9', [check], [finding])).toEqual([
      {
        matter_id: 'matter-1',
        title: 'A stated concern is not answered',
        description: 'Check it.\n\nThe residuary runs to the spouse alone.',
        priority: 'high',
        status: 'open',
        task_type: 'single',
        source: PROMPT_TASK_SOURCE,
        auto: true,
        batch_tag: 'prompt:run-9',
      },
    ])
  })

  it('supersedes only its own untouched tasks', () => {
    // The tool may withdraw its own suggestion. It may not touch a task
    // somebody has picked up, and a completed one is a record.
    const existing = [
      { id: 'a', status: 'open', assignee_id: null, batch_tag: 'prompt:run-1', source: PROMPT_TASK_SOURCE },
      { id: 'b', status: 'open', assignee_id: 'user-1', batch_tag: 'prompt:run-1', source: PROMPT_TASK_SOURCE },
      { id: 'c', status: 'completed', assignee_id: null, batch_tag: 'prompt:run-1', source: PROMPT_TASK_SOURCE },
      { id: 'd', status: 'open', assignee_id: null, batch_tag: null, source: 'stage' },
    ]
    expect(tasksToSupersede(existing, 'run-9')).toEqual(['a'])
  })

  it('never supersedes tasks from the run being written', () => {
    const existing = [{ id: 'a', status: 'open', assignee_id: null, batch_tag: 'prompt:run-9', source: PROMPT_TASK_SOURCE }]
    expect(tasksToSupersede(existing, 'run-9')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/workbench/lib/fieldAudit/tasks.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'

/** Provenance, following the `source: 'stage'` convention fireStageTasks uses. */
export const PROMPT_TASK_SOURCE = 'prompt'

export function taskRowsFor(
  matterId: string,
  runId: string,
  checks: FieldAuditCheck[],
  findings: FieldAuditFinding[],
) {
  const byNumber = new Map(checks.map(check => [check.number, check]))
  return findings.flatMap(finding => {
    const check = byNumber.get(finding.checkNumber)
    if (!check) return []
    return [{
      matter_id: matterId,
      title: check.taskTemplate.title,
      description: `${check.taskTemplate.description}\n\n${finding.rationale}`,
      priority: check.taskTemplate.priority,
      status: 'open',
      task_type: 'single',
      source: PROMPT_TASK_SOURCE,
      auto: true,
      batch_tag: `prompt:${runId}`,
    }]
  })
}

interface ExistingTask {
  id: string
  status: string
  assignee_id: string | null
  batch_tag: string | null
  source: string
}

/**
 * Which of this prompt's earlier tasks a new run replaces.
 *
 * A tool may withdraw its own suggestion. It may not touch a task somebody has
 * picked up, and a completed one is a record of work rather than a suggestion
 * still standing — so assignment or any status but `open` puts a task out of
 * reach, permanently.
 */
export function tasksToSupersede(existing: ExistingTask[], runId: string): string[] {
  return existing
    .filter(task => task.source === PROMPT_TASK_SOURCE)
    .filter(task => task.batch_tag !== null && task.batch_tag !== `prompt:${runId}`)
    .filter(task => task.status === 'open' && task.assignee_id === null)
    .map(task => task.id)
}

export async function emitTasks(
  client: SupabaseClient<WorkbenchDatabase>,
  input: { matterId: string; runId: string; checks: FieldAuditCheck[]; findings: FieldAuditFinding[] },
): Promise<{ created: number; superseded: number }> {
  const { data: existing, error: existingError } = await client
    .from('tasks')
    .select('id, status, assignee_id, batch_tag, source')
    .eq('matter_id', input.matterId)
    .eq('source', PROMPT_TASK_SOURCE)
  if (existingError) throw new Error(`Could not read existing tasks: ${existingError.message}`)

  const rows = taskRowsFor(input.matterId, input.runId, input.checks, input.findings)
  if (rows.length > 0) {
    const { error } = await client.from('tasks').insert(rows)
    if (error) throw new Error(`Could not create tasks: ${error.message}`)
  }

  const supersede = tasksToSupersede(existing ?? [], input.runId)
  if (supersede.length > 0) {
    const { error } = await client
      .from('tasks')
      .update({
        status: 'skipped',
        skipped_at: new Date().toISOString(),
        closeout_reason: `Superseded by prompt run ${input.runId}`,
      })
      .in('id', supersede)
    if (error) throw new Error(`Could not supersede earlier tasks: ${error.message}`)
  }

  return { created: rows.length, superseded: supersede.length }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm the task columns are real**

Run: `node scripts/checkDbColumns.mjs`
Expected: `✓ All N column reads across M tables exist in the database`, with `tasks`
now among them. If `skipped_at` or `closeout_reason` is rejected, they do not exist
and the update uses only the columns the check confirms.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/fieldAudit/tasks.ts apps/workbench/tests/field-audit-tasks.test.ts
git commit -m "A verified finding becomes a task, and withdraws its own stale ones"
```

---

## Task 11: The /prompts page

**Files:**
- Create: `apps/workbench/app/prompts/page.tsx`, `apps/workbench/app/prompts/PromptsWorkspace.tsx`, `apps/workbench/app/prompts/actions.ts`, `apps/workbench/lib/prompts/designSheet.ts`, `apps/workbench/lib/fieldAudit/run.ts`
- Modify: `apps/workbench/lib/auth/gate.ts` (add `/prompts` to `STAFF_PREFIXES`)
- Test: `apps/workbench/tests/prompts-page.test.tsx`, `apps/workbench/tests/auth-gate.test.ts` (existing)

- [ ] **Step 1: Write the failing gate test**

Add to `apps/workbench/tests/auth-gate.test.ts`:

```ts
it('gates /prompts behind staff, like every other practice tool', () => {
  expect(decide({ path: '/prompts', role: null, signedIn: false }).allowed).toBe(false)
  expect(decide({ path: '/prompts', role: 'client', signedIn: true }).allowed).toBe(false)
  expect(decide({ path: '/prompts', role: 'staff', signedIn: true }).allowed).toBe(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/auth-gate.test.ts`
Expected: FAIL — `/prompts` is not gated.

- [ ] **Step 3: Add the prefix**

In `apps/workbench/lib/auth/gate.ts`, add `'/prompts'` to `STAFF_PREFIXES`, keeping the
array alphabetical.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/auth-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the design-sheet reader and the run assembler**

```ts
// apps/workbench/lib/prompts/designSheet.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { SOURCE_ALLOW_LIST } from '@aubrey-law/citations/prompt/inputs'
import type { SourceRows } from '@aubrey-law/citations/prompt/inputs'

/** Every design-sheet column the allow-list permits, and nothing else. */
const DESIGN_SHEET_COLUMNS = Array.from(
  new Set(
    Object.values(SOURCE_ALLOW_LIST)
      .filter(entry => entry.table === 'design_sheet')
      .map(entry => entry.column),
  ),
).join(', ')

/**
 * The rows a prompt may read for one matter.
 *
 * The select list is derived from the allow-list rather than written out, so a
 * source added there cannot be one the reader forgets to fetch — which would
 * surface as a reference that fails verification for the prompt's reasons
 * rather than the model's.
 */
export async function loadSourceRows(
  client: SupabaseClient<WorkbenchDatabase>,
  matterId: string,
): Promise<SourceRows | null> {
  const { data: matter, error: matterError } = await client
    .from('matters')
    .select('id, name')
    .eq('id', matterId)
    .maybeSingle()
  if (matterError) throw new Error(`Could not load the matter: ${matterError.message}`)
  if (!matter) return null

  const { data: sheet, error: sheetError } = await client
    .from('design_sheets')
    .select(DESIGN_SHEET_COLUMNS)
    .eq('matter_id', matterId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sheetError) throw new Error(`Could not load the design sheet: ${sheetError.message}`)

  return {
    matter: matter as unknown as Record<string, unknown>,
    design_sheet: (sheet ?? {}) as unknown as Record<string, unknown>,
  }
}
```

```ts
// apps/workbench/lib/fieldAudit/run.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { resolveInputs } from '@aubrey-law/citations/prompt/inputs'
import { runFieldAudit, actionableFindings } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { loadSourceRows } from '@/lib/prompts/designSheet'
import { saveAuditRun } from './persist'
import { emitTasks } from './tasks'

export type AuditOutcome =
  | { ok: true; runId: string; findingCount: number; tasksCreated: number }
  | { ok: false; message: string }

/**
 * One field audit, end to end.
 *
 * Refuses rather than proceeds when a required input is missing, and names the
 * field. A plan reviewed against facts that were not supplied reads exactly
 * like one that was, which is the worse of the two failures.
 */
export async function runMatterAudit(
  client: SupabaseClient<WorkbenchDatabase>,
  input: { slug: string; matterId: string; userId: string | null; callModel: ModelCaller },
): Promise<AuditOutcome> {
  const prompt = await loadPublishedPrompt(client, input.slug)
  if (!prompt) return { ok: false, message: `No published prompt with slug ${input.slug}.` }
  if (prompt.body.kind !== 'field_audit') {
    return { ok: false, message: `Prompt ${input.slug} is a ${prompt.body.kind}, not a field audit.` }
  }

  const rows = await loadSourceRows(client, input.matterId)
  if (!rows) return { ok: false, message: 'That matter does not exist.' }

  const resolved = resolveInputs(prompt.body.inputs, rows)
  if (!resolved.ok) {
    return {
      ok: false,
      message: `This matter's design sheet is missing ${resolved.missing.join(', ')}. The audit needs those to say anything true.`,
    }
  }

  const model = 'claude-sonnet-5'
  const result = await runFieldAudit(
    {
      promptSlug: prompt.slug,
      promptVersion: prompt.versionNumber,
      values: resolved.values,
      matterId: input.matterId,
      userId: input.userId,
    },
    prompt.body,
    { callModel: input.callModel, model },
  )

  const saved = await saveAuditRun(client, {
    matterId: input.matterId,
    promptVersionId: prompt.versionId,
    result,
    model,
    userId: input.userId,
  })
  if (!saved.ok) return saved

  const { created } = await emitTasks(client, {
    matterId: input.matterId,
    runId: saved.runId,
    checks: prompt.body.checks,
    findings: actionableFindings(result),
  })

  return { ok: true, runId: saved.runId, findingCount: result.findings.length, tasksCreated: created }
}
```

- [ ] **Step 6: Write the page test**

```tsx
// apps/workbench/tests/prompts-page.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PromptsWorkspace } from '@/app/prompts/PromptsWorkspace'

const prompts = [
  { slug: 'ma-design-sheet-audit', title: 'Design sheet — issue spotter', kind: 'field_audit' as const, checkCount: 6 },
]
const matters = [{ matterId: 'm1', name: 'Smith Family Trust' }]

describe('the prompts workspace', () => {
  it('names what each prompt will check before it is run', () => {
    // An attorney should know what is about to be applied, not only what came
    // back — the same reason the review page reads its playbook on the server.
    render(<PromptsWorkspace prompts={prompts} matters={matters} runs={[]} />)
    expect(screen.getByText('Design sheet — issue spotter')).toBeInTheDocument()
    expect(screen.getByText(/6 checks/)).toBeInTheDocument()
  })

  it('says so plainly when there is nothing to run against', () => {
    render(<PromptsWorkspace prompts={prompts} matters={[]} runs={[]} />)
    expect(screen.getByText(/no matters with a design sheet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/prompts-page.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 8: Write the page**

```tsx
// apps/workbench/app/prompts/PromptsWorkspace.tsx
'use client'

import { useActionState, useState } from 'react'
import { Button } from '@aubrey-law/ui/button'
import { runAudit } from './actions'

export interface PromptSummary {
  slug: string
  title: string
  kind: 'review' | 'field_audit'
  checkCount: number
}
export interface MatterSummary { matterId: string; name: string }
export interface RunSummary { id: string; promptTitle: string; findingCount: number; finishedAt: string | null }

export function PromptsWorkspace({
  prompts, matters, runs,
}: { prompts: PromptSummary[]; matters: MatterSummary[]; runs: RunSummary[] }) {
  const [slug, setSlug] = useState(prompts[0]?.slug ?? '')
  const [matterId, setMatterId] = useState(matters[0]?.matterId ?? '')
  const [state, submit, pending] = useActionState(runAudit, null)

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Prompts</h1>
        {matters.length === 0 ? (
          <p className="text-muted-foreground">
            There are no matters with a design sheet to run a prompt against yet.
          </p>
        ) : (
          <form action={submit} className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Prompt</span>
              <select name="slug" value={slug} onChange={e => setSlug(e.target.value)} className="w-full rounded border p-2">
                {prompts.map(prompt => (
                  <option key={prompt.slug} value={prompt.slug}>
                    {prompt.title} — {prompt.checkCount} checks
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Matter</span>
              <select name="matterId" value={matterId} onChange={e => setMatterId(e.target.value)} className="w-full rounded border p-2">
                {matters.map(matter => (
                  <option key={matter.matterId} value={matter.matterId}>{matter.name}</option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={pending}>{pending ? 'Running…' : 'Run'}</Button>
          </form>
        )}
        {state?.ok === false && <p className="text-destructive">{state.message}</p>}
        {state?.ok === true && (
          <p>
            {state.findingCount} findings, {state.tasksCreated} tasks created.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="space-y-1">
            {runs.map(run => (
              <li key={run.id}>{run.promptTitle} — {run.findingCount} findings</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

```ts
// apps/workbench/app/prompts/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { anthropicModelCaller } from '@/lib/anthropic'
import { runMatterAudit } from '@/lib/fieldAudit/run'

export type AuditState =
  | { ok: true; findingCount: number; tasksCreated: number }
  | { ok: false; message: string }
  | null

export async function runAudit(_previous: AuditState, form: FormData): Promise<AuditState> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'Sign in to run a prompt.' }

  const slug = String(form.get('slug') ?? '')
  const matterId = String(form.get('matterId') ?? '')
  if (!slug || !matterId) return { ok: false, message: 'Choose a prompt and a matter.' }

  const outcome = await runMatterAudit(getAdminClient(), {
    slug, matterId, userId: user.id, callModel: anthropicModelCaller(),
  })
  if (!outcome.ok) return outcome

  revalidatePath('/prompts')
  return { ok: true, findingCount: outcome.findingCount, tasksCreated: outcome.tasksCreated }
}
```

```tsx
// apps/workbench/app/prompts/page.tsx
import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { loadReviewableByMatter } from '@/lib/review/matterDocuments'
import { PromptsWorkspace } from './PromptsWorkspace'

export const metadata = { title: 'Prompts · Aubrey Law Workbench' }

export default async function PromptsPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const client = getAdminClient()
  const prompts = await loadPublishedPrompts(client)
  const matters = await loadReviewableByMatter(client)

  return (
    <PromptsWorkspace
      prompts={prompts
        .filter(prompt => prompt.body.kind === 'field_audit')
        .map(prompt => ({
          slug: prompt.slug,
          title: prompt.title,
          kind: prompt.body.kind,
          checkCount: prompt.body.kind === 'field_audit' ? prompt.body.checks.length : 0,
        }))}
      matters={matters.map(matter => ({ matterId: matter.matterId, name: matter.title }))}
      runs={[]}
    />
  )
}
```

`anthropicModelCaller()` throws `AnthropicKeyMissingError` when the key is absent —
`app/api/staff/review/route.ts:74` shows the handling to follow, and the action returns
that message rather than letting it reach the error boundary.

- [ ] **Step 9: Run the tests**

Run: `cd apps/workbench && npx vitest run tests/prompts-page.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 10: Run the whole suite and the build**

```bash
cd apps/workbench && npm run verify
VERCEL=1 NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder SUPABASE_SERVICE_ROLE_KEY=placeholder npm run build
```

Expected: verify passes; the build lists `/prompts` among the routes.

- [ ] **Step 11: Commit**

```bash
git add apps/workbench/app/prompts apps/workbench/lib/prompts apps/workbench/lib/fieldAudit/run.ts apps/workbench/lib/auth/gate.ts apps/workbench/tests/prompts-page.test.tsx apps/workbench/tests/auth-gate.test.ts
git commit -m "A page to run a prompt against a matter"
```

---

## Task 12: The check no test can stand in for

The phase 3 discipline: a real run against real data, reported before this is called done.
Nothing above proves the six checks say anything true.

- [ ] **Step 1: Run the audit against a real matter**

With `.env.local` present in the worktree, and with the owner's Anthropic key already set:

```bash
npx tsx -e "
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import { createClient } from '@supabase/supabase-js'
import { runMatterAudit } from './apps/workbench/lib/fieldAudit/run'
import { anthropicModelCaller } from './apps/workbench/lib/anthropic'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as never
const matterId = process.argv[1]
runMatterAudit(admin, { slug: 'ma-design-sheet-audit', matterId, userId: null, callModel: anthropicModelCaller() })
  .then(r => console.log(JSON.stringify(r, null, 2)))
" <matter-id>
```

- [ ] **Step 2: Measure what actually matters**

Read back the references and count how many survived verification:

```bash
node -e "
const fs=require('fs');
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^[\"']|[\"']\$/g,'');}
const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(u+'/rest/v1/workflow_field_references?select=verification',{headers:{apikey:k,Authorization:'Bearer '+k}})
  .then(r=>r.json()).then(rows=>{
    const v=rows.filter(r=>r.verification==='verified').length;
    console.log(\`\${v} of \${rows.length} references verified\`);
  });
"
```

- [ ] **Step 3: Report to the owner, and do not tune the verifier**

Report: how many findings, how many references verified, how many tasks created, and the
rationale text of anything that failed verification.

**If the verification rate is poor, the fix is the prompt or how the design sheet is
presented — never the verifier, and never the severity.** That rule was set for citations
in phase 3 and restated for check 1 when it was kept at `blocker` on 2026-09-05.

Client design sheets are privileged. Print counts and field keys, never field values.

- [ ] **Step 4: Delete the scratch file and the environment copy**

```bash
rm -f .env.local
git status --short
```

Expected: no `.env.local`, no probe scripts.

- [ ] **Step 5: Open the pull request**

```bash
gh pr create --title "Prompts become objects, and one of them reads no document" --body "$(cat <<'MD'
Phase 4's first slice. Prompts are versioned objects in the database, the review playbook moved into one unchanged, and a second prompt runs that reads no document at all — which is what the Irys reframe assumed and nothing had tested.

**What it proves.** `workflow_runs.document_version_id` was `NOT NULL`; every line of the review path assumed a document to cite. A design-sheet issue spotter has none, so the run tables, the engine and the verifier all had to generalise or be shown wrong. They generalised: one `runPrompt` with three seams — what a unit is, what a reference points at, what a finding becomes — extracted from two working engines rather than guessed before the second existed. The review suite passes unmodified, which is the evidence that the extraction was a refactor.

**The quality bar carried across.** A citation is offsets verified against a text layer; a field reference is a value verified against the row it names. Both are claims until checked, both record the near miss when they fail, and only verified evidence leaves the tool — an unverified finding is shown to a person but never becomes a task.

**The six checks are not `if` statements.** Deterministic field comparisons would prove only that a model can do `if`. Each check reads the client's own words against the structured decisions that drive the drafting.

**Verified against real data:** <findings> findings on a real matter, <verified>/<total> field references survived verification, <tasks> tasks created. Every column checked against the live database by `scripts/checkDbColumns.mjs`.
MD
)"
```

Fill the three counts from Task 12 Step 2. State the verification rate even if it is poor —
especially if it is poor, since the response is to change the prompt and never the verifier.

---

## Verification checklist

- [ ] `cd apps/workbench && npm run verify` passes.
- [ ] Root `npm run lint`, `npm run typecheck`, `npm test` pass.
- [ ] `node scripts/checkDbColumns.mjs` passes — every new column checked against the live database.
- [ ] `VERCEL=1 … npm run build` succeeds and lists `/prompts`.
- [ ] The review still runs, reading its playbook from the database.
- [ ] A real field audit ran against a real matter and its verification rate was reported.
- [ ] No `.env.local` or probe script remains in the worktree.
