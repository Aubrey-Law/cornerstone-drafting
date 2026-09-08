# Versioning the render, not just the instructions — design

**Date:** 2026-09-08
**Status:** approved by the owner, ready to plan
**Follows:** #424 (a run records which instructions produced it)

## The problem

`workflow_runs` pins `prompt_version_id`, and `prompt_versions` is immutable,
so finishing a run means answering the same *checks* it opened with. #424
extended that to the instruction text, via `workflow_runs.instructions_version`
and a registry per kind in `packages/citations`.

Four pieces of the same question are still un-versioned module code, read at
the moment of the call — and the call can come long after the run opened,
because `retryFailedSteps` sets failed steps back to `pending` and the next
tick works them against whatever is deployed then.

For a field-audit unit, `requestFor` is built from:

| Piece | Pinned today | Where it lives |
| --- | --- | --- |
| instruction text | yes | `instructions_version` + registry |
| check statement, `risk`, `reads` | yes | `prompt_versions` (immutable) |
| sheet values | yes | `workflow_runs.resolved_inputs` |
| model id | yes | `workflow_runs.model` |
| **tool schema** | **no** | `FIELD_AUDIT_TOOL` constant |
| **tool name** | **no** | `FIELD_AUDIT_TOOL_NAME` constant |
| **`checkMessage` wrapper text** | **no** | module function |
| **`sheetForPrompt` / `formatFieldValue`** | **no** | module functions |
| **`max_tokens: 1024`** | **no** | inline literal |

`runReview.ts` is structurally identical, with `REVIEW_TOOL`, `ruleMessage`,
`documentForPrompt` and the same literal.

The tool schema is the piece with a measured history: its missing `minItems`
let `references: []` validate, which was the mechanism behind the vanished
blocker #422 fixed. But versioning it alone would close one of four holes and
buy a second integer to pin, and separately-versioned pieces make
combinations representable that never ran — instructions v1 with tool v3 —
which replay would happily construct while reporting fidelity.

The tool *name* has to move with the schema, which was not obvious:
`runPrompt`'s `readToolInput` matches the response block by
`block.name === seams.toolName`, so a version that renames the tool and leaves
the matcher behind reads nothing from every unit and fails the whole run for a
reason that looks like a model problem.

## The decision

**Version the render:** one object per version, per kind, holding everything
*code* contributes to a unit's call. A run pins one integer and its entire
question — data plus render — is reconstructible.

```ts
export interface FieldAuditRender {
  instructions: string
  tool: { name: string; description: string; input_schema: Record<string, unknown> }
  maxTokens: number
  checkMessage: (check: FieldAuditCheck) => string
  sheet: (values: Record<string, unknown>) => string
  parse: (input: Record<string, unknown>) => ParsedFieldAuditAnswer
}
```

Version 1's fields are today's values verbatim. **No behaviour change ships
with the mechanism** — the point of the slice is that a run's question stops
drifting, not that the question changes.

Entries reference shared functions rather than copying them. A later version
copies only what actually diverges; until something diverges, v2's `sheet` is
the same function object as v1's. The registry file gets longer as versions
accumulate, which is the price of replay, and is the same trade the
instructions registry already took.

### The boundary: the ask is versioned, the gate is not

`findingForCheck` does two jobs today, and they pull opposite ways:

1. It reads the tool input's shape — `field_key`, `claimed_value`. That *is*
   the versioned schema, so it belongs to the render.
2. It applies the gate — `verifyFieldReference` on every claim, and #422's
   refusal of a `deviation`/`absent` with no references at all.

So they split. `parse` goes in the render entry and returns claims, not
findings. The gate stays in the engine at current code, permanently, and the
reason goes in the code:

> A run's **question** must not change after it opens; a run's **conclusion**
> is allowed to improve. Versioning the gate would let a run opened before a
> gate fix escape that fix on retry — which is the opposite of what #422 was
> for. So `verifyFieldReference`, `verifyQuote`, `isActionable` and the
> empty-references enforcement are deliberately outside the registry.

This is the part worth stating explicitly, because "we versioned the
instructions, so version everything" is the wrong lesson and would have
produced a worse system.

### What `parse` returns

```ts
export interface ParsedFieldAuditAnswer {
  outcome: unknown            // validated by the engine, not the parser
  rationale: string | null
  claims: FieldReferenceClaim[]
}
```

