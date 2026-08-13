# Field Consistency Review

A full-repo audit of field definitions and how they interact across surfaces:
the shared registry (`packages/estate-fields`), client/admin intake, the design
sheet, document generation, and the leads/matters CRM. Findings are grouped by
theme; each carries a severity and the file evidence. Line numbers reference the
commit this review was run against.

Severity legend — **Critical**: wrong or lost data in client-facing output or
destructive saves. **High**: a feature that silently cannot work. **Medium**:
inconsistency with a plausible bad outcome. **Low**: drift/dead code worth
cleaning while nearby.

> **Status update.** The following are fixed on this branch: §1.1 (plan
> structure now seeds via `buildIntakeSeedPayload`/`buildIntakeSeedDecisions`),
> §1.2, §2.1–§2.6 (current_step item and submit-gate item still open),
> §4.1 (marital vocabulary unified; spouse-gating on `'married'` unchanged),
> §4.2 (referral normalization + `referral_source` writers), §5.1, §5.3, §5.4,
> parts of §5.5 (client/spouse names + spouse contact in the generator
> context), §7.1–§7.5. Still open: §5.2 (the trust tangible-property article
> needs new fallback disposition language — an attorney drafting decision),
> the remaining §5.5 template-variable gaps, §5.6–§5.10, §3 registry
> internals, §4.3–§4.8, and the §8 dead-surface cleanup.

---

## 1. Broken intake → design-sheet wiring

### 1.1 Critical — Attorney plan-structure choice never reaches the design sheet
- `app/api/intake/route.ts:488` persists `client_intake.plan_type` and
  `document_inclusions` with a comment saying they are "seeded into the design
  sheet on submit (see buildDesignSheetSeedPayload)". **`buildDesignSheetSeedPayload`
  does not exist anywhere in the repo** (also referenced at
  `lib/intakePlanType.ts:114`).
- The real seed path (`lib/designSheet/seedFromIntake.ts:129-175`,
  `INTAKE_SEED_FIELD_META`) never maps `plan_type`, `is_joint`,
  `trust_planning_type`, or `document_inclusions`.
- Compounding it, the picker UI itself is unreachable: `PlanStructurePicker` and
  the document toggles in `components/intake/GuidedInterview.tsx:565-571, 386`
  route through `persistAttorneyPatch`, which returns early when `onAttorneySave`
  is absent (`:163`) — and no caller ever passes `onAttorneySave`.
- Consequence: `defaultDocumentInclusions`
  (`lib/designSheetDocumentInclusions.ts:92`) defaults `trust: true` for every
  matter — including will-based and incapacity-only plans — and
  `computeDesignSheetDefaults` derives and persists a trust name from `is_joint`
  before it is ever set (`lib/designSheetDefaults.ts:37-46, 75-78`, written at
  `app/admin/drafting/[matterId]/loadDraftingMatterContext.ts:84-96`).
  `intakePlanTypeMapping` (`lib/intakePlanType.ts:110-156`) and all of
  `lib/intakeLegalFlags.ts` are dead code.

### 1.2 High — Readiness reads a decisions namespace nothing writes
- `lib/designSheetReadiness.ts:224, 251` reads `decisions.estate_plan_setup`;
  the getter/setter and the only UI writer use `decisions.estate_plan_design`
  (`lib/designSheetDocumentInclusions.ts:214, 241-249`;
  `app/admin/drafting/[matterId]/design/sections/SigningMechanicsSection.tsx:72-78`).
- The "signing type" blocker therefore fires for every matter forever, and its
  Fix link targets `design-field-estate_plan_setup.signing_type`, an element id
  that does not exist.

### 1.3 High — Child `gender` and `deceased` are dropped on both read and write
- Read: `lib/contacts/loadHouseholdChildren.ts:10` selects neither column, while
  `lib/contacts/childMapping.ts:78-79` maps them into every `DesignSheetChild`.
- Write: `childInputToContactPayload` (`lib/contacts/childMapping.ts:56-68`)
  never emits them despite `HouseholdChildInput` declaring both.
- The columns exist (`supabase/migrations/20260716000000_lite_full_intake_columns.sql:152-154`).
  Every seeded/resynced child comes back `gender: null, deceased: false` — the
  exact inputs `include_child_gender_markers`
  (`lib/designSheet/buildInitialSheet.ts:98`) is supposed to key off.

### 1.4 Medium — `is_joint` tri-state is handled inconsistently
- Readiness prompts only when `is_joint == null`
  (`lib/designSheetReadiness.ts:240-241`) but consumes it as strictly-false at
  `:275-280`; `lib/designSheetDefaults.ts:79` seeds `spouse_trust_name` on
  `!sheet.is_joint` (true for null); `buildInitialSheet.ts:92` initializes it to
  `false`, while the later column default never applied (the column already
  existed: `supabase/migrations/20260705000000_drafting_baseline_core.sql:237` vs
  `20260715000000_lite_design_sheets_intake_columns.sql:71`). "Undecided" and
  "joint decision made: no" are indistinguishable depending on which entry point
  created the sheet.

