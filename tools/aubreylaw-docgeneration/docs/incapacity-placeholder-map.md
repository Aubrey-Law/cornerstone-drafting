# Incapacity Documents Placeholder and Logic Map

Source forms:

- `source-forms/incapacity/v1.1/Durable_Power_of_Attorney_v1.1.docx`
- `source-forms/incapacity/v1.1/HCP_v1.1.docx`
- `source-forms/incapacity/v1.1/Living_Will_v1.1.docx`
- `source-forms/incapacity/v1.1/HIPAA_v1.1.docx`

Generated templates:

- `templates/durable-power-of-attorney.docx`
- `templates/health-care-proxy.docx`
- `templates/living-will.docx`
- `templates/hipaa-authorization.docx`

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[CLIENT]` | `{{ client.full_name \| name }}` |
| `[City]` | `{{ client.city }}` |
| `[Street Address]` | `{{ client.street_address }}` |
| `[Client DOB]` | `{{ client.date_of_birth }}` |
| `[SIGNING COUNTY]` | `{{ execution.display_signing_county \| name }}` |
| `[DocDate]` | `{{ execution.display_doc_date }}` |
| `[Ordinal_DocDate]` | `{{ execution.display_ordinal_doc_date }}` |
| `[Notary Commission]` | `{{ execution.display_notary_commission }}` |
| `[INITIAL POA]` | `{{ fiduciaries.agent.primary.full_name \| name }}` |
| `[CO POA]` | `{{ fiduciaries.agent.co_primary.full_name \| name }}` |
| `[SPOUSE]` | `{{ spouse.full_name \| name }}` |
| `[PRIMARY HCP FULL NAME]` | `{{ healthcare.agent.primary.full_name \| name }}` |
| `[ALTERNATE 1 HCP FULL NAME]` | `{{ healthcare.agent.alternate.full_name \| name }}` |
| `[ANATOMICAL GIFT]` | `healthcare.anatomical_gift` conditionals |
| `[ANATOMICAL SPECIFIED]` | `{{ healthcare.anatomical_specified }}` |
| `[HIPAA PSYCHOTHERAPY NOTES]` | `hipaa.psychotherapy_notes` conditionals |

## Conditional Logic

| Condition | Trigger | Affected document |
| --- | --- | --- |
| `has_solo_poa` | no co-agent named | Durable POA solo-agent appointment |
| `has_co_poa` | co-agent named | Durable POA co-agent appointment |
| `co_poa_joint` | co-agents must act jointly | Durable POA joint authority paragraph |
| `co_poa_separate` | co-agents may act separately | Durable POA separate authority paragraph |
| `has_spouse` | spouse exists or spouse name present | Married-client POA powers |
| `aif_has_spouse` | primary attorney-in-fact has spouse | POA self-dealing limitation |
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
