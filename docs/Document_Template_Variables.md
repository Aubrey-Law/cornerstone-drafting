# Document Template Variable Reference

Last verified against the Cornerstone runtime on July 13, 2026.

This is the variable inventory for app-owned DOCX masters managed in **Settings → Templates**. It covers all three renderers:

1. Estate-planning templates (`estate_nunjucks`)
2. Real-estate transfer templates (`real_estate_docxtemplater`)
3. Engagement-agreement templates (`engagement_docxtemplater`)

These renderers do **not** use interchangeable syntax. Always use the syntax for the template category shown in the Templates center.

## Quick syntax reference

| Template category | Value | Conditional | Loop |
| --- | --- | --- | --- |
| Estate planning | `{{ client.full_name }}` | `{% if has_spouse %}...{% endif %}` | `{% for child in children %}...{% endfor %}` |
| Real estate | `{grantor}` | Not supported in v1 | Not supported in v1 |
| Engagement | `{primary_name}` | Use an array loop where supported | `{#additional_clauses}...{/additional_clauses}` |

## Estate-planning templates

Estate templates use Nunjucks/Jinja-style tags. The runtime context is built from the matter's canonical draft payload by `lib/estateGenerator/toGeneratorData.ts`, then supplemented with computed values by `lib/estateGenerator/node/context.ts`.

### Output, filters, and missing values

```text
{{ client.full_name }}
{{ client.full_name | name }}
{{ optional_value | default("fallback") }}
{{ execution.display_notary_commission | optional }}
```

Supported filters:

| Filter | Effect |
| --- | --- |
| `name` | Uppercases a person or trust name. |
| `default(value)` | Uses the supplied fallback according to Nunjucks `default` behavior. |
| `safe` | Allows trusted preformatted content such as the funding-plan narrative. |
| `optional` | Allows an empty value without producing a missing-field marker. |
| `orMissing(label)` | Produces `[[ MISSING: label ]]` when a value is empty. The renderer adds this automatically to simple placeholders. |

An empty simple placeholder normally renders as `[[ MISSING: path.to.field ]]`. Validation reports that marker as missing matter data. It is a warning unless the package or template requires the field.

### Conditional date variables

Use the `display_` fields for document execution text:

| Variable | Signing date known | Signing date unknown |
| --- | --- | --- |
| `execution.display_doc_date` | Matter signing date | `________________, 20___` |
| `execution.display_ordinal_doc_date` | Ordinal signing date | `_____ day of _________________, 20___` |
| `execution.display_signing_county` | Matter signing county | `__________________________` |
| `execution.display_notary_commission` | Commission expiration | Empty; the notary supplies it through the seal or stamp |

Example:

```text
Dated: {{ execution.display_doc_date }}

Signed this {{ execution.display_ordinal_doc_date }}.
```

Do not wrap these in another `{% if %}` merely to create the blank line; the display variables already make that decision.

### Reusable person object

Many entries below are person objects. A person object can expose:

| Child field | Meaning |
| --- | --- |
| `.full_name` | Full legal or display name; always available as a key. |
| `.address` | Address, when collected and enabled for document display. |
| `.city` | City, where the specific source supplies it. |
| `.state` | State, where the specific source supplies it. |
| `.phone` | Phone, when collected and enabled for document display. |
| `.email` | Email, when collected and enabled for document display. |
| `.date_of_birth` | Date of birth, when collected and enabled for document display. |
| `.relationship` | Relationship label, when collected and enabled for document display. |
| `.reason` | Guardian-exclusion reason, only for `guardians.excluded[]`. |

The design-sheet `fiduciary_display` choices control whether phone, address, email, date of birth, and relationship fields are copied into fiduciary person objects. Use a conditional before optional contact details.

```text
{% if healthcare.agent.primary.phone %}
Phone: {{ healthcare.agent.primary.phone }}
{% endif %}
```

### Client, spouse, and children

