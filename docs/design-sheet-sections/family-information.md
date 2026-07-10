# Family Information

**Section ID:** `family-information`  
**UI:** `app/admin/drafting/[matterId]/design/sections/FamilySection.tsx`  
**Source files:** `lib/draftPayload/familyProvisions.ts`, `lib/draftPayload/helpers.ts` (`draftPayloadChildren`), `lib/estateGenerator/toGeneratorData.ts`

## Design sheet fields

| Field | Storage | Notes |
| --- | --- | --- |
| `children[]` | column | `DesignSheetChild`: name, gender, dob, deceased, parentage, relationship, `is_minor` |
| `include_child_gender_markers` | column | yes/no |
| `include_afterborn_children` | column | yes/no (default yes in payload) |
| `include_expectant_children` | column | yes/no (default yes) |
| `omissions_intentional` | column | yes/no |
| `disinherited_children[]` | column | string names |
| `disinheritances[]` | column | `{ name, relationship, reason }` |
| `include_general_disinheritance` | column | yes/no (default yes) |
| `disinherit_issue` | column | yes/no |
| `additional_disinheritance_language` | column | free text |
| `include_additional_beneficiaries` | column | UI flag |
| `additional_beneficiaries[]` | column | Not in generator JSON today |

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

### Blended family

When married and any child has `parentage` of `client` or `spouse`:

- `has_blended_family` context flag = true
- `trust.blended_family` = `{ client_children[], spouse_children[] }`

## Template placeholders

```text
{% for child in children %}
  {{ child.full_name | name }}{% if not loop.last %}, {% endif %}
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

## Recent updates & template gaps

| Gap | Action needed |
| --- | --- |
| `additional_beneficiaries[]` | No payload mapping — add if templates need non-child beneficiaries |
| Child name shapes | Intake may seed `first/middle/last`; generator normalizes via `childFullName()` |
| `is_minor` vs DOB | Minor flag is sheet boolean, not recomputed from DOB at generation |
| Disinheritance reasons | `disinheritances[].reason` not passed to generator — only name + relationship |
