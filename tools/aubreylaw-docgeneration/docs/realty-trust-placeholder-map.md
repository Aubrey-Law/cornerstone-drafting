# Realty Trust Placeholder Map

Source form:

- `source-forms/trust/cornerstone/Realty Trust.docx`

Template:

- `templates/real-estate-trust.docx`

Pipeline:

- Real-estate transfer renderer (`renderRealEstateTransferDocx`) via `documents.include_real_estate_trust`
- Flat `{field}` merge (docxtemplater), **not** Jinja

Normalise merge fields after editing the template in Word:

```bash
cd tools/aubreylaw-docgeneration
python3 tools/fix_realty_trust_merge_fields.py
```

The script rewrites the legacy field names to the computed ones below and
re-joins any `{field}` Word split across runs. It is idempotent — running it on
an already-normalised template reports zero replacements and writes nothing.

> The `tools/convert_cornerstone_realty_trust.py` converter this doc used to
> reference was never committed. The template is maintained directly (edit in
> Word, then run the script above), not regenerated from the source form.

## Key Placeholders

| Source text | Template field |
| --- | --- |
| `[REALTY TRUST NAME]` | `{trust_name}` |
| `[NAME OF TRUSTEE]` / `[TRUSTEE]` | `{trustees}` |
| Trustee/Trustees title after a signature line | `{trustee_title}` (computed) |
| `[OrdinalDocDate]` / `[DocDate]` | `{document_date_blank}` (computed — signing blank) |
| `[PROPERY COUNTY]` | `{property_county}` |
| `[SIGNING COUNTY]` | `{signing_county}` (computed — falls back to `property_county`) |
| Notary commission line | `{notary_commission_blank}` (computed) |
| `[BENEFICIARY]` | `{beneficial_owners}` |
| `[NUMBER OF YEARS OF SUCCESSIVE TRUST TERM]` | `{trust_term_extension_years}` (default `21`) |
| `[his/her/their]` | `their` (static — no pronoun field yet) |

Computed fields come from `fieldsToTemplateData` in
`lib/realEstateTransfer/fields.ts` and match the cornerstone deed templates
(`deed.docx`, `deed-landcourt.docx`).

### Do not use in this template

| Field | Why |
| --- | --- |
| `{execution_date}` | Listed in `LEGACY_DEED_FIELDS`, so the Real Estate Transfer form never collects it and `buildTemplateFields` never sets it — it merges blank. Use `{document_date_blank}`. |
| `{certificate_execution_county}` | Merges blank when the certificate section is left empty. Use `{signing_county}`, which falls back to `property_county`. |

`{trust_name_upper}` is available if the signature blocks should read
`THE 1 MAIN STREET REALTY TRUST` rather than the current mixed-case
`THE {trust_name}`.

## Design Sheet Mapping

| Design sheet | Template field |
| --- | --- |
| `decisions.real_estate_transfer.realtyTrustName` | `trust_name` |
| `decisions.real_estate_transfer.realtyTrustDate` | `trust_date` — **not used by this template**; dates merge as signing blanks |
| Trustee contact selection | `trustees` |
| `beneficialOwners[]` | `beneficial_owners` (semicolon-joined `Name (pct%)`) |
| Deed / property fields | `property_*`, `legal_description`, etc. |

## Generate (test)

Covered by `tests/realEstateTransfer.test.ts`, which asserts the rendered
realty trust contains no leftover `{` or `}` in `word/document.xml` or
`word/footer2.xml`:

```bash
npx vitest run tests/realEstateTransfer.test.ts
```

## Known Gaps

| Gap | Notes |
| --- | --- |
| `twenty (21) years` | Article term reads "twenty (21) years" — the word and the numeral disagree. Needs an attorney decision on the intended term before editing. |
| Dual trustee / dual notary blocks | Two signature and two notary sections always render; a single-trustee trust gets a duplicate block. Needs a repeatable trustee list rather than the joined `{trustees}` string. |
| Beneficiary signature lines | `{beneficial_owners}` is one joined string, so a signature line reads `Jane (50%); John (50%), Beneficiary`. Needs a per-owner loop. |
| Beneficiary schedule rows | Schedule of Beneficial Interests table has no merge fields and renders empty. |
| Trustee pronouns | Source uses `[his/her/their]`; template hard-codes `their` |
| Successive term years | Field defaults to `21` in `buildTemplateFields`; not exposed in Transfers UI |
| `trustees_certificate` template | `trustees-certificate.docx` still uses `{execution_date}` / `{certificate_execution_county}` and has the same blank-merge problem; not updated in this pass |
