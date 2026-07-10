# Estate Plan Summary Placeholder Map

Source form (firm Cornerstone cv1 sample):

- `source-forms/estate/cornerstone/estate-plan-summary_cv1.docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_estate_plan_summary.py
```

Generated template:

- `templates/estate-plan-summary.docx`

Package:

- `packages/estate-plan-summary.json`

## Document purpose

Client-facing **structural overview** of the draft estate plan. Sections appear or hide based on which documents are in the package (`planning.include_*`). This is **not** asset-specific narrative (contrast with `trust-funding-plan`, which uses a hybrid AI narrative block).

## Template design: pure Jinja conditionals

| Mechanism | Use |
| --- | --- |
| `planning.include_trust` / `include_pour_over_will` / `include_dpoa` / `include_hcp` / `include_ahd` / `include_hipaa` / `include_ppm` | Show/hide entire document sections |
| `has_spouse` + `planning.spouse_docs` | Companion will / POA / HCP blocks and married table columns |
| `requires_guardian_clause` | Guardian nomination section |
| `has_children` + `{% for child in children %}` | Children list in trust distribution |
| `trust.descendants_distribution.method` | Staged vs outright withdrawal language |
| `trust.include_common_trust_for_children` + `has_minor_children` | Common trust paragraph |
| Missing-fiduciary warnings | `fiduciaries.*.successor.full_name == ''` etc. |

**Not used:** `funding_plan.narrative`, clause includes, or other hybrid AI injection.

## Key placeholders

| Field | Generator path | Notes |
| --- | --- | --- |
| Title names | `client.full_name`, `spouse.full_name` | `{% if has_spouse %}` married title |
| Document date | `execution.display_doc_date` | Blank when signing not scheduled |
| Trust identity | `trust.name`, `trust.display_date` | |
| Trustees | `fiduciaries.trustee.primary`, `co_primary`, `successor`, `second_successor` | Co-trustee branch for joint plans |
| Wills / PR | `fiduciaries.executor.*`, `fiduciaries.spouse_executor.*` | Per-spouse will blocks when `spouse_docs` |
| POA / HCP | `fiduciaries.agent.*`, `healthcare.agent.*`, spouse variants | |
| Guardians | `guardians.primary`, `successor`, `temporary.*` | `requires_guardian_clause` |
| Distribution | `trust.descendants_distribution.*`, `trust.special_distributions_age` | Staged ages from design sheet |
| Key people table | Married 4-column or single-client layout | Role / primary / spouse primary / successor |

## Design sheet mapping

| Design sheet | Generator path |
| --- | --- |
| `decisions.document_inclusions` | `planning.include_*` |
| `decisions.estate_plan_design.ancillary_documents.estate_plan_summary` | `documents.include_estate_plan_summary` → package gate |
| Fiduciary slots | `fiduciaries.*`, `healthcare.*` |
| Trust provisions | `trust.descendants_distribution`, `trust.include_common_trust_for_children`, `trust.provisions.*` |
| Guardian slots | `guardians.*` |

## Generate (manual test)

```bash
python3 al-generator.py generate \
  --data examples/client-ma-estate-plan-summary.json \
  --package estate-plan-summary \
  --state MA \
  --out output/ma-estate-plan-summary
```

Node / app path appends `estate-plan-summary` after other packages when `include_estate_plan_summary` is true (default).

## Known gaps

| Gap | Notes |
| --- | --- |
| Primary beneficiary / spousal funding narrative | Source sample has disclaimer/outright-to-spouse prose; template keeps simplified static branches — attorney may revise |
| Special provisions (remarriage, spendthrift, etc.) | Partially static from Cornerstone sample; not all `trust.provisions.*` toggles branch yet |
| `client.first_name` for table headers | Falls back to `client.full_name` when first name absent |
| Avoid `<` in Jinja conditions inside DOCX | Nunjucks parser treats `<` as tag open — use `loop.index != loop.length` instead of `<` comparisons |
| Programmatic fallback | `scripts/generate-estate-plan-summary-template.ts` superseded by Cornerstone conversion for production template |

## Related

- Design summaries (attorney export): `design-summary-placeholder-map.md`
- Trust funding plan (hybrid): `trust-funding-plan-placeholder-map.md`
