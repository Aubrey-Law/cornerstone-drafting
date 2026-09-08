# An unsupported finding is a failed unit — phase 4, tenth slice

**Date:** 2026-09-08
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, tenth sub-project
**Follows:** `2026-09-08-drafting-notes-audit-design.md`
**Status:** direction approved by the owner 2026-09-08

## The drift, explained

Across five runs of `ma-design-sheet-audit` check 1 against an **unchanged** design sheet,
the verified reference count read **4, 0, 5, 5** (and the earlier whole-run figures wobbled
the same way). That variance has been unexplained since the feature shipped, and it is why
#418 exists: on the 0-run, the gate correctly refused an uncitable blocker and the
withdrawal step retired the previous run's task anyway, leaving a live matter with no
blocker at all.

The variance itself is model behaviour. **What turns it into silence is a defect, and that
part is verified:**

1. The prompt states a rule — *"Do not report a deviation or an absence you cannot
   reference. An unsupported finding is worse than a missed one."*
2. The tool schema permits breaking it. `references` is `required`, but there is **no
   `minItems`**, so `references: []` validates.
3. Nothing enforces it. `findingForCheck` reads
   `Array.isArray(input.references) ? input.references : []` and hands back a finished
   finding with an empty array — no error, no retry.
4. So `actionableFindings` refuses it later, correctly, and a `blocker`-severity deviation
   sits in the database supported by nothing, producing no task.

**A prompt rule that nothing enforces is not a rule.** That is the whole defect.

## Why this check in particular

Its evidence is an *absence*. In the one surviving good run, **four of the five references
are null-claims on fields confirmed empty** — `marital_trust_type`,
`residual_beneficiary_individuals`, `residuary_beneficiary`, `residuary_distribution` —
with only `concerns` quoted as text.

But the instructions document the null-claim convention **only for the `absent` outcome**:

> If the sheet is silent on the point, the outcome is "absent" — reference the field with a
> null claimed_value rather than referencing something adjacent.

A `deviation` resting on empty fields therefore requires the model to carry that convention
to an outcome the prompt never mentions it for. Sometimes it does and cites four or five
fields; sometimes it writes the same conclusion in prose and cites nothing. The
zero-reference run's rationale named all four empty fields **in prose** while referencing
none — so the model had the facts and did not express them as references. (That rationale is
from the session record; the run was deleted in cleanup and cannot be re-queried.)

## The fix, and the distinction that does the work

**Zero references emitted is a protocol violation, not a finding.** The model did not
attempt support. `findingForCheck` throws, which
`runPrompt` already treats as the one way a unit fails — it catches whatever `findingFor`
threw, records the message as the failure reason, and settles the step `ok: false`. So the
unit becomes a visible, retryable failure with **no new machinery**, and #418 already made
retries safe.

**References emitted but none verified stays a finding.** The model tried and got it wrong;
that is exactly what the verification gate is for, and #418 already ensures such a finding
withdraws nothing. Conflating the two would turn a substantive disagreement into a retry
loop.

The line is drawn on **emitted** references — after dropping entries with no `field_key`,
before considering verification status. At least one usable reference was offered, whatever
became of it.

Only `deviation` and `absent` are held to this. A `compliant` or `not_applicable` outcome
legitimately rests on nothing needing citation, and forcing references there would invite
invented ones.

## And the instruction gets fixed too

Enforcement alone would convert a silent gate-failure into a retry, which is better but
still wasteful: the retry would face the same instruction that produced the omission. So the
convention is stated for any finding whose support is an absence, not only for `absent`.

This is a **code** change, not a new prompt version: `SYSTEM_INSTRUCTIONS` lives in
`packages/citations/src/fieldAudit/runFieldAudit.ts`, not in `prompt_versions.body`.

### Which surfaces something worth recording

The checks are versioned data; the instructions are un-versioned code. So editing them
changes how **every** field-audit prompt behaves, including how a run pinned to version 1
would behave if re-executed today. The provenance guarantee this project built — a run
records `prompt_version_id` so it stays interpretable against exactly what produced it — is
therefore partial: the body is pinned, the instructions are not.

Not fixed here, and not a reason to avoid the change: the current instructions are wrong in
a way that costs real findings, and leaving them wrong to preserve a guarantee they already
break is the worse trade. Named so the next person does not discover it.

## Testing

- A `deviation` with zero emitted references **throws**, and the message names the check and
  says what was missing — it lands in `workflow_run_steps.last_error` and on the run page.
- The same for `absent`.
- A `deviation` with one **unverified** reference does **not** throw — the substantive case
  must survive, or the gate loses its job to a retry loop.
- `compliant` and `not_applicable` with zero references do not throw.
- A reference with an empty `field_key` does not count as emitted, since it is dropped before
  the count.
- The engine already turns the throw into a failed, retryable unit — asserted through
  `runPrompt` rather than assumed from its comment.
- **Measured against production, before and after**, on the same unchanged sheet. The rate is
  the only thing that says whether the instruction change helped, and one run proves nothing
  either way.

## Out of scope, named

**Versioning the instructions.** Recorded above as a real gap in the provenance guarantee.

**`minItems` in the tool schema.** Considered: it cannot be made conditional on `outcome` in
plain JSON Schema, and applying it unconditionally would force references onto `compliant`
and `not_applicable` findings — inviting invented ones. Enforcement in code can see the
outcome; the schema cannot.

**Why the model makes the leap on some calls and not others.** Inherent variance. This slice
makes the variance visible and retryable instead of silent; it does not remove it.
