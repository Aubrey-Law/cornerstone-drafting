---
name: aubreylaw-doc-templates
description: Create or update templates, clauses, and package manifests for the Aubrey Law estate-planning document generator in this repo. Use whenever work touches the generator's template system — building a new template package (DOCX template + manifest + example payload + placeholder map), writing or editing a DOCX template with Nunjucks merge fields like {{ client.full_name | name }}, adding or revising reusable clause JSON, wiring a package into design-sheet document inclusions, or QA-scanning generated output for unresolved {{ }}, {% %}, bracket markers, and hidden Word field codes. Trigger even when the user only describes the task — "turn this firm will form into a generator template," "add a pet-trust clause," "the pour-over package is missing a field," "wire the new package so the design sheet picks it" — because the generator enforces canonical field names, package wiring, and a QA checklist easy to get wrong without these references.
---

# Aubrey Law Document Generator Templates

This skill maintains the artifacts that drive the estate-planning document
generator in this repo (`lib/estateGenerator/` + `tools/aubreylaw-docgeneration/`).
The single most important thing to understand is that **this is a wired system,
not a pile of Word documents**. A template only works if its merge fields are
*canonical* (drawn from the shared data dictionary), its package manifest
declares the right required fields and output order, its clauses are referenced
by ID, and — when the design sheet should produce it automatically — the
package is wired into the inclusion logic. Inventing a field name that "looks
right" silently breaks the pipeline, because nothing populates it.

So the default instinct here is to **look up, not guess**. The references
bundled with this skill are generated from the code itself and cannot drift;
read them before writing.

## The pipeline (what feeds what)

```
design_sheets (+ intake/contacts)                       ~180 columns + decisions JSON
  → lib/buildDraftPayload.ts (+ lib/draftPayload/*)     → DraftPayload
  → lib/estateGenerator/toGeneratorData.ts              → merge data + package selection
  → lib/estateGenerator/node/context.ts                 → derived flags, display fallbacks
  → lib/estateGenerator/node/generate.ts                → renders packages/*.json → DOCX
```

Templates never see the design sheet directly — they see the merge data plus
the derived context flags. The design sheet's job is to fill the payload; the
template's job is to branch on flags and print canonical fields.

## Bundled references

| File | What it gives you |
| --- | --- |
| `references/generated/fields.md` | Every canonical merge field (from the data dictionary) + which variables each template actually uses. |
| `references/generated/context-flags.md` | Every derived flag (`has_spouse`, `has_co_poa`, …) and defaulted/aliased value the context builder adds. |
| `references/generated/packages.md` | Every package manifest and the design-sheet inclusion-key → package selection rules. |
| `references/generated/clauses.md` | Every reusable clause: ID, source path, jurisdiction, condition flag, review status, full text. |
| `references/generated/missing-field-design-map.md` | Where the drafting UI sends the attorney for each missing field. |
| `references/conditional-patterns.md` | Hand-written: co-fiduciary guards, joint vs individual plans, spouse remaps, whitespace-safe conditionals. |
| `references/aliases-and-legacy.md` | Hand-written: legacy aliases to preserve (never "clean up"). |

The `generated/` files are produced by `npm run skill:refs` and checked by
`tests/skill-references-freshness.test.ts` — **re-run `npm run skill:refs`
after changing templates, clauses, manifests, the data dictionary, the context
builder, or package selection.** The dictionary itself
(`tools/aubreylaw-docgeneration/schemas/data-dictionary.json`) is the final
authority on field names.

## Step 1 — Figure out what's actually being asked

| If the user wants… | You'll produce… |
| --- | --- |
| A brand-new document type the generator can render | A **full package**: DOCX template, package manifest JSON, example payload JSON, placeholder map under `docs/`, plus any new clauses — and wiring into inclusion logic if it should auto-select. See Step 4. |
| To fix or extend an existing template | Edits to the **DOCX template** and, if a new field is involved, the corresponding manifest/data-dictionary/mapper updates so the field is actually populated. |
| Reusable legal language shared across documents | One or more **clause JSON files** (base, or MA override), referenced by templates via `include_clause`. See Step 5. |
| A package to start generating from design-sheet choices | The **inclusion wiring**: package selection in `deriveEstateGeneratorPackages()` plus `document_inclusions` connections. See Step 6. |
| To verify a generated document is clean | A **render + QA scan** of the output. See Step 7. |

