# will-cp placeholder map

Source form: the firm's `will_cp_v1.docx` (College Preparation Plan simple
will). The template is generated from source — edit
`scripts/generate-will-cp-template.ts` and re-run
`npx tsx scripts/generate-will-cp-template.ts` rather than editing the DOCX.

The source form already carried canonical merge fields for the client,
personal representative, and execution block; the conversion replaced its two
bracket markers and added the single-parent residue branch.

## Marker → canonical field

| Source marker | Canonical field |
| --- | --- |
| `[FATHER'S NAME]` | `{{ will_cp.parent1.full_name \| name }}` |
| `[MOTHER'S NAME]` | `{{ will_cp.parent2.full_name \| name }}` |
| testator name | `{{ client.full_name \| name }}` |
| residence | `{{ client.city }}`, `{{ client.county }}` |
| personal representative | `{{ fiduciaries.executor.primary.full_name \| name }}` (+ `co_primary`, `successor`, `co_successor`, `second_successor` in guarded conditionals) |
| signing date | `{{ execution.display_ordinal_doc_date }}` |
| notary county | `{{ execution.display_signing_county \| name }}` |
| notary commission | `{{ execution.display_notary_commission }}` |
| testator pronouns (witness attestation) | `{{ client.pronoun_subject }}`, `{{ client.pronoun_object }}`, `{{ client.pronoun_possessive }}` |
| footer | `LAST WILL AND TESTAMENT OF [CLIENT FULL NAME]` (static marker, replaced at render) |

## Conditional logic

| Condition | Effect |
| --- | --- |
| `{% if will_cp.parent2.full_name %}` | Both-parents residue clause ("divided equally … or to the survivor of them"); else a single-parent clause. Contingent takers (issue by representation, then siblings, then heirs at law) are identical in both branches. |
| `{% if fiduciaries.executor.co_primary is defined and … %}` | Co-personal-representative named alongside the primary. |
| `{% if fiduciaries.executor.successor is defined and … %}` | Successor-PR sentence appears only when a successor is named. |
| `{% if fiduciaries.executor.second_successor is defined and … %}` | Succession list switches to the "in the order named" form. |

## Data source

`will_cp.parent1`/`parent2` come from `decisions.college_prep.will_parent1_name`
/ `will_parent2_name` (College Preparation Plan design section →
`lib/draftPayload/willCp.ts`). The package selects on
`documents.include_will_cp`, which follows the sheet's `will` document
inclusion — on the college-prep track only — defaulting from
`college_prep.will_include`, the same pattern as the FERPA release.