### 1.5 Medium — Seed-path storage asymmetries
- `seedFromIntake.ts:149` seeds `spouse_aka`, which is missing from
  `WRITABLE_DESIGN_SHEET_COLUMNS` (`lib/designSheetPersistence.ts:214` lists
  `client_aka` only) — it lands in `decisions` JSON while its client twin gets a
  real column.
- `seedFromIntake.ts:155` writes `excluded_guardian_flag: … ? true : null` where
  `buildInitialSheet.ts:153` uses `false`; `isEmptyValue` treats booleans as
  non-empty, so the null/false split changes intake-resync preview behavior.

---

## 2. Admin intake saves destroy client-entered data

### 2.1 Critical — Every admin intake save deletes the spouse's fiduciaries
- The wipe in `lib/contacts/persistFiduciaryRoles.ts:43-50` filters on intake,
  role, priority, and `is_coagent` but **not `for_party`** — even though its own
  doc comment (`:30`) says the scope is "for_party IN (client, spouse)".
- The admin sheet only re-inserts client-party rows: `ADMIN_FIDUCIARY_FIELD_MAP`
  hardcodes `for_party: 'client'` for all mapped fields
  (`lib/adminIntakeFiduciaries.ts:12, 56, 75`), and `getAdminIntakeData` only
  reads `for_party='client'` (`app/actions/adminIntake.ts:261`), so the sheet
  cannot even display what it is about to destroy.
- Effect: portal-entered `fid_personal_rep_spouse` / `fid_poa_spouse` /
  `fid_hcp_spouse` roles are deleted on any admin save and the
  `spouse_*_missing` readiness flags flip back on
  (`lib/intakeReadiness.ts:66-86`).

### 2.2 Critical — Admin save clobbers `financial_details`
- Portal packs `financial_*` keys plus `asset_types`,
  `owns_real_estate_outside_ma`, etc. into `financial_details`
  (`hooks/useAutoSave.ts:45-46, 115-123`; `lib/intakeFinancialFields.ts:2-10`).
- Admin `buildPayload` replaces the whole JSONB with exactly five flat keys, no
  merge (`app/actions/adminIntake.ts:197-203`).
- Readers that then go blank: `lib/intakeReadiness.ts:219-237` and the
  submission rule requiring ≥1 `asset_types` (`lib/intakeSections.ts:276-279,
  379-384`). Separately, readiness expects `financial_details.real_estate` to be
  an array (`lib/intakeReadiness.ts:314-321`) while the admin path writes a flat
  `real_property_address` string — admin-entered real estate can never satisfy
  that flag.

### 2.3 Critical — Admin save clobbers `family_details`, erasing referral data
- Portal stores `family_details.referral = { source, legal_insurance_plan, … }`
  (`lib/intakeReferralDetails.ts:15-34` via `hooks/useAutoSave.ts:131-134`).
- Admin writes `family_details: data.family_notes ? { notes } : null`
  (`app/actions/adminIntake.ts:195`) — wholesale replacement, `null` when the
  notes box is empty. The admin UI only reads back `.notes`
  (`components/AdminIntakeSheet.tsx:1157`), so the loss is invisible.

### 2.4 Critical — `planning_objectives` has two incompatible shapes on one text column
- Portal writes an object (`components/intake/IntakeWizard.tsx:936-938`); admin
  writes a plain string (`app/actions/adminIntake.ts:193`). The column is `text`
  (`supabase/migrations/20260716000000_lite_full_intake_columns.sql:22`).
- `lib/intake/unpackInitialData.ts` never parses the stored JSON string back, so
  after reload the wizard spreads a *string* (`{ ...'{"why_now":…}' }`),
  producing a character-indexed object on the next keystroke. The seed path
  already defends against this known corruption
  (`lib/designSheet/seedFromIntake.ts:104-110`); `lib/intakeSections.ts:392`
  permanently re-raises the `why_now` warning and
  `design/sections/IntakeSection.tsx:150` renders raw JSON.

### 2.5 Medium — Admin submit bypasses every portal submission rule
- Portal submit runs `getSubmissionErrors` (name, email, phone, address, DOB,
  county, marital status, children, estate value, asset types, goals —
  `lib/intakeSections.ts:209-289`; enforced at `app/api/intake/route.ts:252-258,
  572-578`). `submitAdminIntake` (`app/actions/adminIntake.ts:470-480`) never
  calls it; the only admin check is five fields in
  `components/AdminIntakeSheet.tsx:319-334`.

