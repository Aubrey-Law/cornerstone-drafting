# Nominee Trust (No Real Trust) Placeholder Map

Source form:

- `source-forms/trust/cornerstone/Nominee Trust (No Real Trust).docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_nominee_trust.py
```

Generated template:

- `templates/nominee-trust.docx`

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[NOMINEE TRUST NAME]` | `{trust_name}` |
| `[NAME OF TRUSTEE]` | `{trustees}` |
| `[NAME OF SECOND TRUSTEE]` | `{co_trustee}` |
| `[NAME OF PRIMARY SUCCESSOR TRUSTEE]` | `{successor_trustee}` |
| `[NAME OF SECONDARY SUCCESSOR TRUSTEE]` | `{second_successor_trustee}` |
| `[CITY]` / `[STATE]` | `{trustee_city}` / `{trustee_state}` |
| `[NAME OF BENEFICIARY 1]` | `{beneficiary_1}` |
| `[NAME OF BENEFICIARY 1'S REVOCABLE TRUST]` | `{beneficiary_1_trust}` |
| `[NAME OF BENEFICIARY 2]` | `{beneficiary_2}` |
| `[NAME OF BENEFICIARY 2'S REVOCABLE TRUST]` | `{beneficiary_2_trust}` |
| `[____]%` | `{beneficiary_percent}` |
| `[DocDate]` / `[OrdinalDocDate]` | `{execution_date}` |
| `[SIGNING COUNTY]` | `{certificate_execution_county}` |
| Pronoun brackets | Static `they` / `them` / `their` |

## Known Gaps

| Gap | Notes |
| --- | --- |
| **Not wired to draft pipeline** | No `include_nominee_trust` flag or package; template only |
| Beneficiary rows | Only two beneficiary slots; no table loop |
| Successor trustee fields | `{successor_trustee}` etc. not populated by `buildTemplateFields()` |
| Notary date blanks | Source `_____ day of _______________, 2026` left manual |
| Second trustee notary block | Always present; no conditional on `{co_trustee}` |
