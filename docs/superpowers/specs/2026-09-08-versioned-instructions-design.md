# The instructions a run used are recorded — phase 4, eleventh slice

**Date:** 2026-09-08
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, eleventh sub-project
**Follows:** `2026-09-08-unsupported-findings-design.md`
**Status:** approach approved by the owner 2026-09-08

## The gap, and why it is not theoretical

A run records `prompt_version_id`, and the whole point of that is stated in
`lib/prompts/repository.ts`: finishing a run means answering the same question it originally
asked, even if the prompt has since been edited. `prompt_versions` is immutable for the same
reason.

**Half of what produces a finding is not covered by that.** `SYSTEM_INSTRUCTIONS` in
`packages/citations/src/fieldAudit/runFieldAudit.ts` — and its counterpart in
`review/runReview.ts` — is a module constant, captured in the `requestFor` closure. So the
question a check is actually asked is `body.checks[n].statement` **plus** whatever
instructions are deployed at the moment of the call.

And the call can happen later. `retryFailedSteps` sets a run's failed steps back to
`pending` and requeues it; the tick then works them through `runPrompt` with the currently
deployed constant. So **a run started before an instruction change and retried after it gets
a different question for the retried unit than its siblings answered**, and nothing records
that the two differ.

This was demonstrated today rather than imagined. The instructions changed twice in one
session: #422 added a null-claim rule and an enforcement note, and a second edit was written,
verified, and deleted only because it turned out to suppress a real finding. Either would
have silently changed what an old run meant on retry.

## What is recorded, and what is deliberately not

`workflow_runs.instructions_version`, an integer set at `openRun`, alongside a registry in
`packages/citations` keyed by that integer. The engine renders the version the run pinned
rather than the current constant, so retry asks the question the run was asking.

**The registry starts at version 1 — the text as it stands today.** It does not attempt to
reconstruct the earlier variants.

That is a deliberate refusal. `git log` shows the block changed in at least `0d42cc6a`,
`949771b3` and #422, but there is no record of which text any given historical run used, and
inferring it from timestamps against deploy times would produce a mapping that looks
authoritative and is a guess. Runs made before this slice therefore carry `NULL`, which reads
as *"made before the instructions were versioned"* — a gap stated rather than papered over.

One exception, because it is knowable rather than guessed: the single run currently in the
database was created under the present text, so it is backfilled to 1.

**A `NULL` run retried still gets the current text**, because there is nothing better to give
it. That is the pre-existing behaviour, now visible instead of invisible — the column says
the run predates versioning, so the inconsistency can be reasoned about instead of
discovered.

## Two registries, one column

The instructions are per **kind**, not per prompt: field-audit's are 1,516 characters about
quoting fields and referencing emptiness; review's are 751 about anchoring citations in a
document. They are the engine's contract with the model, which is why they are not going into
`prompt_versions.body` — that would duplicate kind-level content into prompt-level storage
and force a new version of all forty planned prompts every time a shared rule improved.

So each module owns its own registry and its own current version, and
`workflow_runs.kind` plus `instructions_version` together identify one text. One column,
because a run has one kind.

## What this costs

Historical text accumulates in the source file, and it has to: replay is the point, so the
old strings cannot be pruned to git history. A registry with ten entries will be a long file.
That is the price of the property, and the alternative — reconstructing from git at run time —
would make a model call depend on a repository checkout.

Changing the instructions also invalidates the prompt cache, since the `cache_control`
breakpoint sits on the sheet block after them. That is already true today; versioning does
not change it, and mixed-version runs in flight simply cache separately.

## Testing

- The engine renders the pinned version, not the current one — asserted by pinning an older
  version and checking the request carries that text. This is the whole property, so it is
  the test to write first.
- A `NULL` version falls back to current, and the fallback is asserted rather than assumed.
- An unknown version number is a hard error, not a silent fallback: a run pinning a version
  the registry has lost is a run nobody can honestly finish.
- `openRun` records the current version for the run's kind, for both kinds.
- Every registry entry is non-empty and the current version exists in its registry — the
  check that would catch a bump without a text.
- The column verified against the live database by `checkDbColumns.mjs` and the generated
  types.

## Out of scope, named

**Reconstructing the historical instruction texts.** Refused above, with reasons.

**Versioning the tool schema.** `FIELD_AUDIT_TOOL`'s `input_schema` is also un-versioned code
that shapes what the model can answer — the missing `minItems` on `references` was the
subject of #422. The same argument applies to it, and it is not addressed here. Named so the
next person sees the gap is narrower than closed.
