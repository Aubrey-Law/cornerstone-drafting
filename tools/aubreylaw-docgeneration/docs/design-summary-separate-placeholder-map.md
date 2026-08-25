# Design Summary (Separate Trusts) Placeholder and Logic Map

Package: `packages/design-summary-separate.json`

The design-sheet export for a **reciprocal (separate) living-trust** matter —
each spouse creates their own revocable trust. The export route
(`/api/admin/matters/[id]/design-sheet/export`) picks this package over
`design-summary` when `payload.trust.separate_trusts` is true; everything else
about the route is unchanged.

| Document | Template | Output | Purpose |
| --- | --- | --- | --- |
| Estate Plan Design Summary | `templates/design-summary-detailed.docx` | `01-estate-plan-design-summary.docx` | Same client-facing summary the joint export produces. |
| Estate Plan Interview Worksheet | `templates/design-summary-worksheet-separate.docx` | `02-estate-plan-interview-worksheet.docx` | Two-settlor interview worksheet, pre-ticked from the design sheet. |

## Source document

`Reciprocal Living Trusts … Blank Interview Worksheet.docx` — the firm's blank
reciprocal-trust interview form. The container (styles, numbering, theme, page
setup) is carried over unchanged so the worksheet keeps the source form's
compact 10 pt layout; the Aubrey Law header and footer replace the source's
plain page-number footers, matching `design-summary-worksheet.docx`.

Every question in the source form is preserved, in the source's order. Where
the design sheet captures the answer, the check box is ticked (`☒`) or the rule
carries the value; where it does not, the box prints blank for the attorney to
tick during the interview. That is deliberate — this is still an interview
form, not a report.

## Structure

Sections follow the source form: Core Documents, Ancillary Documents, Letters,
Informational & Presentation, then `FAMILY INFORMATION`, `CONTACTS`,
`GUARDIAN DESIGNATIONS`, `LIVING TRUST DETAILS`, `SUCCESSOR TRUSTEES`,
`TRUST FOR SETTLOR 1`, `TRUST FOR SETTLOR 2`, `ASSET SCHEDULES`,
`POA PROVISIONS`, `POWER OF ATTORNEY (SETTLOR 1 / 2)`,
`HEALTH CARE PROXY (SETTLOR 1 / 2)`, `HEALTHCARE FORMS (SETTLOR 1 / 2)`,
`POST-DEATH CHOICES (SETTLOR 1 / 2)`, `WILL & EXECUTORS (SETTLOR 1 / 2)`,
`DEEDS`, `TRANSFERS & ASSIGNMENTS`, `SIGNING INFORMATION`.

Settlor 1 is `client`; Settlor 2 is `spouse`. Every Settlor 2 block is wrapped
in `{% if has_spouse %}`, so the same template renders a single-settlor matter
without the empty halves.

## Field map

