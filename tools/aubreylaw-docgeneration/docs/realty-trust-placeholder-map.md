# Realty Trust Placeholder Map

Source form:

- `source-forms/trust/cornerstone/Realty Trust.docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_realty_trust.py
```

Generated template:

- `templates/real-estate-trust.docx`

Pipeline:

- Real-estate transfer renderer (`renderRealEstateTransferDocx`) via `documents.include_real_estate_trust`
- Flat `{field}` merge (docxtemplater), **not** Jinja

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[REALTY TRUST NAME]` | `{trust_name}` |
| `[NAME OF TRUSTEE]` / `[TRUSTEE]` | `{trustees}` |
| `[OrdinalDocDate]` / `[DocDate]` | `{execution_date}` |
| `[PROPERY COUNTY]` | `{property_county}` |
| `[SIGNING COUNTY]` | `{certificate_execution_county}` |
| `[BENEFICIARY]` | `{beneficial_owners}` |
| `[NUMBER OF YEARS OF SUCCESSIVE TRUST TERM]` | `{trust_term_extension_years}` (default `21`) |
| `[his/her/their]` | `their` (static — no pronoun field yet) |

## Design Sheet Mapping

| Design sheet | Template field |
| --- | --- |
| `decisions.real_estate_transfer.realtyTrustName` | `trust_name` |
| `decisions.real_estate_transfer.realtyTrustDate` | `trust_date` |
| Trustee contact selection | `trustees` |
| `beneficialOwners[]` | `beneficial_owners` (semicolon-joined `Name (pct%)`) |
| Deed / property fields | `property_*`, `legal_description`, etc. |

## Generate (test)

```bash
# Node docxtemplater smoke test
node -e "
const fs = require('fs');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const fields = require('./examples/client-ma-realty-trust.json');
const keys = Object.keys(fields);
const data = Object.fromEntries(keys.map(k => [k, fields[k] ?? '']));
const doc = new Docxtemplater(new PizZip(fs.readFileSync('templates/real-estate-trust.docx')), {paragraphLoop:true, delimiters:{start:'{',end:'}'}});
doc.render(data);
fs.writeFileSync('output/real-estate-trust-test.docx', doc.getZip().generate({type:'nodebuffer'}));
"
```

## Known Gaps

| Gap | Notes |
| --- | --- |
| Trustee pronouns | Source uses `[his/her/their]`; template hard-codes `their` |
| Dual trustee / dual notary blocks | Source has two signature and notary sections; no conditional hide when single trustee |
| Beneficiary schedule rows | `{beneficial_owners}` is one string; no per-row table repeat |
| Successive term years | Field added with default `21`; not exposed in Transfers UI |
| `trustees_certificate` template | Separate doc (`trustees-certificate.docx` under M.G.L. c. 184 § 35); not updated in this pass |