| Variable | Type | Meaning |
| --- | --- | --- |
| `client.full_name` | string | Client's full legal name. |
| `client.aka` | string | Also-known-as name. |
| `client.street_address` | string | Street address. |
| `client.city` | string | City or town. |
| `client.state` | string | State code, normally `MA`. |
| `client.county` | string | County of residence or execution context. |
| `client.signing_county` | string | Signing county copied from execution data. |
| `client.email` | string | Email address. |
| `client.phone` | string | Formatted phone number. |
| `client.date_of_birth` | string | Long-form date of birth. |
| `client.pronoun_subject` | string | `he`, `she`, `they`, or configured equivalent. |
| `client.pronoun_object` | string | `him`, `her`, `them`, or configured equivalent. |
| `client.pronoun_possessive` | string | `his`, `her`, `their`, or configured equivalent. |
| `spouse.exists` | boolean | Whether spouse data is present. |
| `spouse.full_name` | string | Spouse's full legal name. |
| `spouse.date_of_birth` | string | Long-form spouse date of birth. |
| `spouse.pronoun_subject` | string | Spouse subject pronoun. |
| `spouse.pronoun_object` | string | Spouse object pronoun. |
| `spouse.pronoun_possessive` | string | Spouse possessive pronoun. |
| `children` | array | All named children. |
| `minor_children` | array | Named children marked as minors. |

Each item in `children` or `minor_children` exposes:

```text
full_name
date_of_birth
dob
relationship
parentage
gender
gender_display
deceased
minor
young_adult_estate_plan
```

Example:

```text
{% for child in children %}
{{ child.full_name | name }}{% if child.date_of_birth %}, born {{ child.date_of_birth }}{% endif %}{% if not loop.last %}; {% endif %}
{% endfor %}
```

### Document-selection and planning fields

| Variable | Type |
| --- | --- |
| `planning.uses_revocable_trust` | boolean |
| `planning.has_minor_children` | boolean |
| `planning.include_trust` | boolean |
| `planning.include_pour_over_will` | boolean |
| `planning.include_simple_will` | boolean |
| `planning.include_testamentary_trust_will` | boolean |
| `planning.include_dpoa` | boolean |
| `planning.include_hcp` | boolean |
| `planning.include_hipaa` | boolean |
| `planning.include_ahd` | boolean |
| `planning.include_ppm` | boolean |
| `planning.include_parental_appointment` | boolean |
| `planning.include_young_adult_estate_plan` | boolean |
| `planning.spouse_docs` | boolean |
| `planning.client_goals` | string |
| `planning.client_concerns` | string |

### Will variables

| Variable | Type / values |
| --- | --- |
| `will.pr_structure` | `single`, `spouse_first`, or `co_pr` |
| `will.bond` | `no_bond` or `required` |
| `will.supervision` | `unsupervised` or `supervised` |
| `will.simultaneous_death` | `spouse_survives`, `testator_survives`, or `omit` |
| `will.utma_age` | number |
| `will.no_contest_clause` | `include` or `omit` |
| `will.include_disclaimer_article` | boolean |
| `will.include_self_proving_affidavit` | boolean |
| `will.tangible_personal_property.distribution_method` | `children_then_descendants`, `spouse_then_children`, `named_then_children`, `memorandum`, or the stored selection |
| `will.tangible_personal_property.named_individual` | person |
| `will.pet_care.option` | `omit`, `direct_bequest`, or `pet_trust` |
| `will.pet_care.cash_amount` | formatted currency string |
| `will.pet_care.primary_caretaker` | person |
| `will.pet_care.successor_caretaker` | person |
| `will.pet_care.pet_trustee` | person |
| `will.pet_care.remainder_beneficiary` | person |
| `will.pet_care.enforcer` | person |

Standalone and pour-over Will fields:

| Variable | Type / values |
| --- | --- |
| `pour_over.alternate_disposition` | `spouse_then_descendants`, `descendants_only`, or `named` |
| `pour_over.alternate_named` | person |
| `pour_over.alternate_disposition_text` | fully composed legal sentence |
| `outright_will.residuary.disposition` | `spouse_then_descendants`, `descendants_then_heirs`, or `named` |
| `outright_will.residuary.named` | person |
| `outright_will.residuary.alternate` | person |