| Worksheet question | Merge field / condition |
| --- | --- |
| Core document check boxes | `planning.include_trust`, `include_dpoa`, `include_hcp`, `include_ahd`, `include_hipaa`, `include_pour_over_will`, `include_simple_will`, `include_ppm`, `include_certificate_of_trust`, `include_assignment_of_personal_property`, `include_funding_instructions`, `include_estate_plan_summary`, `include_parental_appointment`, `include_homestead_trustee` |
| Presentation extras | `planning.include_trust_summary`, `include_estate_plan_signing_guide`, `include_successor_trustee_checklist`, `include_fiduciary_role_guide`, `include_flowchart`, `include_asset_spreadsheet` |
| Will title | `will.title` (`last_will` / `pour_over_will`) |
| Settlor 1 / 2 identity, address, contact | `client.*` (incl. `citizenship`, `domicile`), `spouse.*` (incl. `citizenship`), `marriage.date` |
| Children table | `{% for child in children %}` |
| Afterborn / posthumous / omissions | `family.include_afterborn_children`, `family.include_expectant_children`, `family.omissions_intentional` |
| Disinherited heirs | `family.disinherited[]`, `family.disinherit_issue`, `family.include_general_disinheritance`, `family.additional_disinheritance_language` |
| Fiduciary display toggles | `fiduciary_display.show_phone` / `show_address` / `show_email` / `show_dob` / `show_relationship` |
| Fiduciaries & Key People table | One conditional row per named role — `fiduciaries.trustee.*`, `fiduciaries.executor.*`, `fiduciaries.agent.*`, `fiduciaries.spouse_agent.*`, `healthcare.agent.*`, `healthcare.spouse_agent.*`, `guardians.*` |
| Guardians | `requires_guardian_clause`, `guardians.primary` / `successor` / `second_successor` / `temporary` |
| Trustee administration | `trust.provisions.require_trustee_bond`, `limit_duty_to_account`, `include_reverse_mortgage_clause`, `include_firearms_provisions`, `allow_sole_trustee_to_appoint_cotrustees`, `allow_trustee_to_designate_alternates` |
| Retirement accounts, gifts and protections | `trust.provisions.include_retirement_account_provisions`, `allow_protector_convert_conduit_trusts`, `allow_direct_distributions_to_young_or_incapacitated`, `include_slayer_provision`, `allow_charitable_giving_during_incapacity`, `forgive_all_debts` |
| Incapacity | `trust.provisions.include_incapacity_definition`, `allow_psychologist_substitute`, `allow_pa_np_substitute`, `settlor_incapacity_determined_by`, `trustee_incapacity_determined_by` |
| Schedule A options | `trust.provisions.asset_schedule_signature_block`, `asset_schedule_catchall`, `asset_schedule_non_trust`, `asset_schedule_format` |
| Distribution to spouse/partner | `trust.spousal_funding` (`outright_to_spouse` / `disclaimer` / `clayton_election`) |
| Trustee provisions, definitions, administration | `trust.trustee_compensation`, `trust.representation_type`, `trust.survivorship_requirement_days`, `trust.successor_trustee_vacancy`, `trust.special_distributions_age`, `trust.include_common_trust_for_children`, `trust.trust_protector_requested`, `trust.trust_protector.full_name`, and the `trust.provisions.*` booleans |
| Co-trustee decisionmaking | `fiduciaries.trustee.co_trustees_action` |
| Successor trustees, Settlor 1 | `fiduciaries.trustee.primary` / `co_primary` / `successor` / `co_successor` / `second_successor` / `co_second_successor` |
| Successor trustees, Settlor 2 | `fiduciaries.spouse_trustee.primary` / `co_primary` / `successor` |
| Trust names | `trust.name` (Settlor 1), `trust.spouse_name` (Settlor 2) |
| Distributions | `trust.descendants_distribution.method` and `stage_1..3_age`, `trust.residuary_after_death`, `trust.contingent_beneficiary.full_name`, `trust.remote_beneficiaries.method` / `individuals[]` / `charity.name` |
| Tangible personal property | `trust.tangible_personal_property.distribution_method` / `named_individual.full_name` |
| Asset schedule | `has_assets`, `assets.items[]`, `assets.total_gross_value` |
| POA provisions | `dpoa.agent_compensation`, `dpoa.coagent_serving`, `dpoa.allow_gifts`, `dpoa.trust_powers.*`, `dpoa.special_powers.*`, `dpoa.include_entity_powers`, `dpoa.include_extended_personal_care` |
| Attorney-in-fact powers | `dpoa.all_basic_powers`, `dpoa.basic_powers.<key>`, `dpoa.additional_powers`, `dpoa.specific_businesses`, `dpoa.additional_limitations` |
| Advanced-illness treatment | `hcp_client_advance_prolong_life` / `_dnr` / `_do_not_prolong`, and the `hcp_spouse_advance_*` trio |
| Anatomical gifts | `healthcare.client_anatomical_gift`, `healthcare.spouse_anatomical_gift`, `healthcare.anatomical_specified`, `healthcare.spouse_anatomical_restrictions` |
| HIPAA | `hipaa.include_poa`, `hipaa.include_trustees`, `hipaa_list_fiduciaries_by_name`, `hipaa_list_fiduciaries_general`, `hipaa_psychotherapy_authorized`, `hipaa.client_additional_agents[]`, `hipaa.spouse_additional_agents[]` |
| Executors and will powers | `will.pr_structure`, `will.pr_powers.*`, `will.bond`, `will.include_self_proving_affidavit`, `will.include_disclaimer_article`, `fiduciaries.executor.*`, `fiduciaries.spouse_executor.*` |
| Signing information | `execution.signing_scheduled`, `execution.display_doc_date`, `execution.display_signing_county`, `execution.display_notary_commission`, `execution.signing_type`, `client.state` |
| Additional beneficiaries | `family.additional_beneficiaries[]` |
| Asset schedule ownership | `assets.items[].owner`, `.target_owner` |

