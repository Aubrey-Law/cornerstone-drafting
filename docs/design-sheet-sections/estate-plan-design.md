# Estate Plan Design

**Section ID:** `estate-plan-design`  
**UI:** `app/admin/drafting/[matterId]/design/sections/PlanDesignSection.tsx`  
**Source files:** `lib/designSheetDocumentInclusions.ts`, `lib/draftPayload/helpers.ts` (`deriveDocuments`), `lib/estateGenerator/toGeneratorData.ts` (`deriveEstateGeneratorPackages`)

## Design sheet fields

| Field | Storage | Notes |
| --- | --- | --- |
| `plan_type` | column | `pour_over` \| `outright_will` \| `testamentary_trust` |
| `is_joint` | column | Joint vs separate trusts (married). Also picks which wording the shared marital/bypass trust options use in Trust Details. |
| `decisions.document_inclusions` | jsonb | Per-document toggles |
| `decisions.estate_plan_design` | jsonb | Core setup, will title, signing type, ancillary docs |
| `decisions.trust_planning_type` | jsonb | `outright_to_spouse` \| `in_trust_for_spouse` \| `disclaimer` \| `clayton_election` \| `not_to_spouse`. The three in-trust values reveal the marital/bypass group in `decisions.trust_details` — see the Trust Details guide. |
| `signing_date`, `signing_month`, `signing_year` | column | Execution block |
| `signing_county` | column | Execution + client county fallback |
| `notary_commission_expiration` | column | Notary block |
| `decisions.execution_mechanics` | jsonb | Acknowledgment method, witnesses, meeting details — see below |
| `decisions.real_estate_transfer.selectedDocs` | jsonb | Enables transfer docs |

### Document inclusions (`decisions.document_inclusions`)

| Key | Default | Effect |
| --- | --- | --- |
| `trust` | plan-type dependent | Trust package + asset schedules section |
| `will` | true | Will package |
| `dpoa` | true | Incapacity package |
| `healthcare` | true | HCP, HIPAA, AHD in incapacity package |
| `deed` | false | Transfers section visibility |
| `young_adult_estate_plan` | young adult child present | YA package |
| `spouse_docs` | married | Spouse companion packages |

### Ancillary documents (`decisions.estate_plan_design.ancillary_documents`)

**Backed by a template:** `certificate_of_trust`, `assignment_of_personal_property`,
`funding_instructions`, `funding_recommendation`, `homestead_trustee`, `trust_summary`,
`estate_plan_summary`, `estate_plan_signing_guide`, `successor_trustee_checklist`,
`fiduciary_role_guide`, `flowchart`, `include_asset_spreadsheet`.

**Record-only** — captured and printed on the interview worksheet, but *no template
drafts them yet*: `dementia_directive`, `visitation_authorization`, `final_disposition`,
`comprehensive_transfer_document`, `client_self_declaration_of_capacity`. They sit
under a "Captured, Not Drafted" heading in the UI that says so, precisely so a ticked
box is not read as a promised deliverable.

### Document titles (`decisions.estate_plan_design`)

| Field | Values | Default |
| --- | --- | --- |
| `will_title` | `last_will` \| `pour_over_will` | derived from whether a trust is included |
| `healthcare_directive_title` | `state_default`, `advance_directive`, `advance_health_care_directive`, `health_care_directive`, `health_care_power_of_attorney`, `other` | `state_default` |
| `poa_form` | `short` \| `long` \| `both` | `long` |
| `poa_title` | `power_of_attorney` \| `durable_power_of_attorney` | `durable_power_of_attorney` |
| `comprehensive_transfer_title` | `declaration_of_trust`, `comprehensive_transfer_of_assets`, `general_assignment` | **null** |
| `signing_type` | `undecided`, `attorney_supervised`, `independent_client` | `undecided` |

The three title fields default to what the firm actually drafts in Massachusetts
rather than to `null`, because an unanswered question here has a right answer. On the
interview worksheet those boxes are **gated on the document being included**, so a
plan with no power of attorney does not print a ticked "Long-Form Power of Attorney".
`comprehensive_transfer_title` has no default — the document is off by default and
record-only, so a title before the document is chosen would be a fiction.

### `decisions.execution_mechanics` (jsonb)

Fourteen answers about how the plan is signed. Surfaced in `SigningMechanicsSection`
on the **Review** step — deliberately not a catalog section — beside the three signing
fields that are real columns.

| Group | Fields |
| --- | --- |
| Acknowledgment method | `trust_acknowledgment` (`notary` \| `witnesses` \| `both`), `poa_acknowledgment`, `ahd_acknowledgment`, `healthcare_authorization_acknowledgment` (each `notary` \| `witnesses`), `final_disposition_execution` (`witnesses` \| `witnesses_and_notary`) |
| Signing arrangements | `combine_settlor_trustee_signatures`, `healthcare_signed_in_nursing_home` |
| Meeting details | `signing_city`, `notary_name` |
| Witnesses | `include_witness_phones`, `witness_1_address`, `witness_1_phone`, `witness_2_address`, `witness_2_phone` |

All five choice fields default to `null` and read through `readAllowedValue`, so
"notary" and "not asked yet" stay distinct — the worksheet prints an unanswered one as
two empty boxes rather than ticking a default. The booleans are genuine opt-ins, so
`false` printing as a ticked "No" is correct there.