### Trust variables

| Variable | Type / meaning |
| --- | --- |
| `trust.name` | Trust name. |
| `trust.spouse_name` | Spouse-side trust name, where applicable. |
| `trust.display_name` | Display-form trust name. |
| `trust.spouse_display_name` | Display-form spouse trust name. |
| `trust.date` | Long-form trust date. |
| `trust.display_date` | Trust date or `________________, 20___`. |
| `trust.restatement` | Stored restatement selection. |
| `trust.spousal_funding` | Stored spousal-funding selection. |
| `trust.initial_trustee_nomination` | Stored initial-trustee selection. |
| `trust.trustee_compensation` | Stored compensation selection. |
| `trust.successor_trustee_vacancy` | Stored vacancy selection. |
| `trust.residual_beneficiary` | Stored residual-beneficiary selection. |
| `trust.residuary_after_death` | Stored after-death disposition. |
| `trust.include_common_trust_for_children` | boolean |
| `trust.special_distributions_age` | number or string age. |
| `trust.representation_type` | Stored representation selection. |
| `trust.survivorship_requirement_days` | number of days. |
| `trust.trust_protector_requested` | boolean or stored selection. |
| `trust.trust_protector` | person |
| `trust.name_format` | Stored client-name format. |
| `trust.spouse_name_format` | Stored spouse-name format. |
| `trust.contingent_beneficiary` | person |
| `trust.tangible_personal_property.distribution_method` | Stored trust TPP method. |
| `trust.descendants_distribution.method` | `outright`, `staged`, or stored method. |
| `trust.descendants_distribution.distribution_age` | string age. |
| `trust.descendants_distribution.stage_1_age` | string age. |
| `trust.descendants_distribution.stage_2_age` | string age. |
| `trust.descendants_distribution.stage_3_age` | string age. |
| `trust.remote_beneficiaries.method` | Stored remote-beneficiary method. |
| `trust.remote_beneficiaries.individuals` | array of person objects. |
| `trust.remote_beneficiaries.charity.name` | charity name. |
| `trust.disinherited` | array of `{ full_name, relationship }`. |
| `trust.blended_family.client_children` | array of `{ full_name }`. |
| `trust.blended_family.spouse_children` | array of `{ full_name }`. |
| `trust.disinherit_issue` | boolean. |

Trust provision switches under `trust.provisions`:

```text
protect_us_trust_status
allow_special_trustee
special_trustee_instructions
power_529_plans
power_farms_ranches
power_closely_held_businesses
power_professional_corporations
subchapter_s_provisions
allow_trustee_change_situs
hold_distributions_for_young_beneficiaries
include_substance_abuse
include_creditor_divorce_provisions
include_contingent_snt
allow_distributions_to_dependents_if_incapacitated
include_no_contest_clause
name_people_in_no_contest_clause
require_mandatory_arbitration
prorate_estate_taxes
include_discretionary_distribution_definition
include_education_expenses_definition
include_arts_education
include_vocational_training
include_homeschooling
include_disappearance_definition
```

All are booleans except `special_trustee_instructions`, which is text.

### Testamentary-trust variables

| Variable | Type / values |
| --- | --- |
| `testamentary_trust.trustee_structure` | `single`, `spouse_first`, `co_trustees`, or empty |
| `testamentary_trust.beneficiary_structure` | Stored beneficiary structure. |
| `testamentary_trust.age_distribution_schedule` | Stored distribution schedule. |
| `testamentary_trust.single_beneficiary` | person |
| `testamentary_trust.remainder_beneficiary` | person |
| `testamentary_trust.trust_protector_requested` | boolean |
| `testamentary_trust.trust_protector` | person |

### Fiduciary variables

Use the reusable person fields under each supported role and slot.

