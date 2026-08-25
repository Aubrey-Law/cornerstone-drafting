# Will Details

**Section ID:** `will-details`  
**UI:** `DocumentSections.tsx`, `WillProvisionsSection.tsx`, `WillPersonalRepresentativePowersSection.tsx`, `ExcludedGuardiansSection.tsx`  
**Visibility:** `document_inclusions.will === true`  
**Source files:** `lib/draftPayload/assemble.ts`, `lib/designSheetWillPowers.ts`, `lib/designSheet/excludedGuardians.ts`

## Design sheet fields

### Fiduciary / structure

| Field | Notes |
| --- | --- |
| `executor_slots`, `spouse_executor_slots` | PR nominations |
| `guardian_slots`, `temporary_guardian_slots` | Guardian nominations |
| `executor_same_as_trustee` | Copy from trustee |
| `pr_structure` | `single`, `co_pr`, `spouse_first` |
| `trustee_structure`, `cotrustee_decision_standard` | Testamentary trust co-trustees |
| `bond`, `supervision` | `no_bond`/`required`, `unsupervised`/`supervised` |

### Will provisions

| Field | Notes |
| --- | --- |
| `simultaneous_death` | `omit`, `spouse_survives`, `testator_survives` |
| `utma_age` | 18 or 21 |
| `no_contest_clause` | `omit` \| `include` (may be overridden by trust) |
| `include_disclaimer_article` | boolean (default true) |
| `include_self_proving_affidavit` | boolean (default true) |
| `tangible_property_distribution`, `tangible_property_named_individual` | TPP article |
| `specific_bequests` | `{ kind, amount, beneficiary_name, item_description, charity_name }` |
| `pet_care_option`, `pet_care_details` | `omit`, `direct_bequest`, `pet_trust` |

### Plan-type-specific residuary

| Plan type | Fields |
| --- | --- |
| Pour-over | `pour_over_alternate_disposition`, `pour_over_alternate_named`, `trust_date` |
| Outright will | `outright_residuary`, `outright_residuary_named`, `outright_residuary_alternate` |
| Testamentary trust | `beneficiary_structure`, `single_beneficiary_name`, `single_beneficiary_remainder`, `age_distribution_schedule`, `trust_protector_name` |

### Excluded guardians

| Field | Storage |
| --- | --- |
| `excluded_guardian_flag` | column |
| `excluded_guardian_name` | column — formatted string from entries |
| `decisions.excluded_guardians` | `[{ contact_id, reason }]` |

### Will title

`decisions.estate_plan_design.will_title` (`last_will` \| `pour_over_will`). Its control
is the single question in `FamilySection.tsx`, under the **Last Will and Testament**
nav group — see the Family Information guide.

### DPOA cross-over (will section)

`dpoa_include_section_l`, `dpoa_include_self_dealing`, `dpoa_self_dealing_reviewer`, `dpoa_self_dealing_reviewer_alt`

> The HIPAA psychotherapy-notes control used to live in `WillProvisionsSection`
> behind a `scope === 'healthcare'` guard, in a section only ever rendered with
> `scope="will"` — so it could never be answered. It now lives in
> `HealthCareDesignSection`, with a test pinning it there.

### PR powers

`decisions.will_pr_powers` via `getWillPersonalRepresentativePowers()` — three granular
statutory powers: `allow_pay_taxes_debts_expenses`, `allow_manage_digital_assets`,
`include_distribution_cash_or_kind`.

### `decisions.will_provisions` (jsonb)

Will provisions that are decisions rather than columns. Distinct from
`will_pr_powers`, which is specifically the personal representative's statutory
powers — these are provisions of the will itself. Every other will provision above is
a real column because they predate the decisions blob; new ones go here.

| Field | Type |
| --- | --- |
| `exercise_testamentary_power_of_appointment` | boolean |
| `spouse_exercise_testamentary_power_of_appointment` | boolean |

Per settlor, because one spouse may hold a power the other does not. The control is a
"Testamentary Power of Appointment" block in `WillProvisionsSection`; the spouse row
appears only when spouse documents are included.

## Generator mapping

