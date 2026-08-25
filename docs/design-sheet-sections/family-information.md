# Family Information

**Nav label:** Last Will and Testament (`DESIGN_SHEET_GROUP_IDS.family`)
**Section ID:** `family-information`
**UI:** `app/admin/drafting/[matterId]/design/sections/FamilySection.tsx`
**Source files:** `lib/draftPayload/familyProvisions.ts`, `lib/draftPayload/helpers.ts` (`draftPayloadChildren`), `lib/estateGenerator/toGeneratorData.ts`

> **This section is one question.** `FamilySection.tsx` renders a single "Will title"
> `DecisionRow` and nothing else. The family data this guide describes is *collected*
> in two other places — see the table below — but it still reaches the generator
> through `family.*` and `children[]`, so the mapping is documented here.

## Where the family fields actually live

| Data | Section that collects it | Component |
| --- | --- | --- |
| Will title | Last Will and Testament | `FamilySection.tsx` |
| `children[]` (add / edit / remove, minor flags, disinherited-child checkboxes) | Client Information | `PersonalSection.tsx` (`ClientInformationSection`) |
| Child option toggles, disinherited heirs, additional beneficiaries | Estate Plan Design | `PlanStructureFactsSection.tsx` (rendered inside `PlanDesignSection`) |

`PlanStructureFactsSection` blocks: **Children Options**, **Disinherited Heirs**,
**Additional Beneficiaries**.

## Design sheet fields

| Field | Storage | Collected in | Notes |
| --- | --- | --- | --- |
| `children[]` | column | Client Information | `DesignSheetChild`: name, gender, dob, deceased, parentage, relationship, `is_minor` |
| `include_child_gender_markers` | column | Estate Plan Design | yes/no |
| `include_afterborn_children` | column | Estate Plan Design | yes/no (default yes in payload) |
| `include_expectant_children` | column | Estate Plan Design | yes/no (default yes). Labelled "Include posthumous children" in the UI |
| `omissions_intentional` | column | Estate Plan Design | yes/no |
| `disinherited_children[]` | column | Client Information | string names, kept in step when a child is renamed |
| `disinheritances[]` | column | Estate Plan Design | `{ name, relationship, reason }` |
| `include_general_disinheritance` | column | Estate Plan Design | yes/no (default yes) |
| `disinherit_issue` | column | Estate Plan Design | yes/no |
| `additional_disinheritance_language` | column | Estate Plan Design | free text |
| `include_additional_beneficiaries` | column | Estate Plan Design | UI flag |
| `additional_beneficiaries[]` | column | Estate Plan Design | `{ full_name, kind, relationship }` |
| `estate_plan_design.will_title` | `decisions` | **this section** | `last_will` \| `pour_over_will` |

## Generator mapping

### Children

`draftPayloadChildren()` → `payload.children[]` → `EstateGeneratorData.children[]`:

| Sheet | Generator child field |
| --- | --- |
| `name` or first/middle/last | `full_name` |
| `dob` | `dob`, `date_of_birth` (long form) |
| `is_minor` | `minor` |
| `gender` | `gender`, `gender_display` |
| `parentage` | `parentage` (`client` / `spouse`) |
| `relationship` | `relationship` |
| `deceased` | `deceased` |

Minor children drive `matter.minor_children`, `planning.has_minor_children`, and package inclusion for parental appointment.

### Family provisions

`draftPayloadFamilyProvisions()` → `payload.family_provisions` → `family.*` and context flags:

| Sheet (yes/no) | Generator |
| --- | --- |
| `include_child_gender_markers` | `family.include_child_gender_markers`, `include_child_gender_markers` flag |
| `include_afterborn_children` | `family.include_afterborn_children`, context flag |
| `include_expectant_children` | `family.include_expectant_children`, context flag |
| `omissions_intentional` | `family.omissions_intentional`, context flag |
| `include_general_disinheritance` | `family.include_general_disinheritance`, context flag |
| `disinherit_issue` | `family.disinherit_issue`, `trust.disinherit_issue` |
| `additional_disinheritance_language` | `family.additional_disinheritance_language` |
| disinherited lists | `family.disinherited[]`, `trust.disinherited[]` |
| `additional_beneficiaries[]` | `family.additional_beneficiaries[]` — `full_name`, `kind`, `relationship` |

### Will title

`estate_plan_design.will_title` → `documents.will_title` → `will.title`
(`last_will` / `pour_over_will`). The interview worksheet ticks its "Will Title"
options from this path.

### Blended family

When married and any child has `parentage` of `client` or `spouse`:

- `has_blended_family` context flag = true
- `trust.blended_family` = `{ client_children[], spouse_children[] }`

## Template placeholders

```text
{% for child in children %}
  {{ child.full_name | name }}{% if not loop.last %}, {% endif %}
{% endfor %}

{{ will.title }}
{% for beneficiary in family.additional_beneficiaries %}
  {{ beneficiary.full_name | name }} — {{ beneficiary.relationship | optional }}
{% endfor %}

{% if has_children %}...{% endif %}
{% if has_minor_children %}...{% endif %}
{% if requires_guardian_clause %}...{% endif %}  {# same as has_minor_children #}
{% if has_blended_family %}...{% endif %}
{% if has_disinherited %}{{ include_clause("...") }}{% endif %}
```

## Conditional logic (current)

| Flag | Source | Clause / template |
| --- | --- | --- |
| `has_children` | `children.length > 0` | `will.family_declaration` |
| `has_minor_children` | any child `minor: true` | Minor-child references |
| `requires_guardian_clause` | `has_minor_children` | `will.guardian_nomination` (`condition`) |
| `has_blended_family` | parentage split when married | Trust articles (joint trust templates) |
| `has_disinherited` | `trust.disinherited` non-empty | Disinheritance paragraphs |
| `include_child_gender_markers` | family provisions | Child definition articles |
| `include_afterborn_children` | family provisions | Afterborn/expectant child language |
| `include_expectant_children` | family provisions | Expectant child language |
| `include_general_disinheritance` | family provisions | General disinheritance block |
| `disinherit_issue` | family provisions | Issue disinheritance |
| `omissions_intentional` | family provisions | Intentional omission language |

`sheetYesNo()` defaults: afterborn/expectant/general disinheritance default **yes** unless explicitly `no`.

## Package triggers from family data

| Condition | Document |
| --- | --- |
| Any minor child | `parental-guardian-appointment` (if EP) |
| Minor children | `temporary-delegation-parental-powers` (if `include_temp_delegation`) |
| Young adult child (age 17.5–25) + inclusion toggle | `young-adult-estate-plan` |

## Known gaps

| Gap | Notes |
| --- | --- |
| Child name shapes | Intake may seed `first/middle/last`; generator normalizes via `childFullName()` |
| `is_minor` vs DOB | Minor flag is a sheet boolean, not recomputed from DOB at generation |
| Disinheritance reasons | `disinheritances[].reason` is collected but not passed to the generator — only name + relationship |
| Parent-child relationship definition | Captured as `trust_details.parent_child_relationship_definition` → `trust.provisions.parent_child_relationship_definition`. Its control sits in Trust Details → Definitions, because that is the article it is drafted into — see the Trust Details guide. A custom definition has no accompanying free-text field; the worksheet does not ask for one either. |