| Object path | Supported slots / children |
| --- | --- |
| `fiduciaries.executor` | `primary`, `co_primary`, `successor`, `co_successor`, `second_successor` |
| `fiduciaries.spouse_executor` | `primary`, `co_primary`, `successor`, `co_successor`, `second_successor` |
| `fiduciaries.trustee` | `primary`, `co_primary`, `successor`, `co_successor`, `second_successor`, `co_second_successor`, plus `co_trustees_action` |
| `fiduciaries.testamentary_trustee` | `primary`, `co_primary`, `successor`, plus `co_trustees_action` |
| `fiduciaries.spouse_testamentary_trustee` | `primary`, `co_primary`, `successor`, plus `co_trustees_action` |
| `fiduciaries.agent` | `primary`, `co_primary`, `successor`, plus `co_agents_action` and `primary_has_spouse` |
| `fiduciaries.spouse_agent` | `primary`, `co_primary`, `successor`, plus `co_agents_action` and `primary_has_spouse` |

Examples:

```text
{{ fiduciaries.executor.primary.full_name | name }}
{{ fiduciaries.trustee.co_successor.full_name | name }}
{{ fiduciaries.agent.primary.address }}
{{ fiduciaries.agent.co_agents_action }}
```

`fiduciary_display` exposes the five document-display switches:

```text
fiduciary_display.show_phone
fiduciary_display.show_address
fiduciary_display.show_email
fiduciary_display.show_dob
fiduciary_display.show_relationship
```

### Durable-power-of-attorney variables

| Variable | Type / meaning |
| --- | --- |
| `dpoa.coagent_manner` | Stored co-agent manner. |
| `dpoa.coagent_serving` | Stored co-agent serving selection. |
| `dpoa.include_section_l` | boolean |
| `dpoa.include_entity_powers` | boolean |
| `dpoa.include_advanced_trust_gifting` | boolean |
| `dpoa.include_extended_personal_care` | boolean |
| `dpoa.agent_compensation` | Stored compensation selection. |
| `dpoa.allow_gifts` | Stored gifting selection. |
| `dpoa.all_basic_powers` | boolean |
| `dpoa.basic_powers` | object containing the saved basic-power switches. |
| `dpoa.additional_powers` | Saved additional powers. |
| `dpoa.specific_businesses` | Saved business descriptions. |
| `dpoa.additional_limitations` | Saved limitations text. |
| `dpoa.include_trust_powers` | boolean — false when the design sheet says not to include trust powers. |
| `dpoa.trust_powers` | Saved trust-power selections; every switch is false when `include_trust_powers` is false. |
| `dpoa.special_powers` | Saved special-power selections. |
| `dpoa.self_dealing_reviewer` | person |
| `dpoa.self_dealing_reviewer_alt` | person |

Boolean fields under `dpoa.trust_powers`:

```text
agent_may_create_trusts
agent_may_create_trusts_for_dependents
allow_agent_as_trustee
agent_may_create_medicaid_trusts
agent_may_modify_sole_settlor_trusts
agent_may_modify_joint_trusts
```

Boolean fields under `dpoa.special_powers`:

```text
allow_delegation
prohibit_arbitration
power_529_plans
allow_medical_information_access
power_digital_assets
allow_self_designation_beneficiary
```

Boolean fields under `dpoa.basic_powers`:

```text
real_property
tangible_personal_property
stocks_bonds
commodities_options
banking
business_operating
insurance_annuity
estate_trust_beneficiary
claims_litigation
personal_family_maintenance
government_benefits
retirement_plans
tax_matters
```

### Health care and HIPAA variables