### 2.6 Medium — Admin sheet fields that never round-trip
- `components/AdminIntakeSheet.tsx:1182-1187` hydrates `has_will`, `has_trust`,
  `has_poa`, `has_hcp`, `special_circumstances` as constants, and `buildPayload`
  never persists them (they reach only an ephemeral notes blob,
  `app/actions/adminIntake.ts:447-464`). `has_existing_plan` and
  `planning_goals` are read from real columns the admin path never writes —
  toggling them in the admin sheet is silently discarded.
- `app/actions/adminIntake.ts:160` writes `current_step: 9` (integer) into a
  column that stores step-id strings; the portal normalizes numbers→ids for
  exactly this reason (`app/api/intake/route.ts:59-89`).

---

## 3. Shared field registry (`packages/estate-fields`) defects

### 3.1 High — `intakeKey → fieldId` map has 8 silent collisions (last wins)
- `packages/estate-fields/src/portal/intakeValidate.ts:5-9` builds a Map from
  registry entries; duplicated `intakeKey`s mean the client-side definitions are
  shadowed by spouse/design ones: `preferred_pronoun`, `date_of_birth`, `phone`,
  `email`, `is_us_citizen` all resolve to the **spouse** field; `state` →
  `client_domicile`; `special_notes` → `concerns`; `planning_goals` →
  `goals_notes`.
- Behavioral today: `validateIntakeField('planning_goals', ['avoid_probate'])`
  validates against a *textarea* def whose `trimString` normalizer nulls arrays —
  it always passes; the multiselect def is never consulted. Same for
  `special_notes`.

### 3.2 High — Spouse trustee slot declared but undefined; nominations dropped
- `fiduciaries.ts:13` declares `fid_trustee_spouse` in the union and casts the
  slot map as total (`:118-123`), but `FIDUCIARY_INTAKE_SLOTS` has no such entry
  (`:31-112`) — so `lib/contacts/fiduciaryEntriesToRoles.ts:69-71` can never
  read it, while the design side (`spouse_trustee_slots`, `fiduciaries.ts:141`)
  and hydration (`lib/intakeContactHydration.ts:25`) both expect it.
  `seedFromIntake.ts:172-174` seeds spouse executor/poa/hcp slots but not
  spouse trustee. Combined with §2.1, spouse trustees are both invisible to
  intake and deleted by admin saves.

### 3.3 High — Override-badge key set drifted from the registry
- `SHARED_PREFILLED_DESIGN_KEYS` (`registry.ts:320-324`, computed from
  `prefilled: true`) vs the hand-maintained `INTAKE_PREFILLED_FIELDS`
  (`lib/designSheet/buildInitialSheet.ts:5-26`) — the runtime set omits
  `client_pronouns`, `spouse_pronouns`, `concerns`, `goals_notes` and adds three
  non-registry keys. Verified consequence: `useDesignSheetState.ts:291` never
  records overrides for those four fields even though `PersonalSection.tsx:122`
  passes `originalValue` for them and `seedFromIntake.ts` genuinely seeds all
  four. The package's own `SYNC.md:28,33` documents wiring that does not exist.

### 3.4 Medium — Renderers don't implement the declared control types
- `SharedFieldControl` declares 8 controls; `IntakeField` renders only `select`
  specially and falls through to a one-line text input for `multiselect`,
  `textarea`, and `boolean` (`src/react/IntakeField.tsx:61-112`,
  `normalize.ts:58-68`); `DesignField` handles only `textarea`/`select`.
  Latent today only because no call site passes those ids — which is itself a
  symptom of §3.5/§3.6.
- `planning_goals` is `control: 'multiselect'` with a string-only `trimString`
  normalizer that nulls the arrays actually stored
  (`registry.ts:251-257`; `IntakeWizard.tsx:928`), so
  `syncFieldToDesign('planning_goals', […])` returns `null`. Its sibling
  `asset_types` (`:295-301`) has options but no normalizer — the two are
  mutually inconsistent.

### 3.5 Medium — `select` fields validation can't actually check
- `validateSharedField` only checks membership when `def.options` is set
  (`validate.ts:13-18`); `child_parentage` uses `optionsFor` and is skipped.
  The wizard confirms real drift: `IntakeChildrenStep.tsx:153` stores `'both'`
  or a raw first name, not the registry's `joint`/`client`/`spouse`, requiring a
  translator (`lib/contacts/parentageFromIntake.ts:7-18`).
- `estate_value`: label helpers accept legacy values
  (`LEGACY_ESTATE_VALUE_OPTIONS`, `assets.ts:30-37`) that the validation
  allowlist (`ESTATE_VALUE_OPTIONS`, `registry.ts:292`) rejects — a stored
  legacy value blocks portal submission with a blank select and no visible
  reason.

