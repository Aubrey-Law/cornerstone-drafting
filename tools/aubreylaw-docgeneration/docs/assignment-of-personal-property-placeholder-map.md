# Assignment of Personal Property Placeholder Map

Source form:

- `source-forms/transfers/cornerstone/assignment-pp_cv1.docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_assignment_pp.py
```

Generated template:

- `templates/assignment-of-personal-property.docx`

Package:

- `packages/assignment-of-personal-property.json`

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[CLIENT]` | `{{ client.full_name \| name }}` |
| `[ADDRESS]` | `{{ client.street_address }}, {{ client.city }}, {{ client.state }}` |
| Trustee grantee line | `{{ fiduciaries.trustee.primary.full_name \| name }}` + optional co-trustee |
| `[TRUST NAME]` | `{{ trust.display_name }}` |
| `[DocDate]` (body) | `{{ execution.doc_date }}` |
| `[SIGNING COUNTY]` | `{{ execution.signing_county \| name }}` |
| `[client heshe]` | `{{ client.pronoun_subject }}` |
| `[Notary Commission]` | `{{ execution.notary_commission }}` |

## Conditional Logic

| Condition | Effect |
| --- | --- |
| `fiduciaries.trustee.co_primary.full_name` | Adds co-trustee name and pluralizes “Trustee(s)” |

## Design Sheet Mapping

| Design sheet | Generator path |
| --- | --- |
| `estate_plan_design.ancillary_documents.assignment_of_personal_property` | `documents.include_assignment_of_personal_property` |
| Trust name / date | `trust.display_name`, `trust.date` |
| Initial trustee slots | `fiduciaries.trustee.primary`, `co_primary` |
| Client address | `client.street_address`, `client.city`, `client.state` |

## Generate

```bash
python3 al-generator.py generate \
  --data examples/client-ma-assignment-pp.json \
  --package assignment-of-personal-property \
  --state MA \
  --out output/ma-assignment-pp
```

## Known Gaps

| Gap | Notes |
| --- | --- |
| Joint grantors | Template is single assignor (`I, [CLIENT]`); no `has_spouse` branch |
| Spouse as co-trustee only | Co-trustee conditional exists; joint-trust grantor wording not modeled |