| Object path | Meaning |
| --- | --- |
| `healthcare.agent.primary` | Primary client health-care agent person. |
| `healthcare.agent.alternate` | First alternate client health-care agent person. |
| `healthcare.agent.second_alternate` | Empty person slot reserved by the context. |
| `healthcare.spouse_agent.primary` | Primary spouse health-care agent person. |
| `healthcare.spouse_agent.alternate` | Alternate spouse health-care agent person. |
| `healthcare.anatomical_gift` | `all`, `specified`, `none`, or unset. |
| `healthcare.anatomical_specified` | Specified organs, tissues, or purposes. |
| `healthcare.client_anatomical_gift` | Client election from the design sheet. |
| `healthcare.spouse_anatomical_gift` | Spouse election from the design sheet. |
| `healthcare.spouse_anatomical_restrictions` | Spouse restrictions text. |
| `healthcare.client_advance_directive` | Client directive selection. |
| `healthcare.spouse_advance_directive` | Spouse directive selection. |
| `hipaa.psychotherapy_notes` | `authorize`, `do_not_authorize`, or unset. |
| `hipaa.include_poa` | boolean |
| `hipaa.include_trustees` | boolean |
| `hipaa.list_fiduciaries_by_name` | `by_name`, `general_language`, or stored selection. |
| `hipaa.client_additional_agents` | array of person objects. |
| `hipaa.spouse_additional_agents` | array of person objects. |

### Execution variables

| Variable | Type / meaning |
| --- | --- |
| `execution.signing_scheduled` | boolean |
| `execution.doc_date` | Actual signing date when known. |
| `execution.ordinal_doc_date` | Actual ordinal date phrase when known. |
| `execution.signing_county` | Actual signing county when known. |
| `execution.notary_commission` | Actual notary commission expiration when known. |
| `execution.id_type` | Defaults to `government-issued photo identification`. |
| `execution.display_doc_date` | Actual date or safe blank line. |
| `execution.display_ordinal_doc_date` | Actual ordinal date or safe blank ordinal line. |
| `execution.display_signing_county` | Actual county or safe blank line. |
| `execution.display_notary_commission` | Actual commission expiration or empty. |

Prefer the `display_` variables in legal documents.

### Guardians, family, gifts, assets, funding, homestead, and tax

Guardian person objects:

```text
guardians.primary
guardians.successor
guardians.second_successor
guardians.temporary
guardians.temporary_co
guardians.temporary_successor
guardians.temporary_second_successor
guardians.excluded[]
```

Family variables:

```text
family.blended_family
family.include_child_gender_markers
family.include_afterborn_children
family.include_expectant_children
family.omissions_intentional
family.include_general_disinheritance
family.disinherit_issue
family.additional_disinheritance_language
family.disinherited[]
```

Gift arrays:

| Variable | Item fields |
| --- | --- |
| `specific_gifts` | `item`, `recipient` |
| `charitable_gifts` | `item`, `recipient` |

Asset and funding variables:

| Variable | Type / item fields |
| --- | --- |
| `assets.real_property` | boolean |
| `assets.total_gross_value` | formatted currency |
| `assets.total_net_value` | formatted currency |
| `assets.items` | array |
| `assets.items[].category` | category key |
| `assets.items[].category_label` | human-readable category |
| `assets.items[].description` | description |
| `assets.items[].institution` | institution |
| `assets.items[].owner` | currently `null` unless supplied by a specialized context |
| `assets.items[].estimated_value` | formatted currency |
| `assets.items[].gross_value` | formatted currency |
| `assets.items[].net_value` | formatted currency |
| `assets.items[].notes` | notes |
| `assets.items[].from_intake` | boolean |
| `funding_plan.narrative` | generated or saved narrative |
| `funding_plan.checklist_items` | array of `{ number, action, trust, priority }` |

Homestead fields:

```text
homestead.beneficiary_names
homestead.primary_beneficiary_name
homestead.beneficiary_pronoun_possessive
homestead.trustee_pronoun_possessive
homestead.servicemember_names
homestead.property_address_line
homestead.trust_deed_book
homestead.trust_deed_page
homestead.deed_registry_district
homestead.deed_book
homestead.deed_page
homestead.certificate_number
homestead.land_court_document_number
```

Other root values:

| Variable | Type / meaning |
| --- | --- |
| `tax.sensitive_estate` | boolean |
| `drafting_notes` | combined special-provisions or matter notes text |
| `young_adult.parent1` | person used by the young-adult package |
| `young_adult.parent2` | person used by the young-adult package |