### 3.6 Medium — Registry child fields and several exports are dead
- `child_name`/`child_dob`/`child_relationship`/`child_parentage` and
  `DesignChildField` have zero app call sites; `PersonalSection.tsx:313-334`
  hand-inlines byte-identical option lists instead, and additionally makes
  relationship/parentage mutually exclusive by marital status — a constraint
  the registry doesn't express.
- Dead export surface includes all of `src/portal/leads.ts` (a fourth referral
  vocabulary), `DESIGN_ASSET_CATEGORY_OPTIONS`, `SHARED_PREFILLED_DESIGN_KEYS`
  (tests only), `formatPlanningObjectivesForDesign`, and more (see §7).
- `normalize.ts:50` contains a dead ternary: `CITIZENSHIP_VALUES.includes(text)
  ? text : text`.

### 3.7 Medium — `intakeKey`s mix wizard-local keys with DB columns
- The doc comment says "Key on client_intake", but `client_name` maps to
  `first_name` (a name part) and `street` to `street_address` (wizard-local; the
  column is `address_line1`, confirmed by `lib/intakeContactAddress.ts:20`).
  `validateIntakeField('address_line1', …)` returns null (unmapped), and
  `client_name`'s label ("Full Legal Name") doesn't match what its `intakeKey`
  yields (first name only). Same for `spouse_name` → `spouse_first_name`.

---

## 4. Vocabulary / enum drift across surfaces

### 4.1 High — Marital status: six-value registry, four-value consumers
- Registry: `single, married, divorced, widowed, separated, domestic_partner`
  (`packages/estate-fields/src/core/options.ts:21-28`).
- Four-value forks: `lib/leads/fieldDefinitions.ts:68-73` and
  `app/admin/matters/[id]/facts-panel/MatterFactsPanel.tsx:96-102` (a
  `separated`/`domestic_partner` client renders as "—" and any edit silently
  overwrites the stored status); the AI lead-import schema
  (`lib/intakeImport/leadIntakeImport.ts:25`) also only permits the four.
- Branch-on-`'married'`-only consumers skip spouse steps/sections for
  `domestic_partner` and `separated` spouses: `lib/intakeSections.ts:58, 105`,
  `components/AdminIntakeSheet.tsx:193`, `IntakeQuestionnaireReview.tsx:714`.
- `lib/lawmatics.ts:188, 194` drops `domestic_partner` from its allowlist and
  rewrites "domestic partnership"/"partnered" to `married`.

### 4.2 High — Referral source forked four ways; "Legal Insurance" reads back as "Other"
- Intake writes `Referral | Legal Insurance | Other`
  (`packages/estate-fields/src/core/referral.ts:4-8`;
  `components/intake/IntakeReferralStep.tsx:27`). The matter panel renders
  `client_referral | legal_plan | …` (`lib/matter/referralSource.ts:7-19`), and
  `normalizeReferralSource('Legal Insurance')` slugs to `legal_insurance`,
  matches nothing, and falls through to `'other'` (`:30-41`). Two more unused
  vocabularies exist (`src/portal/leads.ts:14-20`, and the lead UI free-text
  field). Additionally `client_intake.referral_source` (the column) has **zero
  writers** — `hooks/useAutoSave.ts:41-44` skips it on the false premise the
  column doesn't exist, while `lib/queries/matterCore.ts:108` still reads it.

### 4.3 High — Three asset-category vocabularies
- Registry design set (`assets.ts:3-9`, 6 values) — dead, zero external refs.
- `lib/estateTax.ts:73-86` (11 values) — what `types/assetIntake.ts` and the
  asset dialogs actually use.
- `INTAKE_ASSET_TYPE_OPTIONS` (`assets.ts:130-142`) — a third set with no
  mapping into `asset_intake` rows or the estate-tax calc.
  `INTAKE_FINANCIAL_DETAIL_LABELS` (`assets.ts:197-206`) omits
  `custodial_accounts` and `cryptocurrencies` that the option set includes.

### 4.4 Medium — Citizenship: 3-value select vs boolean column
- Registry declares `US Citizen | Permanent Resident | Non-Resident Alien`
  (`options.ts:30-34`) but the intake key is boolean `is_us_citizen`
  (`registry.ts:137`; `AdminIntakeSheet.tsx:474` renders yes/no).
  `normalizeCitizenship` collapses `false` → `Non-Resident Alien`
  (`normalize.ts:34-36`) — "Permanent Resident" is unrepresentable from intake
  and legally distinct (QDOT analysis). `reviewDisplay.ts:116-117` formats via
  `booleanReview`, which renders string citizenship values as blank.

