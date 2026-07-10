# Homestead Trustee Placeholder Map

Source form:

- `source-forms/transfers/cornerstone/homestead-trustee_cv1.docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_homestead_trustee.py
```

Generated template:

- `templates/homestead-trustee.docx`

Package:

- `packages/homestead-trustee.json`

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[Trustee Full Name(s)]` | `fiduciaries.trustee.primary` + optional `co_primary` |
| `[Trust Name]` | `{{ trust.display_name }}` |
| `[Trust Date]` | `{{ trust.date }}` |
| Trust instrument Book / Page | `{{ homestead.trust_deed_book }}`, `{{ homestead.trust_deed_page }}` |
| `[Beneficiary Name(s)]` | `{{ homestead.beneficiary_names }}` |
| `[Beneficiary Name]` | `{{ homestead.primary_beneficiary_name }}` |
| `[Spouse Name]` | `{{ spouse.full_name \| name }}` (spouse occupant line) |
| `[Servicemember Name(s)]` | `{{ homestead.servicemember_names }}` (conditional block) |
| Property address | `{{ homestead.property_address_line }}` |
| Deed registry / book / page | `homestead.deed_registry_district`, `deed_book`, `deed_page` |
| Land court refs | `homestead.certificate_number`, `land_court_document_number` |
| `[OrdinalDocDate]` | `{{ execution.ordinal_doc_date }}` |
| `[SINGING COUNTY]` | `{{ execution.signing_county \| name }}` |
| Trustee signatures | Primary + conditional co-trustee |

## Design Sheet Mapping

| Design sheet | Generator path |
| --- | --- |
| `estate_plan_design.ancillary_documents.homestead_trustee` | `documents.include_homestead_trustee` |
| Trust name / date | `trust.display_name`, `trust.date` |
| Trustee slots | `fiduciaries.trustee.primary`, `co_primary` |
| `decisions.real_estate_transfer.deedFields` | `homestead.property_address_line`, deed recording fields |
| `decisions.real_estate_transfer.beneficialOwners` | `homestead.beneficiary_names` |
| Client / spouse names | Fallback beneficiary names when beneficial owners unset |
| Signing fields | `execution.*` |

## Generate

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python al-generator.py generate \
  --data examples/client-ma-homestead-trustee.json \
  --package homestead-trustee \
  --state MA \
  --out output/ma-homestead-trustee
```

## Known Gaps

| Gap | Notes |
| --- | --- |
| Elderly / disabled paragraphs | Always render with beneficiary names; attorney checks applicable boxes manually |
| Servicemember block | Hidden when `homestead.servicemember_names` is empty |
| Trust instrument recording | `trust_deed_book` / `trust_deed_page` not in design sheet yet — blank by default |
| Land court document number | Not extracted from deed upload yet |
| Third trustee signature line | Removed; source had three lines for up to three trustees |
| Joint trust / multiple beneficiaries | Spouse occupant line uses `has_spouse`; no per-beneficiary repeat rows |