### Computed condition flags

These root booleans are intended for `{% if %}` blocks:

```text
has_spouse
has_children
has_minor_children
has_blended_family
has_co_poa
has_solo_poa
co_poa_joint
co_poa_majority
co_poa_separate
aif_has_spouse
has_dpoa_self_dealing_reviewer
has_dpoa_self_dealing_reviewer_alt
hcp_anatomical_all
hcp_anatomical_specified
hcp_anatomical_none
hcp_anatomical_defer
hcp_client_advance_prolong_life
hcp_client_advance_dnr
hcp_client_advance_do_not_prolong
hcp_spouse_advance_prolong_life
hcp_spouse_advance_dnr
hcp_spouse_advance_do_not_prolong
hipaa_psychotherapy_authorized
hipaa_include_poa
hipaa_include_trustees
hipaa_list_fiduciaries_by_name
hipaa_list_fiduciaries_general
uses_revocable_trust
requires_guardian_clause
has_specific_gifts
has_charitable_gifts
has_tangible_personal_property
has_pet_care
has_simultaneous_death
has_excluded_guardians
has_disinherited
include_child_gender_markers
include_afterborn_children
include_expectant_children
omissions_intentional
include_general_disinheritance
disinherit_issue
owns_real_property
has_assets
tax_sensitive_estate
state_requires_self_proving_affidavit
signing_scheduled
```

State metadata is also available:

```text
state.code
state.state
state.requires_self_proving_affidavit
state.witness_count
state.notary_required_for_self_proving_affidavit
state.notes
```

### Estate conditionals, loops, and clauses

Conditional example:

```text
{% if has_spouse %}
Spouse: {{ spouse.full_name | name }}
{% else %}
The client is not married.
{% endif %}
```

Loop example:

```text
{% for person in guardians.excluded %}
{{ person.full_name | name }}{% if person.reason %}: {{ person.reason }}{% endif %}
{% endfor %}
```

Clause inclusion:

```text
{{ include_clause("will.executor_appointment") }}
{{ include_clause("execution.self_proving_affidavit", state.code) }}
```

Currently available clause IDs:

```text
execution.self_proving_affidavit
execution.signing_block
healthcare.agent_appointment
hipaa.authorization
poa.agent_appointment
testamentary_will.residuary_testamentary_trust
testamentary_will.trust_protector
testamentary_will.trustee_nomination
trust.spendthrift
trust.trustee_appointment
will.bond_supervision
will.disclaimer
will.executor_appointment
will.family_declaration
will.guardian_nomination
will.no_contest
will.pet_care
will.residuary_outright
will.simultaneous_death
will.specific_gifts
will.tangible_personal_property
will.utma
```

### Legacy bracket markers

New estate templates should use `{{ ... }}` variables. The runtime only retains these three static bracket replacements for compatibility:

```text
[CLIENT]
[CLIENT FULL NAME]
[TRUST NAME]
```

Other legacy markers such as `[DocDate]` are not the authoring format for uploaded estate templates.

## Real-estate transfer templates

Real-estate templates use Docxtemplater single-brace fields. Deed templates also receive the `boundary_calls` loop and computed presentation fields described below.

```text
{grantor}
{property_address}
{execution_date}
```

All supported real-estate variables:

