# Simplified Joint Revocable Trust Placeholder and Logic Map

Source form:
`source-forms/trust/joint-trust-simplified.docx`

Generated template:
`templates/joint-trust-simplified.docx`

## Identified Placeholders

| Source text | Template field |
| --- | --- |
| `[TRUST NAME]` | `{{ trust.name \| name }}` |
| `[CLIENT FULL NAME]` | `{{ client.full_name \| name }}` |
| `[SPOUSE FULL NAME]` | `{{ spouse.full_name \| name }}` |
| Trust date blanks | `{{ trust.display_date }}` |
| `CHILD ONE; CHILD TWO; CHILD THREE` | loop over `children` |
| Prior-relationship child options | loops over `trust.blended_family.client_children` and `trust.blended_family.spouse_children` |
| `SUCCESSOR TRUSTEE` | `{{ fiduciaries.trustee.primary.full_name \| name }}` |
| `ALTERNATE SUCCESSOR TRUSTEE` | `{{ fiduciaries.trustee.successor.full_name \| name }}` |
| `Option 4a` | `a majority of our children` |
| `[SIGNING COUNTY]` | `{{ execution.display_signing_county \| name }}` |
| `[Notary Commission]` | `{{ execution.display_notary_commission }}` |

## Conditional Logic

| Condition | Trigger | Affected language |
| --- | --- | --- |
| `has_children` | one or more children listed | Family information child declaration |
| `trust.blended_family.client_children` | client-only children listed | Client child inclusion paragraph |
| `trust.blended_family.spouse_children` | spouse-only children listed | Spouse child inclusion paragraph |
| `has_specific_gifts` | one or more `specific_gifts` listed | Specific cash bequests section |
| `has_charitable_gifts` | one or more `charitable_gifts` listed | Charitable gifts section |
| `signing_scheduled` | signing details are known | Execution date, signing county, and notary commission fields render actual values instead of blanks |

## Package

Generate the simplified joint trust document with:

```bash
python3 al-generator.py generate --data examples/client-ma-joint-trust-simplified.json --package joint-trust-simplified --state MA --out output/ma-joint-trust-simplified
```

## Review Notes

- The source document is Massachusetts-specific and for married joint grantors.
- Bracketed option notes from the source form are removed during conversion so generated drafts do not contain raw template markers.
- The source's `Option 4a` trustee-removal placeholder is rendered as `a majority of our children`, matching the simplified non-Trust-Protector approach already used elsewhere in the joint trust templates.
- `trust.display_date` renders `trust.date` when known and `________________, 20___` when the trust date is unknown.
- Legal text was preserved as source material where possible, but the generated template remains a draft automation template requiring Massachusetts attorney review before client use.
