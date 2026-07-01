# Individual Single Revocable Trust Placeholder and Logic Map

Source form:
`source-forms/trust/Individual-Single Revocable Trust.docx`

Generated template:
`templates/trust-individual-single.docx`

## Identified Placeholders

| Source text | Template field |
| --- | --- |
| `[TRUST NAME]` | `{{ trust.name \| name }}` |
| `[CLIENT]` | `{{ client.full_name \| name }}` |
| `[DocDate]` in agreement-date references | `{{ trust.display_date }}` |
| `[DocDate]` in signature and notary blocks | `{{ execution.display_doc_date }}` |
| `[CHILD]` | loop over `children` |
| `[DISINHERIT]` | loop over `trust.disinherited` |
| `[COUNTY]` | `{{ execution.display_signing_county \| name }}` |
| `[ID_TYPE]` | `{{ execution.id_type }}` |
| `[NotaryExpiration]` | `{{ execution.display_notary_commission }}` |
| `[he/she]` | `{{ client.pronoun_subject }}` |
| `[his/her/their]` | `{{ client.pronoun_possessive }}` |
| `[CONTINGENT_BENEFICIARY]` | `{{ trust.contingent_beneficiary.full_name \| name }}` |
| `[FIRST_SUCCESSOR_TRUSTEE]` | `{{ fiduciaries.trustee.primary.full_name \| name }}` |
| `[SECOND_SUCCESSOR_TRUSTEE]` | `{{ fiduciaries.trustee.successor.full_name \| name }}` |
| `[THIRD_SUCCESSOR_TRUSTEE]` | `{{ fiduciaries.trustee.second_successor.full_name \| name }}` |

## Conditional Logic

| Condition | Trigger | Affected language |
| --- | --- | --- |
| `has_children` | one or more children listed | Family information child declaration |
| `trust.disinherited` | one or more disinherited persons listed | Specific disinheritance paragraph |
| `trust.tangible_personal_property.distribution_method == "equal_shares"` | equal-share TPP plan | Equal-share tangible personal property subparagraph |
| `trust.tangible_personal_property.distribution_method == "priority_order"` | priority-order TPP plan | First-survivor tangible personal property subparagraph |
| `trust.descendants_distribution.method == "outright"` | outright descendant distribution | Outright distribution provision |
| `trust.descendants_distribution.method == "staged"` | staged-age withdrawal plan | Staged withdrawal provisions |
| `trust.remote_beneficiaries.individuals` | named remote beneficiaries listed | Named individual remote-beneficiary fallback |
| `trust.remote_beneficiaries.charity.name` | charity listed | Charitable remote-beneficiary fallback |
| `fiduciaries.trustee.co_trustees_action` | `joint` or `independent` | Co-trustee manner of acting provision |

## Package

Generate the trust document with:

```bash
python3 al-generator.py generate --data examples/client-ma-trust-individual-single.json --package trust-individual-single --state MA --out output/ma-trust-individual-single
```

## Review Notes

- The source document is Massachusetts-specific and for an unmarried individual grantor.
- The generated template preserves the firm form structure and replaces bracketed drafting fields with generator placeholders and conditional branches.
- `trust.display_date` renders `trust.date` when known and `________________, 20___` when the trust date is unknown.
- Legal text was preserved as source material where possible, but the generated template remains a draft automation template requiring Massachusetts attorney review before client use.
