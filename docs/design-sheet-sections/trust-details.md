# Trust Details

**Section ID:** `trust-details`  
**UI:** `app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx`  
**Visibility:** `document_inclusions.trust === true`  
**Source files:** `lib/draftPayload/trustProvisions.ts`, `lib/designSheetTrustDetails.ts`, `lib/estateGenerator/toGeneratorData.ts`

`decisions.trust_details` holds **57 keys** — the largest namespace on the sheet, and
the one the Trust section registers all 57 of for import and autofill. That is past
`MAX_FIELDS_PER_BATCH` (45), so `openFieldsBySection` splits the Trust section across
numbered autofill prompts rather than truncating it.

Section blocks: **Trust Name**, **Trust Structure**, **Restatement**, **Trust
Protector**, **Trustee Provisions**, **Tangible Personal Property**, **Pet Care
Provisions**, **Residuary Distribution**, **Administrative Provisions**,
**Definitions**, **Retirement Accounts, Gifts and Protections**, **Incapacity**.

## Design sheet fields

### Columns

| Field | Notes |
| --- | --- |
| `trust_name`, `spouse_trust_name` | Display names computed via `formatTrustDisplayName()` |
| `trust_date` | Trust date; defaults to today if blank |
| `restatement` | boolean |
| `trust_protector`, `trust_protector_name` | boolean + name |
| `distribution_age` | Residuary distribution age |
| `staggered_distributions`, `stagger_age_*`, `stagger_pct_*` | Staged ages |
| `residual_beneficiary`, `residual_beneficiary_individuals` | Contact IDs resolved to names |
| `remote_beneficiary`, `remote_beneficiary_charities` | Contingent remote beneficiaries |
| `tangible_property_distribution`, `tangible_property_named_individual` | TPP in trust |
| `specific_bequests` | Shared with will — see Will Details |
| `trustee_slots`, `spouse_trustee_slots` | See Fiduciaries guide |
| *(dropped)* `distribution_method` | Removed by migration `20260804210000_drop_design_sheets_distribution_method.sql` and moved into `decisions.trust_details`. It is listed in `DECISION_ONLY_TOP_LEVEL_KEYS` so a stale value on an old inflated row is stripped rather than folded back in. |
| `provision_substance_abuse`, `provision_married_beneficiary` | Legacy yes/no (merged into trust_details) |
| `beneficiary_as_cotrustee`, `beneficiary_as_sole_trustee` | Trustee structure |
| `pet_care_option`, `pet_care_details` | Shared with will |
| `include_common_disaster`, `include_guardians_allowance` | Trust articles |

### `decisions.trust_details` (jsonb)

Key provisions from `lib/designSheetTrustDetails.ts`:

| Field | Values / type |
| --- | --- |
| `initial_trustee_nomination` | `grantor`, `grantor_and_spouse`, `single_initial_trustee`, etc. |
| `spouse_initial_trustee_nomination` | Spouse-scoped variant |
| `co_trustee_decision` | `joint_majority`, `independent`, `omit`, `settlor_separate_others_joint` |
| `trustee_compensation` | `reasonable`, `prevailing_corporate`, etc. |
| `successor_trustee_vacancy` | Vacancy appointment method |
| `residual_beneficiary_method` | `outright`, `staggered`, `trust_for_life`, `custom` |
| `residuary_after_death` | Per-stirpes / trust splits |
| `representation_type` | `by_representation`, `per_stirpes`, `per_capita_each_generation` |
| `survivorship_requirement_days` | number |
| `include_substance_abuse`, `include_creditor_divorce_provisions` | booleans |
| `include_no_contest_clause`, `name_people_in_no_contest_clause` | booleans |
| `include_common_trust_for_children` | boolean |
| Business/529 powers, definition toggles | booleans |