## Deliberate departures from the source form

| Source form | This template | Why |
| --- | --- | --- |
| Separate "Disinherited Heirs for Settlor 1" and "… for Settlor 2" blocks | One shared **Disinherited Heirs** block | The design sheet keeps a single disinheritance list per matter; printing it twice would imply two lists. A note in the document says so. |
| Free-form beneficiary table | Children table plus a **Specific Gifts** table | The design sheet has no free-form beneficiary roster; children and specific bequests are the recipients it does record. |
| "Remainder of Tangible Personal Property" — six generic options | The design sheet's own four options | Those are the values `tangible_property_distribution` can hold; the generic list could never be ticked. |
| "Default Provision" — seven generic options | The design sheet's three remote-beneficiary options | Same reason. |
| Estate Assets table column *Schedule / Trust* | *Transfer To* | The design sheet records where an asset should end up (`assets[].target_owner`), not which schedule it lands on. |

Some blocks stay entirely unticked because nothing upstream records them:
table of contents, dementia directive, visitation authorization, final
disposition, comprehensive transfer document, the cover page and letters,
post-death choices, deeds, and transfers & assignments. They print as blank
boxes and ruled lines for the interview. `docs/design-sheet-sections/` and the
design-sheet plan track what it would take to capture them.

## Fields added to the pipeline for this template

| Field | Source |
| --- | --- |
| `planning.include_certificate_of_trust` | `documents.include_certificate_of_trust` |
| `planning.include_assignment_of_personal_property` | `documents.include_assignment_of_personal_property` |
| `planning.include_funding_instructions` | `documents.include_funding_instructions` |
| `planning.include_homestead_trustee` | `documents.include_homestead_trustee` |
| `planning.include_estate_plan_summary` | `documents.include_estate_plan_summary` |
| `will.pr_powers.*` | `will_provisions.pr_powers` |
| `fiduciaries.spouse_trustee.*` | `fiduciaries.spouse_trustee_primary` / `_co` / `_successor` (design sheet `spouse_trustee_slots`) |
| `client.citizenship`, `client.domicile`, `spouse.citizenship` | `client_citizenship`, `client_domicile`, `spouse_citizenship` columns |
| `planning.include_trust_summary` and the other four presentation extras | `decisions.estate_plan_design.ancillary_documents.*` |
| `will.title`, `execution.signing_type` | `decisions.estate_plan_design.will_title` / `.signing_type` |
| `assets.items[].owner` / `.target_owner` / `.beneficiary_designation` | `assets[].current_owner` / `.target_owner` / `.beneficiary_designation` |
| `family.additional_beneficiaries` | `additional_beneficiaries[]` column |
| `trust.provisions.include_marital_deduction_savings_language` | new `decisions.trust_details` key — the checkbox that used to be inert |

`fiduciaries.spouse_trustee` is new because separate trusts are the only
structure where the spouse has their own trustee set. The existing
`fiduciaries.spouse_testamentary_trustee` reads the same slots for the will's
testamentary trust and is unchanged.

## Example payload

`examples/client-ma-design-summary-separate.json` — married couple, two
children, reciprocal trusts, one disinherited sibling, and a populated asset
schedule. It exercises both settlor halves, every table loop, and the signing
block.

```bash
npm run estate:render -- --package design-summary-separate
python3 .claude/skills/aubreylaw-doc-templates/scripts/qa_scan.py \
  tools/aubreylaw-docgeneration/output/design-summary-separate/*.docx
```
