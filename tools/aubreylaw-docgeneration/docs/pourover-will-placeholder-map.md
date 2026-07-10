# Pour-Over Will Placeholder and Logic Map

Source form:
`source-forms/estate/cornerstone/pourover-will_cv1.docx`

Conversion script:
`tools/convert_cornerstone_pourover_will.py`

Generated template:
`templates/pourover-will.docx`

Re-run conversion:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python3 tools/convert_cornerstone_pourover_will.py
```

## Identified Placeholders

| Source text | Template field |
| --- | --- |
| `[CLIENT]` | `{{ client.full_name }}` |
| `[CITY]` | `{{ client.city }}` |
| `[COUNTY]` | `{{ client.county }}` |
| Massachusetts | `{{ state.code }}` where appropriate |
| `[SPOUSE]` | `{{ spouse.full_name }}` |
| `[CHILD FULL NAME]` | loop over `children` |
| `[TRUST NAME]` | `{{ trust.name | name }}` |
| Trust date blank | `{{ trust.date }}` |
| `[INITIAL PERSONAL REPRESENTATIVE]` | `{{ fiduciaries.executor.primary.full_name }}` |
| `[CO-INITIAL PERSONAL REPRESENTATIVE]` | `{{ fiduciaries.executor.co_primary.full_name }}` |
| `[SUCCESSOR PERSONAL REPRESENTATIVE]` | `{{ fiduciaries.executor.successor.full_name }}` (first successor) |
| `[CO-SUCCESSOR PERSONAL REPRESENTATIVE]` | `{{ fiduciaries.executor.co_successor.full_name }}` |
| Second successor PR | `{{ fiduciaries.executor.second_successor.full_name }}` |
| Co-second-successor PR | `{{ fiduciaries.executor.co_second_successor.full_name }}` |
| `[INITIAL GUARDIAN]` | `{{ guardians.primary.full_name }}` |
| `[SUCCESSOR GUARDIAN]` | `{{ guardians.successor.full_name }}` |
| `[SECOND SUCCESSOR GUARDIAN]` | `{{ guardians.second_successor.full_name }}` |

## Identified Conditional Logic

| Condition | Trigger | Affected language |
| --- | --- | --- |
| `has_spouse` | `spouse.exists` or spouse name present | Spouse declaration and alternate spouse disposition |
| `has_children` | one or more children listed | Child/descendant declaration and tangible property language |
| `has_minor_children` / `requires_guardian_clause` | any child has `minor: true` | Guardian nomination article |
| `uses_revocable_trust` | `planning.uses_revocable_trust` | Pour-over devise and alternate trust incorporation |
| `state_requires_self_proving_affidavit` | MA state rule | Self-proving affidavit / notary block |
| `has_excluded_guardians` | excluded guardian list present | Guardian exclusion paragraph |
| successor PR present | `fiduciaries.executor.successor.full_name` set | Vacancy / successor-nomination sentence (omitted entirely if no successor) |
| second successor PR present | `fiduciaries.executor.second_successor.full_name` set | Switches the successor nomination to an ordered chain ("first, …; and second, …"); each tier may add a co-successor via `co_successor` / `co_second_successor` |
| PR nomination power (cv1) | always present | "Should all of the said personal representatives decline…" — each PR may nominate a replacement |

## Cornerstone cv1 conversion notes (2026-07-10)

The cv1 source was **mostly pre-templated** with Jinja placeholders and `include_clause()` calls. The conversion script:

- Copies source to `source-forms/estate/cornerstone/pourover-will_cv1.docx`
- **Removes** two legacy duplicate PR paragraphs that still used bracket placeholders (`[Initial Personal Representative]`, `[CLIENT PR]`)
- **Fixes** the primary PR nomination paragraph (cv1 had a broken `{% else %}` without a matching `{% if %}`)
- **Preserves** the cv1 PR nomination-power paragraph ("Should all of the said personal representatives decline…")
- Applies family/disinheritance conditional patches (`include_child_gender_markers`, `include_afterborn_children`, `include_expectant_children`, `omissions_intentional`)

This **replaces** the prior `templates/pourover-will.docx` (same package output path). The older `tools/convert_pourover_will.py` targeted `source-forms/Pourover_Will.docx` and is superseded for Cornerstone work.

Test render:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python3 al-generator.py generate --allow-draft \
  --data examples/client-ma-pourover.json \
  --package pourover-will --state MA --out output/ma-pourover
```

Note: `examples/client-ma-pourover.json` is minimal; full renders need `will.*`, `pour_over.alternate_disposition_text`, and top-level family flags (the Node estate generator flattens these from `family.*`; `al-generator.py` does not yet).

## Clause Library Candidates

- `ma_pourover_will.opening_declaration`
- `ma_pourover_will.family_information`
- `ma_pourover_will.tangible_personal_property`
- `ma_pourover_will.pourover_to_trust`
- `ma_pourover_will.alternate_disposition`
- `ma_pourover_will.personal_representative_nomination`
- `ma_pourover_will.personal_representative_powers`
- `ma_pourover_will.debts_expenses_taxes`
- `ma_pourover_will.representation`
- `ma_pourover_will.spendthrift`
- `ma_pourover_will.definitions`
- `ma_pourover_will.guardian_nomination`
- `ma_pourover_will.guardian_exclusion`
- `ma_pourover_will.execution_block`
- `ma_pourover_will.self_proving_affidavit`

## Review Notes

- The source document is Massachusetts-specific.
- Legal text was preserved as source material where possible, but the generated template and clauses still require attorney review before use.
- The cv1 source already templates guardian exclusion via `{% if requires_guardian_clause and has_excluded_guardians %}` with a loop over `guardians.excluded[]` (no `TO BE DETERMINED` placeholder).