| Variable | Meaning |
| --- | --- |
| `{grantor}` | Grantor name or names. |
| `{grantor_2}` | Second grantor, or empty when there is only one. |
| `{grantor_display}` | First grantor plus an optional second grantor joined with `and`; names are uppercase. |
| `{grantor_defined_term}` | `Grantor` or `Grantors`. |
| `{grantor_possessive}` | `Grantor’s` or `Grantors’`. |
| `{grantor_person_phrase}` | Singular/plural notary phrase. |
| `{grantor_pronoun}` | Singular/plural acknowledgement phrase. |
| `{witness_phrase}` | `my hand and seal` or `our hands and seals`. |
| `{grantee}` | Grantee name or names. |
| `{trustees}` | Trustee name or names. |
| `{trustee_title}` | `Trustee` or `Trustees`. |
| `{settlor}` | Settlor name or names. |
| `{trust_name}` | Realty trust name. |
| `{trust_name_upper}` | Realty trust name in uppercase for the deed. |
| `{trust_date}` | Realty trust date. |
| `{beneficial_owners}` | Beneficial-owner names. |
| `{property_address}` | Property street address. |
| `{property_city}` | City or town. |
| `{property_state}` | State. |
| `{property_county}` | County. |
| `{legal_description}` | Legal description. |
| `{property_description}` | Opening legal-description paragraph; falls back to `legal_description` for older saved matters. |
| `{description_2}` | Optional second description/easement paragraph. |
| `{description_type}` | `lot_plan` or `metes_and_bounds`. |
| `{recording_system}` | `registry` or `land_court`; selects the deed master. |
| `{recording_date}` | Date the uploaded current deed was recorded. |
| `{registry_of_deeds}` | Full Registry of Deeds or Land Court district name. |
| `{current_deed_book_number}` | Book number of the uploaded current Registry deed. |
| `{current_deed_page}` | Page number of the uploaded current Registry deed. |
| `{current_deed_document_number}` | Document number of the uploaded current registered-land deed. |
| `{current_certificate_number}` | Certificate of Title number for the uploaded current registered-land deed. |
| `{grantee_mailing_address}` | Grantee mailing address, defaulting to the property address. |
| `{property_address_line}` | Street, city/town, and state combined as a single line. |
| `{document_date_blank}` | Literal `________________________`; the signing date is never copied from the current deed. |
| `{signing_county}` | Certificate execution county, falling back to the property county. |
| `{notary_commission_blank}` | Literal fill-in line for the notary commission expiration. |
| `{prior_deed_book}` | Prior deed book. |
| `{prior_deed_page}` | Prior deed page. |
| `{prior_deed_date}` | Prior deed date. |
| `{registry_district}` | Registry of deeds or land-court district. |
| `{parcel_id}` | Parcel or map-lot identifier. |
| `{certificate_number}` | Certificate number. |
| `{consideration}` | Consideration. |
| `{execution_date}` | Execution date. |
| `{certificate_execution_county}` | Certificate execution county. |
| `{trust_term_extension_years}` | Successive trust-term length in years. |

An absent value renders as an empty string. Matter validation reports missing matter data as warnings; unresolved template markers block publication.

Metes-and-bounds rows use a Docxtemplater paragraph loop and are not limited to six calls:

```text
{#boundary_calls}
{directional_call}        {bound_description}
{/boundary_calls}
```

For a lot/plan deed, `boundary_calls` is an empty array and the complete description belongs in `{property_description}`. Grantor signatures use the same loop pattern with `{#grantors}` and `{name}` so the second signature block disappears completely when no second grantor exists.

## Engagement-agreement templates

Three masters exist, all standard scope. `lib/engagement/templates.ts` maps a definition to its master, and a definition with no master cannot be drafted at all.

| Master | Definition | Signers |
| --- | --- | --- |
| `ep-trust-couple` | Estate Planning, couple, no legal plan. | 2 |
| `ep-lp-trust-couple` | Estate Planning - LP, couple, on a named legal plan. | 2 |
| `ep-lp-trust-individual` | Estate Planning - LP, solo client, on a named legal plan. | 1 |

A master's `recipientCount` is what decides which anchors it must carry: a one-signer master has `[[CLIENT_1_*]]` only, and a `[[CLIENT_2_*]]` left in it would be a line nobody can sign.

Scalar variables shared by both:

| Variable | Meaning |
| --- | --- |
| `{agreement_date}` | Agreement date. |
| `{primary_name}` | Primary client's name. |
| `{primary_email}` | Primary client's email. |
| `{spouse_name}` | Spouse/client-two name. |
| `{spouse_email}` | Spouse/client-two email. |

`ep-trust-couple` only — the firm's own fee, which a plan-funded letter does not state:

