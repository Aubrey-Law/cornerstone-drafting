# Aliases and legacy compatibility — document, don't remove

The generator carries deliberate aliases so older templates keep rendering.
**Rule: no template-wide renames.** Write new templates with the preferred
names below; leave existing templates' legacy usage alone unless you're already
editing that exact passage.

## Execution raw ↔ display aliases

`lib/estateGenerator/node/context.ts` computes display fields with blank
fill-in fallbacks, then aliases the raw fields to them because some legacy
templates still reference the raw names:

| Preferred (new templates) | Legacy alias | Fallback when unsigned/unscheduled |
| --- | --- | --- |
| `execution.display_doc_date` | `execution.doc_date` | `________________, 20___` |
| `execution.display_ordinal_doc_date` | `execution.ordinal_doc_date` | `_____ day of _________________, 20___` |
| `execution.display_signing_county` | `execution.signing_county` | `__________________________` |
| `execution.display_notary_commission` | `execution.notary_commission` | `__________________________` (also the only `| optional` field) |

The fallbacks only apply when no signing is scheduled (`signing_scheduled`
gating) — so an unscheduled render produces a signable paper form, not
`[[ MISSING ]]` markers.

## `trust.name` vs `trust.display_name`

Both exist. `trust.display_name` (with `trust.display_date`) is the formatted,
client-facing form and is what new templates should use for prose;
`trust.name` is the raw name and is what the footer's static `[TRUST NAME]`
marker substitution uses (`lib/estateGenerator/node/templateRenderer.ts`).
Clause previews fall back `display_name || name`. Don't "unify" them.

## Legacy filter and footer markers

- `| NAME` (uppercase) is a legacy alias of `| name`, and `{{ CLIENT.FULL_NAME }}`
  is aliased for old firm master footers (`lib/estateGenerator/node/renderText.ts`).
  Write `{{ client.full_name | name }}` in new work; leave legacy usage be.
- Footers may contain static bracket markers `[CLIENT FULL NAME]`, `[CLIENT]`,
  `[TRUST NAME]` that the renderer replaces outside Nunjucks. They are not
  source-form leftovers — the QA scanner knows the difference because it scans
  *rendered* output, where they've been substituted.

## Frozen cross-references

Six templates (`pourover-will`, `durable-power-of-attorney`,
`health-care-proxy`, `indv-disclaimer-trust`, `joint-trust`,
`joint-trust-simplified`) contain cross-reference literals ("Section 2.02",
"Article Eight(9)", etc.) frozen from the source forms' Word REF fields — the
generator never recalculates Word fields, so the literals match what always
rendered. If a template's articles/sections are ever renumbered, update its
frozen literals by hand. Legitimate PAGE / TOC / PAGEREF fields remain and are
fine; the QA scanner only flags MERGEFIELD/REF/IF/DOCVARIABLE/FILLIN/ASK.

## Unreachable/legacy packages

- `core-estate` has a manifest but is not in `NODE_SUPPORTED_PACKAGES` and is
  never selected — treat it as legacy; don't wire new work through it.
- `design-summary` is generated from its own design-sheet action, not via
  `deriveEstateGeneratorPackages()`.
- The real-estate transfer documents (`deed.docx`, `deed-landcourt.docx`,
  `nominee-trust.docx`, `real-estate-trust.docx`, `trustees-certificate.docx`)
  belong to a **different renderer** (docxtemplater, single-brace `{grantor}`
  fields — `lib/realEstateTransfer/`). This skill's rules do not apply to them.