### 4.5 Medium — Plan-type enums leak across boundaries
- Three deliberate vocabularies exist (`IntakePlanType`, `DesignPlanType`,
  `MatterPlanType`) but `lib/queries/matterCore.ts:94` sets
  `PipelineMatter.plan_type = intake?.plan_type ?? details?.plan_type`, mixing
  `'joint_rlt'`-style intake values into a field others may normalize with
  `normalizePlanType` (which collapses unknowns to `'N/A'`,
  `lib/matterPlanType.ts:19-27`).
- `trust_planning_type: 'standard'` is unreachable: `getTrustPlanningType`
  reinterprets stored `'standard'` as legacy `'outright_to_spouse'`
  (`lib/designSheetDocumentInclusions.ts:133-141`) while the union and setter
  still accept `'standard'` — any writer using the mapping's value gets a
  different value on read.

### 4.6 Medium — AI lead import writes values readers reject
- `lib/intakeImport/leadIntakeImport.ts:32` imports `estate_value` as free text
  with no normalization; the portal validates it as a strict 5-value select
  (`lib/intakeSections.ts:273` → `validate.ts:13-18`), so an imported value
  blocks client submission with a blank select and no explanation.

### 4.7 Medium — Design-sheet import allows free text into fixed-choice fields
- `lib/designSheetImport/shared.ts:44-55` states fixed-choice fields must carry
  `options` to reject unmatched text — but `plan_type`, `marital_status`,
  `county`, `client_citizenship`/`spouse_citizenship`, and `remote_beneficiary`
  all lack them (`shared.ts:64-141`). An imported "Revocable Trust" string lands
  in `plan_type`, normalizes to null, renders a blank select, and permanently
  trips the readiness blocker.

### 4.8 Low — Pronouns vs gender conflated
- `AddPersonDialog.tsx:288-290` offers 3 of 5 pronoun values under a "Select
  gender" label and writes them into `preferred_pronoun`, while
  `DesignSheetChild.gender` is `'male'|'female'|'other'`
  (`types/database.ts:549`). Same conflation in
  `MatterAdditionalContactsTab.tsx:198`. `ContactPicker.tsx:35-41` also carries
  a byte-identical local copy of `PRONOUN_OPTIONS`.

---

## 5. Document generation: design fields → templates

### 5.1 Critical — Signing day-of-month is discarded; documents are dated the 1st
- The design sheet stores a full `signing_date`
  (`SigningMechanicsSection.tsx:34-45`; authoritative per
  `designSheetReadiness.ts:252`), but the payload only carries
  month/year/county (`lib/draftPayload/assemble.ts:436-438`), and
  `toGeneratorData.ts:434-435` reconstructs `` `${month} 1, ${year}` `` — every
  generated will/DPOA/HCP/HIPAA/trust prints "the 1st day of Month, YYYY".

### 5.2 Critical — Trust tangible-personal-property clause compares against values never stored
- `trust-individual-single.docx` branches on `distribution_method ==
  'equal_shares' | 'priority_order'` and loops `beneficiaries` /
  `priority_beneficiaries`; the design sheet only stores
  `spouse_then_children | children_then_descendants | named_then_children |
  memorandum` (`TrustDetailsSection.tsx:516-524`), passed through verbatim
  (`toGeneratorData.ts:643-645`), and the two arrays are never set. The article
  emits no operative disposition.
- Related: with the field blank, the will defaults it to
  `'children_then_descendants'` and the trust to `'memorandum'`
  (`toGeneratorData.ts:590` vs `:644`) — one unanswered question yields
  contradictory dispositive language across the two instruments. And the legacy
  clause path doesn't know `'memorandum'` at all
  (`lib/drafting/clauses.ts:67, 550-576`) — that selection emits no tangible
  property clause in the legacy will.

### 5.3 Critical — Specific-bequest document routing and timing dropped
- `SpecificBequest.document` (`'will' | 'trust'`) and `.timing` are never read
  by `normalizeSpecificBequests` (`toGeneratorData.ts:149-184`); `specific_gifts`
  is rendered by both the wills and the joint trust — a gift assigned to one
  instrument prints in both (double disposition). Same for
  `PetCareDetails.document`.

### 5.4 High — Spouse trustee slot semantics disagree between the two builders
- `lib/draftPayload/helpers.ts:384-386` writes slot order **0** (the primary)
  into `spouse_trustee_successor`/`_co` and never reads order 1+, while the
  contact-role builder defines the same key as priority **2** (`:242-243`).
  `fiduciaryDetails.ts` has no spouse-trustee role at all, so spouse-trustee
  contact details never reach any document.

