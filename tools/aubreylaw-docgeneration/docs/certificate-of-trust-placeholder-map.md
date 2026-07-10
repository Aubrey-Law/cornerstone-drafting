# Certification of Trust Placeholder Map

Source form:

- `source-forms/transfers/cornerstone/certificate-trust_cv1.docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_certificate_trust.py
```

Generated template:

- `templates/certificate-of-trust.docx`

Package:

- `packages/certificate-of-trust.json`

**Note:** This is the revocable-trust certification under M.G.L. c. 203E § 1013. It is **not** the realty-trust trustee's certificate (`trustees-certificate.docx`, c. 184 § 35).

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[TRUST NAME]` | `{{ trust.display_name }}` |
| `[DocDate]` | `{{ execution.doc_date }}` / `{{ execution.ordinal_doc_date }}` (notary) |
| `[GRANTOR]` | `{{ client.full_name \| name }}` |
| `[GRANTOR ADDRESS]` | Client address lines |
| `[INITIAL TRUSTEE]` | `{{ fiduciaries.trustee.primary.full_name \| name }}` |
| `[CO-TRUSTEE]` | `{{ fiduciaries.trustee.co_primary.full_name \| name }}` |
| Title-to-assets line | Primary + optional co-trustee as trustees of trust |
| `[SIGNING COUNTY]` | `{{ execution.signing_county \| name }}` |
| `[NotaryExpiration]` | `{{ execution.notary_commission }}` |
| Multi-trustee paragraph | Conditional on co-trustee |
| Co-trustee notary block | Wrapped in `{% if fiduciaries.trustee.co_primary.full_name %}` |

## Design Sheet Mapping

| Design sheet | Generator path |
| --- | --- |
| `estate_plan_design.ancillary_documents.certificate_of_trust` | `documents.include_certificate_of_trust` |
| Trust name / date | `trust.display_name`, `trust.date` |
| Trustee slots | `fiduciaries.trustee.primary`, `co_primary` |

## Generate

```bash
python3 al-generator.py generate \
  --data examples/client-ma-certificate-of-trust.json \
  --package certificate-of-trust \
  --state MA \
  --out output/ma-certificate-of-trust
```

## Known Gaps

| Gap | Notes |
| --- | --- |
| Joint grantors | Source “Grantors” plural / revocability line not branched for joint trust |
| Irrevocable trusts | Template assumes revocable trust |
| Irrevocable / special powers | Fixed statutory powers paragraph; no trust-provision toggles |
| Spouse package | No `spouse-certificate-of-trust` variant |