If the request is ambiguous, ask one short clarifying question rather than
guessing and producing the wrong set of files.

## Step 2 — Ground every field name in the dictionary

Before writing any merge field, confirm it exists in
`references/generated/fields.md` (or the dictionary itself). Prefer reusing an
existing canonical field over creating a new one — client, spouse, children,
fiduciaries, will/trust provisions, and execution are all already defined. For
a one-off attorney-defined value, `{{ extras.* }}` flows straight through from
the design sheet's Additional Variables section with no code change.

When you genuinely need a new field, that's not just a template change — a
field only carries data if something fills it. The full chain:

1. Add it to `tools/aubreylaw-docgeneration/schemas/data-dictionary.json`.
2. Populate it in `lib/estateGenerator/toGeneratorData.ts` (and upstream in
   `lib/buildDraftPayload.ts` / `lib/draftPayload/*` if it comes from a new
   design-sheet column).
3. If it needs a derived flag or display fallback, add it in
   `lib/estateGenerator/node/context.ts`.
4. Add an exact entry in `lib/estateGenerator/missingFieldDesignMap.ts` so the
   drafting UI can route the attorney to the right design-sheet field.
5. Re-run `npx tsx scripts/extract-template-variables.ts` (it fails on any
   template root nothing populates) and `npm run skill:refs`.

Syntax essentials (renderer: Nunjucks over OOXML, `lib/estateGenerator/node/renderText.ts`):

- `{{ field.path }}` for values; add `| name` for uppercase legal names in
  headings, signature blocks, and footers: `{{ client.full_name | name }}`.
- `{% if flag %}…{% endif %}` and `{% for x in list %}…{% endfor %}` for logic.
- `{{ include_clause("clause.id") }}`, or
  `{{ include_clause("execution.self_proving_affidavit", state.code) }}` for a
  state-aware include.
- Bare `{{ path }}` placeholders are auto-wrapped with `orMissing`, so blanks
  render `[[ MISSING: field.path ]]`. That's a feature — don't hide a required
  value behind an empty conditional to suppress the marker. Only
  `execution.display_notary_commission` is `| optional` (renders empty).

## Step 3 — Editing the DOCX itself

Templates are DOCX files in `tools/aubreylaw-docgeneration/templates/`; edit
them by unzipping, editing `word/document.xml`, and rezipping (follow the
`docx` skill for OOXML mechanics). Firm conventions: Garamond 12 pt body,
Garamond 10 pt footer — the renderer normalizes fonts to Garamond, but write
them correctly anyway.

- Word splits `{{ … }}` across runs when it feels like it; the renderer repairs
  split tags (`repairSplitNunjucksInXml`), but when *you* edit XML, keep each
  tag inside a single `w:t` so the repair never has to guess.
- Table rows repeated per item use docxtpl-style row tags (`{%tr for … %}`)
  where present — copy the pattern from a sibling template.
- Footers may carry static markers `[CLIENT FULL NAME]` / `[CLIENT]` /
  `[TRUST NAME]`, replaced at render time — leave them alone.
- Never leave native Word field codes (MERGEFIELD/REF/IF instrText) in a
  template; freeze them to their literal text. The QA scanner catches these.

When converting a firm source form (`source-forms/`), replace every source
marker — `[CLIENT]`, MERGEFIELDs, fill-in blanks — with canonical merge
fields; convert sometimes-present paragraphs into `{% if %}` blocks on the
right flag; pull language shared across documents into clauses. When building
from scratch, copy the closest sibling template's structure. After any
template edit, run `npx tsx scripts/extract-template-variables.ts` and
`npx vitest run tests/docx-template-integrity.test.ts`.

## Step 4 — Building a full package

- **DOCX template(s)** under `templates/`, canonical fields and clause includes.
- **Package manifest** under `packages/<name>.json` — copy an existing
  manifest's shape (`name`, `description`, `required_fields`, `documents[]`
  with `id`/`title`/`template`/`output`). Keep `required_fields` to the minimum
  the document *truly* needs; conditional requirements belong in
  `lib/estateGenerator/node/packageValidation.ts`, not the manifest. Number
  outputs `01-…`, `02-…` in intended order.