`parse` maps shape to claims and nothing else. Deciding whether `outcome` is
one of the four legal values stays in the engine: it is a gate question ("is
this answerable at all"), and a v2 schema that offered a fifth outcome should
still be refused by a current build that does not know it.

The review side's parser is the same idea with `quote`, `block_index` and
`proposed_language`.

## Files

| File | Change |
| --- | --- |
| `packages/citations/src/fieldAudit/render.ts` | **new** — `FieldAuditRender`, `FIELD_AUDIT_RENDERS`, `CURRENT_FIELD_AUDIT_RENDER_VERSION`, `fieldAuditRender()`, and v1's instructions text, tool, formatters and parser |
| `packages/citations/src/fieldAudit/runFieldAudit.ts` | keeps the engine, the gate, `isActionable` / `actionableFindings` / `answerForFinding` / `runAnswers`. Loses the tool constant, the instructions registry, the formatters and the parsing half of `findingForCheck`. Currently 463 lines. |
| `packages/citations/src/review/render.ts` | **new** — the same for `ReviewRender` |
| `packages/citations/src/review/runReview.ts` | the same subtraction |
| `apps/workbench/lib/runs/record.ts` | stamps `render_version` from `CURRENT_*_RENDER_VERSION` |
| `apps/workbench/lib/runs/context.ts` | selects `render_version` |
| `apps/workbench/lib/runs/worker.ts` | passes `renderVersion` to both engines |
| `supabase/migrations/20261109000000_run_render_version.sql` | **new** — the column rename |
| `packages/db-types/src/supabase.generated.ts` | regenerated |

The package's `exports` map already wildcards `./fieldAudit/*` and `./review/*`,
so a new file needs no manifest change.

`FIELD_AUDIT_TOOL_NAME` and `REVIEW_TOOL_NAME` stay exported — three test files
import them to build mock tool_use blocks — but are **derived** from the
current render's tool name rather than standing beside it as a second source.

## Migration

```sql
alter table public.workflow_runs rename column instructions_version to render_version;
```

A rename, not a new column: every existing value is still correct, because
version 1 of the render *is* the render those runs used. Nothing is guessed and
nothing is backfilled — the same discipline as #424's migration, which refused
to infer historical instruction text from deploy timestamps.

Still nullable, with the meaning unchanged: null means the run predates
versioning and a retry renders the current entry, which is what it would have
got anyway. The column comment is rewritten to say what a render is.

Then regenerate types with the pooler URL and **hand-restore the
`__InternalSupabase` block**, which `supabase gen types --db-url` drops and
`tests/supabase-types-drift.test.ts` requires.

## Testing

The mechanism is trivially green with one version in the registry — which is
how #419's cross-prompt scoping and #421's field-trigger path ended up
test-only. So the suite **constructs the divergence** rather than waiting for a
second real version: a synthetic version 2, defined in the test file and
injected into the registry, whose tool renames `field_key` to `field` and whose
wrapper text differs.

Tests that can fail:

1. **The pinned tool is sent.** A run pinning 1 sends entry 1's tool object; a
   run pinning 2 sends entry 2's. Fails if the engine reads the current entry
   instead of the run's.
2. **The pinned parser runs.** A v2-shaped answer (`field`) against a run
   pinning 2 yields a verified reference; the same answer against a run pinning
   1 yields none. Proves routing rather than asserting it.
3. **The gate ignores the version.** A v2 answer with `deviation` and no
   references still fails its unit with #422's message.
4. **The exported tool name tracks the current render.** Fails if a bump
   renames the tool and leaves the export behind.
5. **No entry is half-built.** Every registry entry has non-empty instructions,
   a tool with a name and an `input_schema`, and `maxTokens > 0`. A bumped
   `CURRENT_*` with no entry would otherwise render `undefined` as the system
   prompt, which the model would answer anyway.
6. **An unknown version throws before any model call** — carried over from
   #424, retargeted at the render.
7. **Null falls back to current** — carried over.
8. `openRun` stamps `render_version`; `workRun` reads it and hands it to the
   engine (the existing `run-worker.test.ts` case, renamed).

One correction in passing: `apps/workbench/tests/instruction-versions.test.ts`
mocks a tool named `report_field_audit_finding`. No such tool exists — the name
is `report_check`. The test passes only because it asserts on captured system
text, never on the finding, so the false fixture is invisible today and would
mislead in the neighbouring cases this slice adds.

## Explicitly out of scope

- **Changing any version-1 value.** The tool schema still has no `minItems` on
  `references`; #422's engine-side enforcement is what covers that, and adding
  a schema constraint is a v2 decision to take on its own evidence.
- **Versioning the gate.** Argued above.
- **Versioning `runPrompt`'s loop** (retry counts, concurrency, cache
  breakpoint placement). These shape cost and latency, not the question asked.
  Named so the omission reads as a decision.
- **The root app's `lib/reviewSlice/runReview.ts`**, which phase 15 deletes.
