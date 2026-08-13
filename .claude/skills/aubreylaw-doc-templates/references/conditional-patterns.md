# Conditional-logic patterns

Hand-written companion to `generated/context-flags.md`. These are the load-bearing
patterns for design-sheet-driven conditionals; copy them from working templates
rather than inventing variants.

## Single vs co-fiduciary

Co-fiduciary slots (`co_primary`, `co_successor`, `second_successor`,
`co_second_successor`) are only present when the design sheet assigns them, so
guard with `is defined` **and** a truthiness check on `full_name` — a slot can
exist with an empty name while the sheet is in progress:

```
I nominate {{ fiduciaries.executor.primary.full_name | name }}{% if
fiduciaries.executor.co_primary is defined and
fiduciaries.executor.co_primary.full_name %} and
{{ fiduciaries.executor.co_primary.full_name | name }}{% endif %}, as Personal
Representative…
```

The design sheet's structure choices arrive as values and flags:

- `will.pr_structure` — `single` (default) | `spouse_first` | `co_pr`. When it
  is `co_pr`, `lib/estateGenerator/node/packageValidation.ts` requires
  `fiduciaries.executor.co_primary.full_name` for the will packages, so the
  gap is reported even though the manifest doesn't list it. Add new
  conditional requirements there, not in manifests.
- POA co-agents: `has_co_poa` / `has_solo_poa`, with the acting standard as
  `co_poa_joint` / `co_poa_majority` / `co_poa_separate` (from
  `poa.co_agents_action`). Phrase both branches explicitly — templates use
  `{% if has_co_poa %}…{% endif %}{% if has_solo_poa %}…{% endif %}` rather
  than an `else` when the two texts differ structurally.
- Co-trustees: `fiduciaries.trustee.co_trustees_action` is `majority` or
  `unanimous`; testamentary trusts use
  `testamentary_trust.trustee_structure === 'co_trustees'` (which conditionally
  requires `fiduciaries.testamentary_trustee.co_primary.full_name`).

Grammar around the guard matters: keep conjunctions and commas *inside* the
conditional (`{% if … %} and {{ … }}{% endif %},`) so the single-fiduciary
rendering reads correctly.

## Joint vs individual plans

Couple-vs-individual is handled by **separate templates selected per matter
type**, not by one template full of branches
(`deriveEstateGeneratorPackages()` in `lib/estateGenerator/toGeneratorData.ts`):

| Matter type | Trust package |
| --- | --- |
| `married_joint` | `joint-trust` (or `joint-trust-simplified` when `trust.separate_trusts`) |
| `married_individual` + `trust_planning_type === 'disclaimer'` | `indv-disclaimer-trust` |
| anything else | `trust-individual-single` |

Joint templates are written in the first-person plural ("the Grantors") and may
loop blended-family lists (`trust.blended_family.client_children` /
`.spouse_children`); individual templates are first-person singular and branch
on `has_spouse` (`{% if has_spouse %}I am married to
{{ spouse.full_name | name }}.{% else %}I am not married.{% endif %}`). Don't
try to make one template serve both voices — add the right template to the
right package instead.

## Spouse and child document remaps

`spouse-*` packages (spouse pour-over will, spouse incapacity documents, spouse
testamentary-trust will) reuse the *same templates* as the client versions —
`dataForNodeEstatePackage()` in `lib/estateGenerator/node/packageData.ts` swaps
the spouse into the `client` slot (and the client into `spouse`) before
rendering. Consequences:

- Inside a template, always write `client.*` / `fiduciaries.*` — never
  `spouse.*` for the document's own subject.
- Spouse-specific fiduciary choices come from the `spouse_*_slots` design-sheet
  columns and are remapped the same way; check the remap before adding any
  spouse-specific field.
- `young-adult-estate-plan` renders once per qualifying child (DOB age
  17.5–25), with the child moved into `client`.

## Clause add/remove

Two equivalent mechanisms — don't stack them redundantly:

1. The clause's own `condition` (e.g. `"condition": "has_pet_care"`): the
   clause body is dropped when the flag is falsy, and the attorney can
   force-include/omit it from the app (overrides *require* a condition).
2. A call-site guard: `{% if has_pet_care %}{{ include_clause("will.pet_care") }}{% endif %}`.

Prefer the clause-level `condition` for whole-clause on/off (it's visible in
the clause admin UI); use call-site guards when the same clause appears in
different spots per document. Branching *inside* clause text is fine
(`will.pet_care` branches on `will.pet_care.option == "direct_bequest"` vs
`"pet_trust"`).

## Whitespace-safe conditionals

A conditional paragraph that renders empty must not leave a blank line. In the
document XML, put the `{% if %}`/`{% endif %}` tags **inside** the paragraph
they control when the conditional wraps inline text, and around whole
`<w:p>` elements when it controls entire paragraphs — so an omitted branch
removes the paragraph mark too. When in doubt, render both branches with
`npm run estate:render` and read the output; blank-line gaps are a QA failure
even though the scanner can't see them.
