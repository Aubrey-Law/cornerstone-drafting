# Design Summary Placeholder and Logic Map

Package: `packages/design-summary.json`

Two client-facing summaries rendered from the design sheet. Both use the shared
generator context (no spouse-as-client transform), so they render from the same
payload the drafting generator uses. Surfaced through the design sheet
**Export Word** button (`/api/admin/matters/[id]/design-sheet/export`).

| Document | Template | Output | Purpose |
| --- | --- | --- | --- |
| Estate Plan Design Summary | `templates/design-summary-detailed.docx` | `01-estate-plan-design-summary.docx` | Detailed, post-decision client review summary. |
| Estate Plan Design Worksheet | `templates/design-summary-worksheet.docx` | `02-estate-plan-design-worksheet.docx` | Pre-meeting worksheet with blanks and ⚑ decision flags. |

## Source documents

- Detailed summary: firm OneDrive `Estate Plan Design Summary.docx`. It arrived
  with Word-split merge tags (runs broken mid-`{{ }}`/`{% %}`); flattened with
  `tools/flatten_runs.py` so each tag is contiguous. Two manual fixes after
  flattening:
  - The "How to Use" paragraph contained a literal `{{ }}` example (invalid
    Nunjucks); reworded to drop the braces.
  - `Spendthrift Protection` was a bare `{{ trust.spendthrift }}` the generator
    never populates; replaced with static plain-language explanatory text
    (attorney may revise).
- Worksheet: firm OneDrive `Estate_Plan_Design_Summary_TEMPLATE.docx`, already
  templatized with canonical merge fields and conditions.

## Key merge fields

Both documents draw from the canonical fields used by `estate-plan-summary`:
`client.*`, `spouse.*`, `children[]` (worksheet uses indexed `children[0..2]`;
detailed uses a `{% for child in children %}` loop), `trust.*`,
`fiduciaries.trustee/executor/agent/spouse_agent.*`,
`healthcare.agent/spouse_agent.*`, `guardians.*` (incl. `short_term_*`),
`specific_gifts[]`, and the derived flags below.

Additional design-summary fields:

| Template field | Source |
| --- | --- |
| `spouse.aka` | Design sheet spouse AKA / prior name |
| `marriage.date` | Design sheet marriage date, formatted for display |
| `client.zip` | Design sheet client ZIP code |
| `assets.total_gross_value` | Sum of populated design-sheet asset values |
| `trust.residual_beneficiary` | Stored residuary-beneficiary selection |

## Conditional logic

| Condition | Affected content |
| --- | --- |
| `has_spouse` | Spouse column/section, "Married/Single", joint grantor/trustee text |
| `planning.include_trust` | Trust sections, residuary, personal property, funding |
| `planning.include_pour_over_will` / `include_simple_will` / `include_testamentary_trust_will` | Will section variant |
| `planning.include_dpoa` / `include_hcp` / `include_ahd` / `include_hipaa` / `include_ppm` | Each incapacity/PPM section and its "Included" row |
| `requires_guardian_clause` | Guardian sections (long-term + short-term) |
| `has_children` | Children grid / family section |
| `has_specific_gifts` | Specific-gift list vs. ⚑ decision flag |
| `owns_real_property` | Real-estate funding line |
| `trust.descendants_distribution.method == 'staged'` | Staged-age withdrawal rows |

## Notes

- The worksheet caps the children grid at three rows (`children[0..2]`); a fourth
  child renders no extra row. Switch to the detailed doc's loop pattern if an
  unbounded list is required.
- Fiduciary tables conditionally render each supported successor row only when
  that fiduciary is populated. The design meeting date, "responsible for
  funding," and MA estate-tax planning approach remain manual entries.