### 5.5 High — Template variables with no producer (render blank in client documents)
- Design-summary gift fields `gift.beneficiary_name/trigger/description/notes` —
  payload emits `{ item, recipient }` only (`toGeneratorData.ts:178`); loop
  locals evade the `knownTemplateRoots` CI check
  (`lib/estateGenerator/templateVariables.ts:202`).
- `trust.remote_beneficiaries.individuals` mixes bare strings (`['heirs at
  law']`) with person objects (`toGeneratorData.ts:450-454`); the template
  iterates `person.full_name`, so the default heirs-at-law case renders an empty
  named-individuals clause.
- Third health-care agent: templates reference
  `healthcare.agent.second_alternate.*` but `toGeneratorData.ts:782` hardcodes
  `person(null)` and `fiduciaryDetails.ts:286-290` reads only slots 0–1; the
  legacy path hardcodes the same hole (`lib/drafting/context.ts:111-112` vs
  clause gates `lib/drafting/clauses.ts:1004, 1017`).
- HIPAA additional agents are collected and mapped
  (`healthcare.ts:105-112`, `toGeneratorData.ts:819-832`) but
  `hipaa-authorization.docx` never references them — attorney selections vanish.
- Funding plan: `decisions.funding_plan` has no writer
  (`lib/fundingPlan/prompt.ts` is an explicit stub) yet the package can be
  selected and `trust-funding-plan.docx` renders its variables — always empty;
  `assets.items[].owner` is hardcoded `null` (`toGeneratorData.ts:886`) and
  printed as a table column.
- `client.first_name` is computed in the payload but dropped from the generator
  context (`assemble.ts:467-468` vs `toGeneratorData.ts:515-543`), so
  `estate-plan-summary.docx`'s `{{ client.first_name or client.full_name }}`
  always takes the fallback — while the QA example fixture supplies it.
- `client_citizenship`/`spouse_citizenship`/`client_domicile` are carried in the
  payload but consumed by no template; `spouse_phone`/`spouse_email` never enter
  `payload.spouse` at all (`assemble.ts:243-253`).

### 5.6 High — Co-trustee action falls back to a foreign vocabulary
- `toGeneratorData.ts:732-734` falls back from
  `'independent'|'joint'|'settlor_separate_others_joint'` to
  `cotrustee_decision_standard` (`'majority'|'unanimous'`); the template only
  tests `== 'joint'`, so several selections silently produce the "Act
  Independently" clause. The missing-field map points at a design field name
  that has no input (`missingFieldDesignMap.ts:57` vs the live control in
  `TrustDetailsSection.tsx:363-386`).

### 5.7 Medium — Homestead / real-estate payload gaps
- `lib/draftPayload/homestead.ts:44-52` builds beneficial owners from
  `customName` only, ignoring `source: client|spouse|trust|realty_trust`
  selections that the module's own `resolvePartyName` handles
  (`lib/realEstateTransfer/formState.ts:174-183`); `trust_deed_book`,
  `trust_deed_page`, `land_court_document_number`, `servicemember_names` are
  hardcoded `''` while `homestead-trustee.docx` prints all four.

### 5.8 Medium — Two generation paths date and format differently
- The legacy DOCX-fill path stamps *today* as the instrument date
  (`lib/drafting/projectDesignSheet.ts:319-320, 425-426`) and emits raw ISO
  DOBs, while the generator path uses signing month/year and long-form dates —
  the same clause text dates differently depending on the route.

### 5.9 Medium — Blockers pointing at the wrong section, or unable to fire
- `residual_beneficiary_method` blocker files under Estate Plan Design
  (`designSheetReadiness.ts:246-247`) but the control lives in Trust Details
  (`TrustDetailsSection.tsx:614`; the generator's own map agrees,
  `missingFieldDesignMap.ts:54`).
- Minor-children blockers are built with `sectionId = clientInformation` but
  surfaced under the estate-plan-design summary
  (`designSheetReadiness.ts:233-236, 258, 359`), while `family-information` is
  hardcoded complete (`:380`).
- Two DPOA blockers can never fire: readiness checks
  `!dpoaProvisions.agent_compensation` and `!coagent_serving`
  (`designSheetReadiness.ts:312-315`) but the getters always return truthy
  defaults (`designSheetDpoaProvisions.ts:128-132, 148-154, 181`;
  `buildInitialSheet.ts:134` seeds the legacy source field).
- Client placed in a fiduciary slot renders relationship "Spouse"
  (`fiduciaryDetails.ts:255-260`, `helpers.ts:286-290`).

### 5.10 Medium — Duplicate, orphaned fiduciary-display namespaces
- `decisions.fiduciary_display_options`
  (`designSheetDocumentInclusions.ts:253-280`) has zero external callers;
  drafting reads `decisions.fiduciary_document_inclusions`
  (`fiduciaryDocumentInclusions.ts:63-92` → `fiduciaryDetails.ts:341`), whose
  setter/options are referenced only by a test — no UI renders those
  checkboxes, so drafting always receives all-false.

