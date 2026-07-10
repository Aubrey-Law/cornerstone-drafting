# Estate Plan Design

**Section ID:** `estate-plan-design`  
**UI:** `app/admin/drafting/[matterId]/design/sections/PlanDesignSection.tsx`  
**Source files:** `lib/designSheetDocumentInclusions.ts`, `lib/draftPayload/helpers.ts` (`deriveDocuments`), `lib/estateGenerator/toGeneratorData.ts` (`deriveEstateGeneratorPackages`)

## Design sheet fields

| Field | Storage | Notes |
| --- | --- | --- |
| `plan_type` | column | `pour_over` \| `outright_will` \| `testamentary_trust` |
| `is_joint` | column | Joint vs separate trusts (married) |
| `decisions.document_inclusions` | jsonb | Per-document toggles |
| `decisions.estate_plan_design` | jsonb | Core setup, will title, signing type, ancillary docs |
| `decisions.trust_planning_type` | jsonb | `outright_to_spouse` \| `disclaimer` \| `clayton_election` |
| `signing_date`, `signing_month`, `signing_year` | column | Execution block |
| `signing_county` | column | Execution + client county fallback |
| `notary_commission_expiration` | column | Notary block |
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

## Template conditionals

| Flag | Trigger |
| --- | --- |
| `uses_revocable_trust` | Trust exists in payload (`planning.uses_revocable_trust`) |
| `signing_scheduled` | signing date, county, or notary present |
| `state_requires_self_proving_affidavit` | MA state rules |
| `planning.spouse_docs` | Spouse companion document generation (separate package render) |

## Section visibility (UI)

Nav items for Trust, Will, DPOA, Healthcare, Assets, Transfers are gated by `document_inclusions` (`lib/designSheet/designSectionNav.ts`).

## Recent updates & template gaps

| Gap | Action needed |
| --- | --- |
| **Ancillary documents** | `certificate_of_trust`, `assignment_of_personal_property`, `funding_instructions`, `homestead_trustee`, and `trust-funding-plan` (funding recommendation) have Cornerstone templates; trust summary, etc. still need templates |
| `include_temp_delegation` | `temporary-delegation-parental-powers` package; uses `guardians.temporary*` slots |
| **Asset transfer doc selection** | `deed` inclusion toggle vs `real_estate_transfer.selectedDocs` — both must align; draft route uses payload flags |
| Practice area null | Normalizes to EP so packages still generate |
| **Clayton election** / `trust_planning_type` | Stored as `trust.spousal_funding` — verify joint-trust templates branch on `disclaimer` vs `outright_to_spouse` |