`signing_city` and `notary_name` would sit naturally next to `signing_date`,
`signing_county` and `notary_commission_expiration`, which *are* columns. They are not,
because a column means a migration, a `types/supabase.ts` regeneration and the
PostgREST failure mode `WRITABLE_DESIGN_SHEET_COLUMNS` guards against, for no gain.
The split is storage-only; the UI shows all six together.

`setExecutionMechanics` spreads `...raw` first, so an unrecognised stored key survives
a write.

## Generator mapping — document flags

`deriveDocuments()` → `payload.documents` → `planning.*` and package list:

| documents flag | Package(s) |
| --- | --- |
| `include_trust` + `married_joint` | `joint-trust` or `joint-trust-simplified` |
| `include_trust` + individual/disclaimer | `trust-individual-single` or `indv-disclaimer-trust` |
| `include_pour_over_will` | `pourover-will` (+ `spouse-pourover-will`) |
| `include_simple_will` | `simple-will` |
| `include_testamentary_trust_will` | `testamentary-trust-will` (+ spouse variant) |
| `include_dpoa` / `hcp` / `hipaa` / `ahd` | `incapacity-documents` (+ spouse) |
| `include_ppm` | `personal-property-memorandum` |
| `include_parental_appointment` | `parental-guardian-appointment` |
| `include_young_adult_estate_plan` | `young-adult-estate-plan` |
| `include_certificate_of_trust` | `certificate-of-trust` |
| `include_assignment_of_personal_property` | `assignment-of-personal-property` |
| `include_funding_instructions` | `funding-instructions` |
| `include_funding_recommendation` | `trust-funding-plan` (hybrid — see `trust-funding-plan-placeholder-map.md`) |
| `include_homestead_trustee` | `homestead-trustee` |
| Any package (when `estate_plan_summary` ancillary toggle on) | Appends `estate-plan-summary` |

### Key derivation rules

```typescript
// Trust only with pour-over plan type
include_trust = isEP && (planType === 'pour_over') && setup.trust

include_pour_over_will = isEP && setup.will && planType === 'pour_over'
include_simple_will      = isEP && setup.will && planType === 'outright_will'
include_testamentary_trust_will = isEP && setup.will && planType === 'testamentary_trust'

// Disclaimer trust package
trust_planning_type === 'disclaimer' && matter.type === 'married_individual'
  → indv-disclaimer-trust

// Separate trusts (matter_details.ep_separate_trusts)
married_joint + separate_trusts → joint-trust-simplified
```

| Sheet | Generator |
| --- | --- |
| `plan_type` pour_over | `planning.uses_revocable_trust`, `uses_revocable_trust` flag |
| `trust_planning_type` | `trust.spousal_funding` |
| Signing fields | `execution.*`, `signing_scheduled` |
| `is_joint` | `matter.type` = `married_joint` vs `married_individual` |
| Record-only inclusions | `planning.include_dementia_directive`, `include_visitation_authorization`, `include_final_disposition`, `include_comprehensive_transfer_document`, `include_client_self_declaration_of_capacity` |
| Document titles | `planning.healthcare_directive_title`, `poa_form`, `poa_title`, `comprehensive_transfer_title`; `will.title` |
| `execution_mechanics.*` | `execution.*` — same key names, alongside `execution.signing_county`, `doc_date`, `notary_commission`, `signing_type` |

### Which package swaps in the interview worksheet

The design-sheet export picks its package from `payload.trust.separate_trusts`:
`design-summary-separate` (which adds the reciprocal-trust interview worksheet) for
separate trusts, `design-summary` otherwise. See
`app/api/admin/matters/[id]/design-sheet/export/route.ts`.

## Template conditionals

| Flag | Trigger |
| --- | --- |
| `uses_revocable_trust` | Trust exists in payload (`planning.uses_revocable_trust`) |
| `signing_scheduled` | signing date, county, or notary present |
| `state_requires_self_proving_affidavit` | MA state rules |
| `planning.spouse_docs` | Spouse companion document generation (separate package render) |

## Section visibility (UI)

Nav items for Trust, Will, DPOA, Healthcare, Assets, Transfers are gated by `document_inclusions` (`lib/designSheet/designSectionNav.ts`).

## Known gaps

| Item | Status |
| --- | --- |
| **Record-only documents** | Five inclusions and the comprehensive-transfer title are captured with no template behind them. An attorney who ticks one should not expect a draft — the UI says so. |
| **Ancillary documents** | `certificate_of_trust`, `assignment_of_personal_property`, `funding_instructions`, `homestead_trustee`, and `trust-funding-plan` (funding recommendation) have Cornerstone templates; trust summary, etc. still need templates |
| `include_temp_delegation` | `temporary-delegation-parental-powers` package; uses `guardians.temporary*` slots |
| **Asset transfer doc selection** | `deed` inclusion toggle vs `real_estate_transfer.selectedDocs` — both must align; draft route uses payload flags |
| Practice area null | Normalizes to EP so packages still generate |
| **Clayton election** / `trust_planning_type` | Stored as `trust.spousal_funding` — verify joint-trust templates branch on `disclaimer` vs `outright_to_spouse` |
| **Marital / bypass trust structure** | Captured in `decisions.trust_details` and carried to `trust.marital_trust.*` / `trust.bypass_trust.*`; no package or template branches on it yet |
