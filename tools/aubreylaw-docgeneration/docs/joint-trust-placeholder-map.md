# Joint Revocable Trust Placeholder and Logic Map

Source form:
`source-forms/trust/joint-trust.docx`

Generated template:
`templates/joint-trust.docx`

## Identified Placeholders

| Source text | Template field |
| --- | --- |
| `[TRUST NAME]` | `{{ trust.name \| name }}` |
| `[CLIENT FULL NAME]` | `{{ client.full_name \| name }}` |
| `[SPOUSE FULL NAME]` | `{{ spouse.full_name \| name }}` |
| Trust date blanks | `{{ trust.display_date }}` |
| `[CHILD FULL NAME]` | loop over `children` |
| `[CLIENT CHILD]` | loop over `trust.blended_family.client_children` |
| `[SPOUSE CHILD]` | loop over `trust.blended_family.spouse_children` |
| `[DISINHERIT INDIVIDUAL]` | loop over `trust.disinherited` |
| `TRUSTEE` | `{{ fiduciaries.trustee.primary.full_name \| name }}` |
| `TRUSTEE 1` | `{{ fiduciaries.trustee.successor.full_name \| name }}` |
| `[SIGNING COUNTY]` | `{{ execution.display_signing_county \| name }}` |
| `[Notary Expiration]` | `{{ execution.display_notary_commission }}` |

## Conditional Logic

| Condition | Trigger | Affected language |
| --- | --- | --- |
| `has_children` | one or more children listed | Family information child declaration |
| `trust.blended_family.client_children` | client-only children listed | Client child inclusion paragraph |
| `trust.blended_family.spouse_children` | spouse-only children listed | Spouse child inclusion paragraph |
| `trust.disinherited` | one or more disinherited persons listed | Specific disinheritance paragraph |
| `signing_scheduled` | signing details are known | Execution date, signing county, and notary commission fields render actual values instead of blanks |

## Package

Generate the joint trust document with:

```bash
python3 al-generator.py generate --data examples/client-ma-joint-trust.json --package joint-trust --state MA --out output/ma-joint-trust
```

## Review Notes

- The source document is Massachusetts-specific and for married joint grantors.
- Bracketed optional-review notes from the source form are removed during conversion so generated drafts do not contain raw template markers.
- `trust.display_date` renders `trust.date` when known and `________________, 20___` when the trust date is unknown.
- Legal text was preserved as source material where possible, but the generated template remains a draft automation template requiring Massachusetts attorney review before client use.