**Marital and bypass trusts (first spouse's death)**

One set of fields serves both plan shapes — a joint trust dividing the deceased
settlor's share, and a separate trust distributing in trust for the spouse — so a
matter that switches `is_joint` keeps its answers. `MaritalBypassTrustOptions.tsx`
picks the wording and the option subset from a `variant` prop; storage is the same
either way.

| Field | Values / type |
| --- | --- |
| `marital_trust` | `none`, `general_power_of_appointment`, `qtip` — nullable |
| `marital_trust_invasion` | `no_invasion`, `hems`, `five_by_five`, `complete` — nullable |
| `marital_trust_remainder_power` | `none`, `limited_testamentary` — QTIP only, nullable |
| `marital_trust_include_qdot` | boolean (non-citizen spouse) |
| `bypass_trust` | `none`, `bypass` (credit-shelter / "A/B"), `disclaimer` — nullable |
| `bypass_trust_formula` | `all_assets`, `formula`, `fixed_amount`, `percentage`, `clayton_election` — `bypass` only, nullable |
| `bypass_trust_fixed_amount`, `bypass_trust_percentage` | number, nullable |
| `bypass_trust_remainder_power` | `none`, `limited_testamentary` — `bypass` only, nullable |
| `bypass_trust_allow_sprinkling` | boolean (sprinkle to issue during the survivor's lifetime) |

`all_assets` is offered on the separate variant only, and is disabled there once a
marital trust is created — there is then no "all" left to fund the bypass with.
A `disclaimer` bypass trust has no formula, remainder power or fixed share: what
the survivor disclaims decides its funding.

**Trustee administration**

| Field | Type |
| --- | --- |
| `require_trustee_bond`, `limit_duty_to_account` | boolean |
| `include_reverse_mortgage_clause`, `include_firearms_provisions` | boolean |
| `allow_sole_trustee_to_appoint_cotrustees` | boolean |
| `allow_trustee_to_designate_alternates` | boolean |

**Retirement accounts, gifts and protections**

| Field | Type |
| --- | --- |
| `include_retirement_account_provisions` | boolean (conduit provisions) |
| `allow_protector_convert_conduit_trusts` | boolean |
| `allow_direct_distributions_to_young_or_incapacitated` | boolean |
| `include_slayer_provision` | boolean |
| `allow_charitable_giving_during_incapacity` | boolean |
| `forgive_all_debts` | boolean |
| `include_marital_deduction_savings_language` | boolean — the checkbox is replaced by a fixed notice whenever the structure requires it (any created marital trust, or a separate-trust `disclaimer` / `clayton_election`) |

**Incapacity**

| Field | Type |
| --- | --- |
| `include_incapacity_definition` | boolean |
| `allow_psychologist_substitute`, `allow_pa_np_substitute` | boolean |
| `settlor_incapacity_determined_by` | 16 options, nullable |
| `trustee_incapacity_determined_by` | 12 options, nullable |

**Schedule A** — `asset_schedule_format` (`table` \| `paragraph`),
`asset_schedule_signature_block`, `asset_schedule_catchall`, `asset_schedule_non_trust`.
Their UI lives in the Asset Schedules section; see that guide.

The two `*_incapacity_determined_by` fields are nullable and read through
`readAllowedValue` (`lib/designSheet/decisionReaders.ts`) — an unset value and a value
outside the option list both read as `null`, which is how "not decided yet" stays
distinct from any particular answer.

### `trust_name_format` (nested inside `decisions.trust_details`)

Not a top-level namespace — `decisions.trust_details.trust_name_format`, keyed per
party (`client` / `spouse`):

- `date_style`: `ua_dated` (default) \| `dated_only`
- `append_amendments`: boolean

## Generator mapping

`draftPayloadTrustProvisions()` → `payload.trust_provisions` + `payload.trust` → `EstateGeneratorData.trust`:

| Design sheet | Generator path |
| --- | --- |
| `trust_name` + date + format | `trust.name`, `trust.display_name`, `trust.date` |
| `spouse_trust_name` + format | `trust.spouse_name`, `trust.spouse_display_name` |
| `restatement` | `trust.restatement` |
| `trust_planning_type` | `trust.spousal_funding` — `outright_to_spouse`, `in_trust_for_spouse`, `disclaimer`, `clayton_election`, or `not_to_spouse` (the residuary skips the surviving spouse). Only `disclaimer` changes package selection. |
| `marital_trust*`, `bypass_trust*` | `trust.marital_trust.*`, `trust.bypass_trust.*` — each group is omitted entirely when nothing in it is answered |
| `trust_details.*` | `trust.initial_trustee_nomination`, `trust.provisions.*`, etc. |
| `co_trustee_decision` | `fiduciaries.trustee.co_trustees_action` |
| Distribution fields | `trust.descendants_distribution.method`, `stage_*_age` |
| Remote beneficiary | `trust.remote_beneficiaries.method`, `individuals`, `charity.name` |
| Disinherited | `trust.disinherited[]` (from family section) |
| Blended family | `trust.blended_family` |
| MA tax (matter_details) | `tax.sensitive_estate` |

Trust display name examples:

```text
SMITH FAMILY REVOCABLE LIVING TRUST, U/A dated January 15, 2026
SMITH FAMILY REVOCABLE LIVING TRUST dated January 15, 2026, and any amendments thereto
```

## Template placeholders

```text
{{ trust.name | name }}
{{ trust.display_name }}
{{ trust.spouse_display_name }}
{{ trust.date }}
{{ trust.restatement }}
{{ trust.spousal_funding }}
{{ trust.provisions.include_substance_abuse }}
{{ trust.descendants_distribution.method }}
{{ trust.descendants_distribution.stage_1_age }}
{{ fiduciaries.trustee.primary.full_name | name }}
{{ include_clause("trust.trustee_appointment") }}
{{ include_clause("trust.spendthrift") }}
```

## Conditional logic (current)

| Flag / condition | Trigger | Clause |
| --- | --- | --- |
| `uses_revocable_trust` | pour-over / trust in plan | `trust.spendthrift`, `trust.trustee_appointment` |
| `has_disinherited` | disinherited list | Disinheritance articles |
| `has_blended_family` | parentage split | Joint trust blended-family articles |
| `trust.restatement` | boolean | Restatement opening language |
| `trust.spousal_funding == "disclaimer"` | planning type | `indv-disclaimer-trust` package structure |
| `trust.marital_trust` | a marital trust is created | Marital/QTIP articles, QDOT language, invasion powers |
| `trust.bypass_trust` | a bypass or disclaimer trust is created | Bypass/credit-shelter or disclaimer articles, sprinkling |
| `descendants_distribution.method` | outright / staged / trust_for_life | Distribution article branches |
| `include_no_contest_clause` | trust or will flag | No-contest clause (will flag can override) |

Inline clause examples in `trust.trustee_appointment.json` branch on `fiduciaries.trustee.co_trustees_action`.

## Packages

| Matter type | Package |
| --- | --- |
| Married joint | `joint-trust`, `joint-trust-simplified` |
| Married individual + disclaimer | `indv-disclaimer-trust` |
| Individual | `trust-individual-single` |
| Ancillary (when enabled in Estate Plan Design) | `certificate-of-trust`, `assignment-of-personal-property` |

Placeholder maps: `tools/aubreylaw-docgeneration/docs/joint-trust-placeholder-map.md`, `trust-individual-single-placeholder-map.md`, `indv-disclaimer-trust-placeholder-map.md`, `certificate-of-trust-placeholder-map.md`, `assignment-of-personal-property-placeholder-map.md`.

## Exporting to Statular

`GET /api/admin/matters/[id]/design-sheet/export?format=statular` renders the
answers as Markdown in Statular's own question wording
(`lib/designSheet/statularExport.ts`), for Statular's file import.

Statular extracts from uploaded files rather than parsing a schema, so the export
optimises for legibility to an extraction model: Markdown (on its accepted list),
Statular's exact question and option labels where we know them, and **answers
only** — an unanswered field is omitted, never printed blank or defaulted.

Two rules that are easy to break:

- Read the **raw** decision blob, not `getTrustDetails`. The getter substitutes
  `false` for an unset boolean, and "Include QDOT Language: No" for a question
  nobody answered is a decision the file invents.
- The marital/bypass block renders only when the plan actually divides at the
  first death (joint, or a separate trust holding the residuary in trust). A
  leftover answer from an earlier structure must not reach Statular.

Question wording comes from `lib/designSheet/statularInterviewMap.ts`, the
machine-readable half of `docs/integrations/statular-interview-map.md`. 242 of the
295 registry fields are mapped to a verbatim Statular question across 15 of its
25 pages; the rest still export under **Additional answers** with our own labels.

Statular asks every settlor-specific page twice, once per settlor, and the answers
are independent. The healthcare namespace already mirrors that with `client_*` /
`spouse_*` pairs, so those pages carry a group per settlor — mapping only the
client half would drop the second settlor's answers into the fallback.

**The map is meant to be supplemented.** Adding an entry is one object — the
question text, the design-sheet field, and Statular's wording per stored value —
and it upgrades a line from our wording to theirs rather than rescuing it from
omission, because the fallback already carries everything. `tests/statular-export.test.ts`
fails if an entry names a field the design sheet does not have, asks the same
field twice, or maps an option set without wording for every stored value.

## Adding a field here

`setTrustDetails` spreads `...raw` first, so an unrecognised stored key survives a
write and the setter needs no edit. That makes this the easy namespace: interface,
`DEFAULT_TRUST_DETAILS`, one reader line in the getter, a control, one registry line
in `lib/designSheetImport/decisionFields.ts`, one line in `toGeneratorData.ts`, and a
`data-dictionary.json` entry.

`DraftPayloadTrustProvisions extends TrustDetailsProvisions`, so the payload layer
picks new keys up for free — unlike `dpoa_provisions`, which needs four hand edits.

**Three fields still dual-write a legacy column.** `include_substance_abuse`,
`include_creditor_divorce_provisions` and `include_no_contest_clause` write both a
namespace key and a column, and are OR-merged in `lib/draftPayload/trustProvisions.ts`.
That is the drift pattern `distribution_method` was deleted for — new fields are
namespace-only.

## Known gaps

| Gap | Notes |
| --- | --- |
| Many `trust_details` booleans | In `trust.provisions.*` but few clause `condition` hooks — templates may ignore new toggles |
| `remote_beneficiary_individuals` | Contact IDs resolved in `assemble.ts` — templates should use `trust.remote_beneficiaries.individuals[]` |
| `residuary_after_death` enum | Mapped to payload; verify joint-trust clauses cover all four values |
| `trust.marital_trust.*`, `trust.bypass_trust.*` | Captured and carried into the generator context, but no template branches on them yet — the marital, bypass and disclaimer articles still need authoring |
| `special_trustee_instructions` | Free text in provisions — needs template placeholder |
| `TrustDetailsSpouseSection` | Exported from `TrustDetailsSection.tsx` but **not wired into `designSectionCatalog.tsx`** — `tests/design-sheet-contacts-section.test.ts` asserts the catalog does not reference it. Spouse trust name and format come from the same section, scoped `spouse`. |
| UI density | `TrustDetailsSection.tsx` is past 1,000 lines. Prefer a new `SectionBlock` over appending, and consider splitting the file. |
