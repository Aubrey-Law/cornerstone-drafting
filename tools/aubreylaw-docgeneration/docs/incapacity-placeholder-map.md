# Incapacity Documents Placeholder and Logic Map

Source forms:

- `source-forms/incapacity/cornerstone/Power of Attorney_cv1.docx` (Cornerstone DPOA)
- `source-forms/incapacity/v1.1/Durable_Power_of_Attorney_v1.1.docx` (legacy bracket placeholders)
- `source-forms/incapacity/v1.1/HCP_v1.1.docx` (legacy)
- `source-forms/incapacity/v1.1/Living_Will_v1.1.docx` (legacy)
- `source-forms/incapacity/v1.1/HIPAA_v1.1.docx` (legacy)
- `source-forms/incapacity/cornerstone/Health Care Proxy_cv1.docx` (Cornerstone combined HCP + HIPAA + Living Will)

Convert Cornerstone templates:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_poa_doc.py
.venv/bin/python tools/convert_cornerstone_healthcare_docs.py
```

Generated templates:

- `templates/durable-power-of-attorney.docx` (from Cornerstone cv1)
- `templates/health-care-proxy.docx` (from Cornerstone cv1)
- `templates/living-will.docx` (from Cornerstone cv1)
- `templates/hipaa-authorization.docx` (from Cornerstone cv1)

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[CLIENT FULL NAME]` | `{{ client.full_name \| name }}` |
| `of Needham, Massachusetts` | `{{ client.city }}, {{ client.state }}` |
| `[Initial Health Care Proxy]` / `[Initial Attorney-in-Fact]` | `{{ fiduciaries.agent.primary.full_name \| name }}` |
| `[Successor Attorney-in-Fact]` | `{{ fiduciaries.agent.successor.full_name \| name }}` |
| `[DocDate]` | `{{ execution.display_doc_date }}` |
| `COUNTY OF [SIGNING COUNTY` | `{{ execution.display_signing_county \| name }}` |
| `[Notary Commission]` | `{{ execution.display_notary_commission }}` |
| `[CLIENT]` (legacy v1.1) | `{{ client.full_name \| name }}` |
| `[City]` (legacy v1.1) | `{{ client.city }}` |
| `[Street Address]` (legacy v1.1) | `{{ client.street_address }}` |
| `[Client DOB]` (legacy v1.1) | `{{ client.date_of_birth }}` |
| `[SIGNING COUNTY]` (legacy v1.1) | `{{ execution.display_signing_county \| name }}` |
| `[Ordinal_DocDate]` (legacy v1.1) | `{{ execution.display_ordinal_doc_date }}` |
| `[INITIAL POA]` (legacy v1.1) | `{{ fiduciaries.agent.primary.full_name \| name }}` |
| `[CO POA]` (legacy v1.1) | `{{ fiduciaries.agent.co_primary.full_name \| name }}` |
| `[SPOUSE]` (legacy v1.1) | `{{ spouse.full_name \| name }}` |
| `[PRIMARY HCP FULL NAME]` | `{{ healthcare.agent.primary.full_name \| name }}` |
| `[ALTERNATE 1 HCP FULL NAME]` | `{{ healthcare.agent.alternate.full_name \| name }}` |
| Cornerstone alternate 2 name | `{{ healthcare.agent.second_alternate.full_name \| name }}` |
| Cornerstone primary HCP phone/address/relationship | `healthcare.agent.primary.phone`, `.address`, `.relationship` |
| Cornerstone alternate HCP phone/address/relationship | `healthcare.agent.alternate.phone`, `.address`, `.relationship` |
| Cornerstone second alternate HCP fields | `healthcare.agent.second_alternate.*` (hidden when name is blank) |
| HIPAA trustee recipient | `{% if hipaa.include_trustees %}` trustee capacity sentence |
| `[ANATOMICAL GIFT]` | `healthcare.anatomical_gift` conditionals (not in Cornerstone cv1) |
| `[ANATOMICAL SPECIFIED]` | `{{ healthcare.anatomical_specified }}` |
| `[HIPAA PSYCHOTHERAPY NOTES]` | `hipaa.psychotherapy_notes` conditionals |

## Conditional Logic

| Condition | Trigger | Affected document |
| --- | --- | --- |
| `dpoa.include_entity_powers` | design sheet toggle | Durable POA Module A (§3.J–§3.L) |
| `dpoa.include_advanced_trust_gifting` | design sheet toggle | Durable POA Module B (amend trust + gifting) |
| `dpoa.include_extended_personal_care` | design sheet toggle | Durable POA Module C (§4.D–§4.F, §5.I) |
| `has_solo_poa` | no co-agent named | Durable POA solo-agent appointment (legacy v1.1 only) |
| `has_co_poa` | co-agent named | Durable POA co-agent appointment (legacy v1.1 only) |
| `co_poa_joint` | co-agents must act jointly | Durable POA joint authority paragraph (legacy v1.1 only) |
| `co_poa_separate` | co-agents may act separately | Durable POA separate authority paragraph (legacy v1.1 only) |
| `has_spouse` | spouse exists or spouse name present | Married-client POA powers (legacy v1.1 only) |
| `aif_has_spouse` | primary attorney-in-fact has spouse | POA self-dealing limitation (legacy v1.1 only) |
| `hcp_anatomical_all` | HCP anatomical gift election is `all` | Health Care Proxy broad anatomical gift sentence |
| `hcp_anatomical_specified` | HCP anatomical gift election is `specified` and details are present | Health Care Proxy specified anatomical gift sentence |
| `hcp_anatomical_none` | HCP anatomical gift election is `none` | Health Care Proxy refusal sentence |
| `hipaa_psychotherapy_authorized` | HIPAA psychotherapy notes election is `authorize` | HIPAA disclosure sentence includes psychotherapy notes |
| `signing_scheduled` | signing details are known | Execution date, signing county, and notary commission fields render actual values instead of blanks |

## Package

Generate the incapacity documents with:

```bash
python3 al-generator.py generate --data examples/client-ma-incapacity.json --package incapacity-documents --state MA --out output/ma-incapacity
```

For unscheduled signings, set:

```json
{
  "execution": {
    "signing_scheduled": false
  }
}
```

The generated documents will render blank execution fields:

- Signing date: `________________, 20__`
- Ordinal signing date: `_____ day of _________________, 20___`
- Signing county: `__________________________`
- Notary commission expiration: `_________________________`