- **Example payload** under `examples/` (name it `client-ma-<package>.json` so
  the render CLI finds it automatically), exercising the template's branches.
- **Placeholder map** under `docs/<name>-placeholder-map.md`: source-form
  marker → canonical field, plus the conditional-logic table.
- **New clauses** if the package introduces shared language (Step 5).
- **Tests**: extend `tests/node-estate-generator.test.ts` (rendered output) and
  `tests/draft-document-selection.test.ts` (selection) as appropriate.

## Step 5 — Writing or editing clauses

Check `references/generated/clauses.md` first — the language may already
exist, and duplicating it into a template instead of including the clause is a
classic pitfall. Base clauses live in `clauses/`; Massachusetts overrides live
in `states/MA/clauses/` and win when an override exists.

A clause JSON carries `id`, `title`, `document_type`, `jurisdiction` (`base`
or a state code), an optional `condition` flag (from context-flags.md), a
`review_status`, `required_fields`, and templated `text`. New legal language
you draft gets `"review_status": "draft"` — it has not been attorney-approved —
and clause text should keep to canonical fields and existing condition flags.
The app also mirrors clauses into the database (`npm run clauses:import`);
attorney force-include/omit overrides only work on clauses that have a
`condition`.

## Step 6 — Wiring a package into the design sheet

A package that should generate automatically needs three connections, or it'll
exist but never fire (see the selection table in
`references/generated/packages.md`):

1. **Inclusion key**: the design sheet stores toggles in
   `decisions.document_inclusions` — keys and labels in
   `lib/designSheetDocumentInclusions.ts` (add to
   `defaultDocumentInclusions()` if it should default on).
2. **Selection**: map the inclusion to the package in
   `deriveEstateGeneratorPackages()` (`lib/estateGenerator/toGeneratorData.ts`)
   and add the package name to `NODE_SUPPORTED_PACKAGES`
   (`lib/estateGenerator/node/support.ts`) and the package-name type union.
3. **Data remap**: if the package is spouse- or child-specific, handle it in
   `lib/estateGenerator/node/packageData.ts` (`dataForNodeEstatePackage()`) —
   `spouse-*` packages move the spouse into the `client` slot; young-adult
   packages generate once per qualifying child. Don't add spouse-specific
   fields without checking that remap first.

Then update `tests/design-sheet-document-inclusions.test.ts` and
`tests/draft-document-selection.test.ts`, and re-run `npm run skill:refs` (its
selection table cross-check fails if the code and table disagree).

## Step 7 — Render + QA before calling it done

The generator's whole value is producing clean drafts, so finish by verifying
output, not just inspecting the template:

```bash
# Render from the bundled example payload (no database needed)
npm run estate:render -- --package <name>            # or --example <path> --out <dir>

# Scan the generated output (visible text AND raw XML for hidden field codes)
python3 .claude/skills/aubreylaw-doc-templates/scripts/qa_scan.py \
  tools/aubreylaw-docgeneration/output/<name>/*.docx
```

A clean scan means no unresolved `{{ }}` or `{% %}`, no `[[ MISSING: ]]`
markers, no `[OPTIONAL]` or source-form `[BRACKET]` markers, and no hidden
MERGEFIELD/REF/IF field codes. The scanner is for **generated output** —
templates legitimately contain merge syntax. (`[[ MISSING: ]]` markers for
fields the example payload deliberately omits are expected; anything else
isn't.) The app's own scan (`lib/drafting/markerScan.ts`) blocks promotion of
dirty documents, so catch it here first.

Then run the test suites:

```bash
npx tsx scripts/extract-template-variables.ts
npx vitest run tests/node-estate-generator.test.ts tests/template-variable-catalog.test.ts \
  tests/docx-template-integrity.test.ts tests/skill-references-freshness.test.ts
```

And the judgment checks a regex can't make: fields truly canonical, manifest
required fields match the document, package selection wired, spouse/young-adult
remaps behave, conditional-only paragraphs don't leave blank lines, MA clause
overrides used where they exist.

## A note on legal content

You're generating starter templates and draft clause language to accelerate
attorney work, not final legal advice. Mark genuinely new legal language as
`draft`, preserve existing `approved`/`draft` review statuses on clauses you
touch, and surface where Massachusetts attorney review is required. The firm
reviews before production use.