| Design sheet | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| PR/guardian slots | `fiduciaries.*` | `fiduciaries.executor.*`, `guardians.*` |
| `pr_structure`, etc. | `will_provisions.*` | `will.*` |
| Pour-over fields | `will_provisions.pour_over_*` | `pour_over.alternate_disposition`, `alternate_named`, `alternate_disposition_text` |
| Outright fields | `will_provisions.outright_*` | `outright_will.residuary.*` |
| Testamentary fields | `will_provisions.beneficiary_*` | `testamentary_trust.*` |
| `specific_bequests` | `will_provisions.specific_bequests` | `specific_gifts[]`, `charitable_gifts[]` |
| `pet_care_*` | `will_provisions.pet_care_*` | `will.pet_care.*` |
| Excluded guardian | `client.excluded_guardian` | `guardians.excluded[]` (single entry) |
| PR powers | `will_provisions.pr_powers` | `will.pr_powers` (the whole record) |
| `estate_plan_design.will_title` | `documents.will_title` | `will.title` |
| `executor_same_as_trustee` (column) | `will_provisions.executors_same_as_trustees` | `will.executors_same_as_trustees` (+ `spouse_` variant) |
| `will_provisions.exercise_testamentary_power_of_appointment` | same name | `will.exercise_testamentary_power_of_appointment` (+ `spouse_` variant) |

### Pour-over alternate disposition text

Computed in `pourOverAlternateDispositionText()`:

| `pour_over_alternate_disposition` | Prose |
| --- | --- |
| `descendants_only` | …to descendants, per stirpes |
| `named` + name | …to [NAMED BENEFICIARY] |
| default / `spouse_then_descendants` | spouse then descendants |

## Template placeholders

```text
{{ will.pr_structure }}
{{ will.bond }}
{{ will.supervision }}
{{ will.simultaneous_death }}
{{ will.utma_age }}
{{ pour_over.alternate_disposition_text }}
{{ outright_will.residuary.disposition }}
{{ testamentary_trust.beneficiary_structure }}
{{ will.pet_care.option }}
{{ will.pet_care.cash_amount }}
{{ will.title }}
{% if will.pr_powers.allow_manage_digital_assets %}...{% endif %}
{% if has_specific_gifts %}{{ include_clause("will.specific_gifts") }}{% endif %}
{% if has_pet_care %}{{ include_clause("will.pet_care") }}{% endif %}
{% if has_simultaneous_death %}{{ include_clause("will.simultaneous_death") }}{% endif %}
{% if has_excluded_guardians %}...{% endif %}
```

## Conditional logic (current)

| Flag / field | Trigger | Clause |
| --- | --- | --- |
| `requires_guardian_clause` | minor children | `will.guardian_nomination` |
| `has_excluded_guardians` | `guardians.excluded` non-empty | Guardian exclusion paragraph |
| `has_specific_gifts` | gifts array | `will.specific_gifts` |
| `has_charitable_gifts` | charitable subset | Charitable gift language |
| `has_pet_care` | option direct_bequest or pet_trust | `will.pet_care` |
| `has_simultaneous_death` | married + simultaneous_death set | `will.simultaneous_death` |
| `has_tangible_personal_property` | distribution method set | `will.tangible_personal_property` |
| `will.no_contest_clause == "include"` | flag | `will.no_contest` |
| `will.include_disclaimer_article` | boolean | `will.disclaimer` |
| `state_requires_self_proving_affidavit` | MA rules | Self-proving affidavit |
| `will.pr_structure` | co_pr / spouse_first | `will.executor_appointment` |
| `outright_will.residuary.disposition` | named / spouse_then_descendants | `will.residuary_outright` |
| `testamentary_trust.beneficiary_structure` | structure enum | `testamentary_will.residuary_testamentary_trust` |

## Packages

| Plan type | Will package |
| --- | --- |
| Pour-over | `pourover-will` |
| Outright | `simple-will` |
| Testamentary trust | `testamentary-trust-will` |

Map: `tools/aubreylaw-docgeneration/docs/pourover-will-placeholder-map.md`

## Known gaps

| Item | Status |
| --- | --- |
| **Multi excluded guardians** | Wired: `guardians.excluded[]` with `reason`; falls back to `client.excluded_guardian`. Loop `{% for excluded in guardians.excluded %}` and include the reason when present. |
| **`will_pr_powers`** | Wired to `will.pr_powers`; no template branches on it yet |
| **Executors same as trustees** | Wired. `executor_same_as_trustee` / `spouse_executor_same_as_trustee` are persisted columns — a recorded answer, not just a copy button — and now reach `will.executors_same_as_trustees` / `will.spouse_executors_same_as_trustees` |
| **Testamentary power of appointment** | Wired to `will.exercise_testamentary_power_of_appointment` / the spouse variant, from `decisions.will_provisions`. No template drafts the article yet. |