| Variable | Meaning |
| --- | --- |
| `{flat_fee}` | Fee formatted as U.S. currency. |
| `{payment_terms}` | Payment terms. |

The legal-plan masters only:

| Variable | Meaning | Masters |
| --- | --- | --- |
| `{legal_plan}` | The plan's display name, e.g. `MetLife`. | both |
| `{credit_shelter_checkbox}` | `☒` or `☐` for the Optional Services addendum row. | couple |
| `{deed_recording_checkbox}` | `☒` or `☐` for the Optional Services addendum row. | both |

Each master declares the services its addendum prints (`optionalServiceKeys`), and `OPTIONAL_SERVICES` in `lib/engagement/definitions.ts` names the merge field for each. A master is offered only the services it prints, so electing one it does not list is a validation error rather than a silently ignored key — the solo master has no credit-shelter row, because that planning preserves both spouses' Massachusetts exemptions.

The addendum's boxes are set when the agreement is drafted, from the elected `optionalClauseKeys`, not by the signer: the e-signature pipeline places signature and date fields only, so there is no client-fillable checkbox. The client adopts the marked services by signing the agreement that contains them.

Clause arrays:

```text
{#additional_clauses}
{title}
{text}
{/additional_clauses}

{#schedule_a_clauses}
{title}
{text}
{/schedule_a_clauses}
```

Each clause item exposes:

```text
id
title
text
source
aiProvenance
```

Only `title` and `text` are used by the bundled masters.

### Required signing anchors

One signature and one date anchor per signer, each appearing exactly once in the rendered engagement PDF. A two-signer master therefore carries all four:

```text
[[CLIENT_1_SIGNATURE]]
[[CLIENT_1_DATE]]
[[CLIENT_2_SIGNATURE]]
[[CLIENT_2_DATE]]
```

and a one-signer master carries the `CLIENT_1` pair alone. Signers are numbered by position, never by role — there is no `[[SPOUSE_*]]` anchor.

Do not place braces around these anchors. Publication validation also requires a valid US-Letter PDF conversion.

Keep the signature block on one page: give every row of its table `w:cantSplit` and every paragraph above the last row `w:keepNext`. Word will otherwise break the table between rows, leaving the signature line at the foot of one page and the date at the head of the next.

## Authoring and validation rules

- Start from the current source download in the Templates center.
- Keep each template's existing renderer syntax.
- Do not introduce a new document type, payload field, package, clause, or routing rule through an uploaded DOCX; those require a repository change.
- Avoid letting Word split one template tag across differently formatted runs. The estate renderer repairs many split Nunjucks tags, but a contiguous tag is safer.
- For estate templates, put control-only `{% if %}`, `{% endif %}`, `{% for %}`, and `{% endfor %}` tags in their own paragraphs or table rows when practical.
- Validate against a compatible matter before publication.
- Missing matter-specific values are warnings. Malformed syntax, unresolved markers, rendering errors, invalid engagement PDFs, and missing engagement anchors block publication.
- Publishing changes only future generations. Existing generated documents remain unchanged.

## Code-owned sources of truth

| Subject | Source |
| --- | --- |
| Template registry and renderer category | `lib/documentTemplates/registry.ts` |
| Estate payload-to-context mapping | `lib/estateGenerator/toGeneratorData.ts` |
| Estate computed fields and flags | `lib/estateGenerator/node/context.ts` |
| Estate rendering syntax and filters | `lib/estateGenerator/node/renderText.ts` |
| Estate DOCX processing | `lib/estateGenerator/node/templateRenderer.ts` |
| Estate canonical data dictionary | `tools/aubreylaw-docgeneration/schemas/data-dictionary.json` |
| Estate authoring guide | `tools/aubreylaw-docgeneration/docs/document-template-guide.md` |
| Real-estate flat fields | `lib/realEstateTransfer/fields.ts` |
| Engagement scalar and array context | `lib/engagement/render.ts` |
| Engagement input types | `lib/engagement/types.ts` |
