# Funding Instructions Placeholder Map

Source form:

- `source-forms/transfers/cornerstone/funding-instructions_cv1.docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_funding_instructions.py
```

Generated template:

- `templates/funding-instructions.docx`

Package:

- `packages/funding-instructions.json`

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `The TRUST NAME and The TRUST NAME` (subtitle) | Married: `{{ client.full_name \| name }}` and `{{ spouse.full_name \| name }}`; individual: `{{ trust.display_name }}` |
| Titling format line (`TRUSTEE`, `COTRUSTEE`, `TRUST NAME`, date blanks) | Trustee name(s) + `{{ trust.name \| name }}` + `{{ trust.date }}` |

Most of the document is static educational/checklist content (asset-type tables, RMD chart, FAQ). Only the subtitle and titling-format example are client-specific.

## Conditional Logic

| Condition | Effect |
| --- | --- |
| `has_spouse` | Subtitle uses both client and spouse names instead of trust display name |
| `fiduciaries.trustee.co_primary.full_name` | Titling line includes co-trustee with “and” |

## Design Sheet Mapping

| Design sheet | Generator path |
| --- | --- |
| `estate_plan_design.ancillary_documents.funding_instructions` | `documents.include_funding_instructions` |
| Trust name / date | `trust.display_name`, `trust.date` |
| Initial trustee slots | `fiduciaries.trustee.primary`, `co_primary` |
| Client / spouse names | `client.full_name`, `spouse.full_name` |

## Generate

```bash
python3 al-generator.py generate \
  --data examples/client-ma-funding-instructions.json \
  --package funding-instructions \
  --state MA \
  --out output/ma-funding-instructions
```

## Known Gaps

| Gap | Notes |
| --- | --- |
| Subtitle placeholder ambiguity | Source uses `TRUST NAME` twice; mapped to client/spouse names when married, trust display name when single. Confirm with firm whether joint plans should show trust name instead. |
| Static checklist | Asset checklist rows are not driven by design-sheet asset schedules or account numbers |
| No per-asset personalization | Real property, retirement accounts, business interests, etc. are generic guidance only |
| Separate trusts (married individual) | No branch for `trust.spouse_display_name` or two trust names in subtitle |
| `funding_recommendation` | Sibling ancillary doc — hybrid template at `trust-funding-plan` (see `trust-funding-plan-placeholder-map.md`) |
