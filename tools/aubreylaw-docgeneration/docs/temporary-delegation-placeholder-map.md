# Temporary Delegation of Parental Powers Placeholder Map

Source form (firm OneDrive template):

- `source-forms/guardianship/parental-delegation.docx`

Legacy Cornerstone cv1 source (superseded for production template):

- `source-forms/guardianship/cornerstone/Delegation of Powers of Parent or Guardian_cv1.docx`

Convert (authoritative):

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_parental_delegation_doc.py
```

Legacy Cornerstone converter (reference only):

```bash
.venv/bin/python tools/convert_cornerstone_temp_delegation_doc.py
```

Generated template:

- `templates/temporary-delegation-parental-powers.docx`

Package:

- `packages/temporary-delegation-parental-powers.json`

## Document identity

`parental-delegation.docx` is **Temporary Delegation of Parental Powers** under MGL c.190B §5-103 — **not** the separate **Parental Appointment of Guardian** form (`parental-guardian-appointment` package, still missing).

## Key Placeholders

| Source token / text | Template field |
| --- | --- |
| `[CLIENT]` / `[SPOUSE]` | `{{ client.full_name \| name }}` / `{{ spouse.full_name \| name }}` |
| `both of [Address]` | `{{ client.city }}, {{ client.state }}` |
| `[CHILD FULL NAME] born on [Child DOB]` | `{% for child in minor_children %}` … `{% endfor %}` |
| `[GUARDIAN]` | `{{ guardians.temporary.full_name \| name }}` |
| `[CO GUARDIAN]` | `{{ guardians.temporary_co.full_name \| name }}` (conditional ` and …`) |
| Address / Phone lines | `{{ guardians.temporary.address }}` / `{{ guardians.temporary.phone }}` |
| `[Ordinal_DocDate]` / `[DocDate]` | `{{ execution.display_ordinal_doc_date }}` |
| `[SIGNING COUNTY]` | `{{ execution.display_signing_county \| name }}` |
| `[Notary Commission]` | `{{ execution.display_notary_commission }}` |

## Conditional Logic

| Condition | Trigger | Effect |
| --- | --- | --- |
| `has_spouse` | spouse exists | Married-parent intro, signatures, witness attestation, notary block |
| `guardians.temporary_co.full_name` | co-temporary agent named | `Name:` line appends ` and {{ guardians.temporary_co.full_name \| name }}` |
| `child.minor` | child flagged minor | Included in `minor_children` context array |
| `signing_scheduled` | execution details present | Date/county/notary render values vs blanks |

## Design Sheet Mapping

| Design sheet | Generator path |
| --- | --- |
| `temporary_guardian_slots` order 0 | `guardians.temporary` |
| `temporary_guardian_slots` order 0 `is_co: true` | `guardians.temporary_co` |
| `temporary_guardian_slots` order 1 | `guardians.temporary_successor` (not in firm template body) |
| `temporary_guardian_slots` order 2 | `guardians.temporary_second_successor` (not in firm template body) |
| `children[]` with `minor` | `minor_children` filtered in template |
| `include_temp_delegation` | package selection (auto when minor children) |

## Generate

```bash
python3 al-generator.py generate \
  --data examples/client-ma-temp-delegation.json \
  --package temporary-delegation-parental-powers \
  --state MA \
  --out output/ma-temp-delegation
```

## Known Gaps

| Gap | Notes |
| --- | --- |
| Alternate temporary agent | Firm template has no alternate-agent section; `guardians.temporary_successor` wired in payload but unused |
| Third alternate temporary agent | `guardians.temporary_second_successor` exists in payload but unused |
| Single-parent vs married wording | Template branches on `has_spouse`; verify attorney review for solo-parent edge cases |
| Co-temporary guardian UI | `temporary_guardian` slots now allow co-agent (`allowCo: true`); phone requires `fiduciary_display.show_phone` |
| `parental-guardian-appointment` template | Separate package; still missing — this form does **not** close that gap |
| Page count | Firm template omits page-count blank present in Cornerstone cv1 |
| Notary ID fill-in | Template leaves manual `__________________________` for ID type at signing |