---

## 6. Leads / CRM interactions

### 6.1 High — Intake → lead sync is a no-op stub while a full leads CRM ships
- `lib/syncLeadFromIntake.ts` is a no-op whose comment claims "Cornerstone Lite
  has no leads CRM", yet `app/admin/leads` is a full CRM and both intake save
  paths still call the stub (`app/actions/adminIntake.ts:412, 486`;
  `app/api/intake/route.ts:326-329, 606-613, 646-653, 667-674`). Intake edits to
  name/email/phone never propagate to a linked lead.

### 6.2 Medium — Lead spouse-completeness keys only on `'married'`
- `lib/leads/fieldDefinitions.ts:171-174` — a `domestic_partner` lead is never
  prompted for spouse details, though downstream planning treats partners as
  two-settlor households (`lib/intakePlanType.ts` marks partner plans
  `twoSettlors: true`).

### 6.3 Medium — `fid_trustee_spouse` hydration mismatch
- `lib/intakeContactHydration.ts:25` hydrates a slot no intake UI collects, no
  validation covers, and no readiness rule checks — while
  `REVIEW_FLAG_SATISFIED_BY` *reads* `spouse_trustee_slots`
  (`lib/intakeReadiness.ts:453`). See §3.2 and §2.1 for the full loop.

---

## 7. Database schema vs types vs queries

The canonical migration chain is `supabase/migrations/` (per its README;
`supabase/migrations_archive/portal/` is the superseded portal history).
`types/supabase.ts` is a permissive `AnyRow` stub, so none of the following is
caught at compile time.

### 7.1 Critical — 27 phantom `matter_details` fields: typed and write-allowlisted, but no column exists
- `matter_details` is created at
  `supabase/migrations/20260705000001_drafting_baseline_documents.sql:63` and
  extended by later ALTERs; the resulting column set contains **none** of:
  `matter_type`, `clio_matter_number`, `ep_ancillary_docs`, `ep_ilit_trustee`,
  `ep_living_will_status`, `ep_hipaa_auth_status`, `ep_witness_required`,
  `ep_funding_complete_date`, `conflict_check_completed`,
  `conflict_check_date`, thirteen `pb_*` probate date/amount fields,
  `pb_beneficiary_count`, `pb_heir_count`, `pb_real_property_parcel_count` —
  yet all are declared in `types/matter-details.ts` and accepted by the PATCH
  allowlist in `app/api/admin/matter-details/route.ts:26-71`. They exist only in
  the archived chain (`migrations_archive/portal/20260406000134_…`).
- Live failure paths: the upsert at `route.ts:294-300` gets a PostgREST
  unknown-column error → 500. The facts-panel couple/individual selector saves
  `matter_type` (`MatterFactsPanel.tsx:795`) and never persists, so
  `isCoupleMatter` (`lib/matter/matterType.ts:38-41`) can never be overridden;
  the entire probate essentials card
  (`MatterProbateEssentialsCard.tsx:105,135`) is unsavable.

### 7.2 Critical — Draft payload selects two nonexistent columns, nulling the whole `matter_details` read
- `lib/draftPayload/assemble.ts:88-95` selects `ep_ancillary_docs` and
  `ep_ilit_trustee` (verified: present in the select, absent from every
  canonical migration). A select naming a missing column fails the entire
  statement, so `details` comes back null and all ten *valid* columns in that
  list (`ep_trust_type`, `ep_special_provisions`, tax flags, notes) silently
  drop out of every generated document payload.

### 7.3 High — `spouse_address` in the pipeline views is actually the client's address
- `supabase/migrations/20260827000000_matter_pipeline_all.sql:34` (and the two
  earlier view definitions) builds `spouse_address` from `ci.*` (client intake)
  while every neighboring spouse column reads `cs.*`. The non-view fallback path
  computes it correctly from the spouse contact
  (`lib/queries/matterCore.ts:88`), so the two paths disagree on the same field.

### 7.4 High — `fetchMatter` uses `.single()` against a view that fans out on design-sheet versions
- The pipeline views join `design_sheets` with no version predicate
  (`20260827000000_matter_pipeline_all.sql:56`); `design_sheets` is unique on
  `(matter_id, version)` (`20260813000001_design_sheet_unique_version.sql:44`).
  Any matter with a second design-sheet version makes `.single()`
  (`lib/queries/matterCore.ts:134-139`) error into the fallback path, and
  duplicates the matter in every list built on these views.

### 7.5 High — `convert_lead_to_matter` overwrites attorney-entered matter fields with lead nulls
- `supabase/migrations/20260802000000_unify_leads_matters.sql:489-521`
  (`on conflict do update`) unconditionally sets `jurisdiction_county`,
  `est_estate_value`, `referral_source`, `urgency`, and `matter_status_notes`
  from lead-side values — including null — clobbering pre-hire edits.
  `matter_status_notes` (general notes) is overwritten by `qualification_notes`.
  The incremental path repeats it: `20260908000000_lead_legal_plan_billing.sql:275-283`
  sets `jurisdiction_county = nullif(v_lead.county,'')` with no `coalesce`
  (unlike `jurisdiction_state` on the adjacent line), so editing an unrelated
  lead field wipes a manually set county.

### 7.6 Medium — `types/leads.ts` types a `leads` table that doesn't exist
- No canonical migration creates `leads` (folded into
  `client_intake`/`matters` by `20260802000000`). `LeadStatus` in
  `types/leads.ts:3-12` has nine values, none of which is legal — the DB check
  is `relationship_status in ('lead','hired','lost','declined')`
  (`20260824000000_matter_lifecycle_v3.sql:28`); the live type is
  `lib/leads/viewTypes.ts:120`. Column names (`street`,
  `estimated_estate_value`, `source_channel`, `status`, `converted_matter_id`,
  `deleted_at`) don't match the real ones (`address_line1`, `taxable_estate`,
  `lead_source`, `lead_status`, `matter_id`, none). Currently imported but
  never really used — a loaded gun for the next feature.

### 7.7 Medium — Stage template with no stage
- `config/stage-task-templates.json:51` declares `stage_key:
  "proposal_ea_out"`, which exists in no `stage_sla` seed
  (`20260903000001_split_design_engine_stage.sql:35-49` deliberately leaves that
  slot free) and has no non-test caller — the template can never fire.
  (Adjacent enums verified clean: `MatterStage`, `MATTER_ENGINE_KEYS`, and the
  JSON's `plan_types` all match their DB/code counterparts.)

---

## 8. Dead surface worth pruning (Low)

- `intakePlanTypeMapping`, `lib/intakeLegalFlags.ts` (dead until §1.1 is fixed).
- All of `packages/estate-fields/src/portal/leads.ts`;
  `DESIGN_ASSET_CATEGORY_OPTIONS` and `designAssetCategoryMeta`;
  `CITIZENSHIP_VALUES`; `MARITAL_STATUS_VALUES`; `GOALS_TEXTAREA_MAX_LENGTH`;
  `formatPlanningObjectivesForDesign` (should instead be wired into
  `reviewDisplay` — its absence makes the `planning_objectives` review row
  always empty, `reviewDisplay.ts:77, 135-136`).
- `lib/phone.ts` duplicates `packages/estate-fields/src/core/phone.ts`
  verbatim; different files import different copies.
- `planStructureClone.ts:65` lists `'plan_type'` in decision keys that
  persistence always strips (`designSheetPersistence.ts:313-317`) — dead weight
  that silently vanishes on save.
- `MATTER_PLAN_TYPE_OPTIONS` / `normalizePlanType` currently have no non-test
  callers.
- Registry docs drift: `packages/estate-fields/SYNC.md` describes consumers and
  validation postures that don't match the code.
- `types/planReview.ts`: only `SlotState` is imported anywhere; no
  `plan_review*` table exists (review state lives in
  `client_intake.review_choices`).
- `matter_details.claim_amount`: real column, zero readers/writers (already
  documented as deprecated in `types/matter-details.ts:163-168`).

---

## Suggested priorities

1. **Stop the data loss** (§2.1–§2.4, §7.5): add `for_party` to the fiduciary
   wipe filter or scope the admin wipe to client-party rows; merge instead of
   replace `financial_details`/`family_details`; pick one shape for
   `planning_objectives` and parse on read; make the lead→matter conversion
   coalesce instead of overwrite.
2. **Fix the broken saves and reads** (§7.1–§7.2): reconcile
   `types/matter-details.ts` + the PATCH allowlist with the real schema (add
   the missing columns or drop the phantom fields), and remove the two
   nonexistent columns from the draft-payload select.
3. **Fix the intake→design seed** (§1.1, §1.2): implement the missing
   plan-type/document-inclusions seeding and rename
   `estate_plan_setup` → `estate_plan_design` in readiness.
4. **Fix client-facing document output** (§5.1–§5.4): carry `signing_date`
   through the payload; align the tangible-property enum between sheet and
   templates; honor bequest routing; reconcile the spouse-trustee slot.
5. **Unify vocabularies** (§4): single marital-status list, single referral
   mapping, one asset-category set with explicit translations; fix the
   `spouse_address` view column (§7.3) and the design-sheet view fan-out
   (§7.4).
6. Then burn down the dead surface (§8) so the registry becomes the actual
   source of truth it is documented to be.
