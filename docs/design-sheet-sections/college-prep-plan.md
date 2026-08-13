# College Preparation Plan

**Section ID:** `college-plan`
**Group:** `college-plan` (its own tab; estate sheets never show it)
**UI:** `CollegePrepSection`
**Visibility:** matters whose practice area is `CP` (mirrored to `decisions.plan_track === 'college_prep'`)
**Source files:** `lib/collegePrepDesign.ts`, `lib/designSheet/seedCollegePrep.ts`, `lib/designSheet/reconcilePlanTrack.ts`, `lib/practiceArea.ts`, `lib/collegePrepFields.ts`

## What this plan is

A student turning 18 signs four documents: a durable power of attorney, a health
care proxy, a HIPAA authorization, and a living will. There is no trust, no will,
and no deed. The student is the client — parents are contacts and nominees, not
co-clients — so the core `client_*` columns hold the student's own identity.

The client side of this plan is the `college_prep` intake track
(`client_intake.intake_track`, `client_intake.college_prep_details`). This
section is the drafting side of the same plan.

## Practice area, and the track marker

**The practice area is the switch.** `CP` (College Preparation Plan) is its own
practice area alongside `EP`, `EP-LP`, and `Probate`. It is set on the matter —
Matter detail → Practice area — and everything about the plan follows from it.

`decisions.plan_track` (`estate` | `college_prep`) is the sheet-level marker the
pure readers use, because document inclusions, readiness, the section lists, and
the FERPA payload all take a sheet and have no matter in hand.
`lib/designSheet/reconcilePlanTrack.ts` is the join: it moves the marker to match
the practice area, and runs in two places —

- **`PATCH /api/admin/matter-details`** when the practice area is written, so the
  next reader of the sheet is correct whether or not anyone opens the workspace.
- **`loadDraftingMatterContext`** on every drafting load, catching rows changed
  by the backfill, an import, or SQL.

A lead converting from the college-prep questionnaire opens as a `CP` matter
(`lib/matters/createFromIntake.ts`), so the common path never needs a correction.

Missing or unrecognized practice areas normalize to `EP`, so every existing
matter is unaffected.

### What the marker drives

| Consumer | Effect on `college_prep` |
| --- | --- |
| `defaultDocumentInclusions` | trust / will / deed / young-adult off; DPOA + health care on |
| `getEstatePlanDesignSetup` | plan-wide extras (summary, signing guide, role guide) default off |
| `getAllDesignSectionNavItems` | student section list; no trust, will, asset, or deed sections |
| `buildDesignSheetGroups` | six tabs: Intake, College Prep, Fiduciaries, POA, Health care, Notes |
| `computeDesignSheetReadiness` | no plan-type blocker; college-prep blockers instead |
| `isEstatePlanningPracticeArea` | **true** for CP — leaving it out would zero every `include_*` flag and generate an empty package |

### What moves when the practice area changes

The document set has to move with the track, or a College Preparation Plan would
quietly keep drafting the trust and will stored from its estate days.

| On switch | Behavior |
| --- | --- |
| `decisions.document_inclusions` | cleared, so the new track's defaults apply — a stored `trust: true` would otherwise keep drafting a trust for a student |
| `estate_plan_design.ancillary_documents`, `.will_title` | cleared for the same reason |
| `decisions.college_prep` | adopted from the matter's intake when it is on the college track; otherwise kept as-is (never cleared, so a correction back is not re-entry) |
| `plan_type`, `estate_plan_design.signing_type` | preserved — plan type is inert on the college track and restores on the way back |
| Client facts, fiduciary slots, DPOA and health care provisions | untouched |
| Matter number | untouched — numbers are allocated at creation and never rewritten, so a matter reclassified to CP keeps the number it was opened under |

The design sheet shows the track read-only (**Plan track**, top of Estate Plan
Details or of the College Preparation Plan section) with a link to the matter,
rather than offering a second place to change it.

## Design sheet fields

### Columns seeded from the answers

| Column | Source answer |
| --- | --- |
| `client_*`, `street`/`city`/`state`/`zip`/`county` | the student's own intake identity (unchanged estate seed) |
| `poa_slots`, `hcp_slots` | `fid_poa_client` / `fid_hcp_client` intake entries |
| `plan_type` | always `null` — no trust-or-will structure to choose |
| `is_joint` | always `false` |
| `hcp_anatomical_gift` | `organ_donation` (`any`→`all`, `specific`→`specified`, `no`→`none`, `discuss`→null) |
| `hcp_anatomical_specified` | `organ_donation_notes` when `organ_donation === 'specific'` |
| `hipaa_psychotherapy_notes` | `do_not_authorize` when mental health is a withheld category, else `authorize` |
| `goals_notes` | school, move-in date, FERPA gap, springing-POA gap, unmapped powers |
| `concerns` | `concerns` |

### `decisions.college_prep` (jsonb)

Every field is the intake answer with the wizard's `college_` prefix stripped, so
`college_hipaa_scope` becomes `hipaa_scope`. Unknown or retired option values are
dropped on read (`getCollegePrepDesign`) rather than carried into a document.

| Group | Fields |
| --- | --- |
| School | `school_name`, `school_city`, `school_state`, `move_in_date`, `studying_abroad`, `abroad_country` |
| FERPA | `ferpa_release`, `ferpa_records[]`, `ferpa_recipients` |
| DPOA | `dpoa_effective`, `dpoa_powers[]`, `dpoa_withheld`, `dpoa_notes` |
| Health care proxy | `hcp_limits`, `hcp_instructions` |
| HIPAA | `hipaa_scope`, `hipaa_excluded_categories[]`, `hipaa_different_scope`, `hipaa_expiration`, `hipaa_expiration_date`, `hipaa_recipients[]`, `excluded_people` |
| Living will | `living_will_include`, `life_support`, `cpr`, `artificial_nutrition`, `ventilation`, `comfort_always`, `organ_donation`, `organ_donation_notes`, `other_medical_notes` |
| Context | `family_circumstances`, `concerns` |

### Provision namespaces seeded from the answers

The section does not introduce a parallel drafting path — it seeds the same
namespaces the Financial Power of Attorney and Health Care sections already edit,
so the attorney reviews and adjusts them in place.

`decisions.dpoa_provisions`:

Mapped **only where the statutory category genuinely contains the answer**. An
approximate fit is worse than none: the seed is lossy in both directions and
neither loss shows in the drafted document — collapsing several answers into one
broad category grants *more* than the student asked for, and forcing an answer
into the nearest category grants *less*.

| Student answer | Statutory power (`DPOA_BASIC_POWER_KEYS`) |
| --- | --- |
| Banking and bank accounts | `banking` |
| Paying bills, tuition/bursar | `personal_family_maintenance` |
| Taxes | `tax_matters` |
| Leases and housing | `real_property` |
| Auto | `tangible_personal_property` |
| Insurance claims | `insurance_annuity` |
| Retaining an attorney, citations and conduct charges | `claims_litigation` |
| Investments | `stocks_bonds` |

Left unmapped on purpose, and listed in `goals_notes` for the attorney to grant
deliberately:

| Student answer | Why not mapped |
| --- | --- |
| Financial aid and scholarships | Federal Title IV aid is arguably a government benefit; institutional and private scholarships are not |
| Student loans, credit cards | Reaching consumer debt through `banking` would grant the whole banking category |
| Employment paperwork and payroll | The statutory list has no employment category |
| Signing contracts | Spans every category, so assigning it to one understates it |
| Digital accounts | *Not deferred* — sets `power_digital_assets`, its own template switch |

Tuition or financial aid still sets `power_529_plans`, which is a narrow switch
rather than a statutory category. Gifting and trust powers are seeded off: this
plan buys account access, not estate planning.

`decisions.healthcare_provisions`:

| Student answer | Provision |
| --- | --- |
| `life_support: all_measures` | `client_advance_directive: prolong_life` |
| `life_support: comfort_only` | `client_advance_directive: do_not_prolong_life` |
| `life_support: trust_agent` | left null — the absence of a written instruction *is* the choice |
| HIPAA recipients | `hipaa_list_fiduciaries_by_name: 'by_name'`, `hipaa_include_poa: true` |

## Drafting blockers

`collegePrepDraftingBlockers` (surfaced through `computeDesignSheetReadiness` on
the `college-plan` section). "Discuss at the meeting" is a client answer, not a
resolved one, so it blocks:

| Blocker | Cleared by |
| --- | --- |
| power of attorney effective date | `dpoa_effective` resolved to immediate or springing |
| powers granted to the financial agent | at least one `dpoa_powers` entry |
| HIPAA release scope | `hipaa_scope` resolved |
| HIPAA withheld categories | a category selected when scope is `all_except` |
| HIPAA expiration / expiration date | HIPAA requires the authorization to state one — never deferrable |
| living will decision | `living_will_include` resolved |
| life-sustaining treatment instruction | `life_support` resolved when a living will is included |

## Generator mapping

The four incapacity documents need no college-prep branch in package selection:
with trust and will inclusions off and DPOA/health care on,
`deriveEstateGeneratorPackages` already resolves to a single package. The FERPA
release is its own package, selected by its own inclusion key.

| Design sheet | Package |
| --- | --- |
| DPOA + HCP + HIPAA + living will | `incapacity-documents` |
| `document_inclusions.ferpa_release` (defaults to the student's answer) | `ferpa-release` |
| everything else | *(none — no summary, no ancillaries)* |

The FERPA release carries its own `ferpa.*` fields off `decisions.college_prep`
— see [the placeholder map](../../tools/aubreylaw-docgeneration/docs/ferpa-release-placeholder-map.md)
for the field and conditional tables. Its legal language was drafted from the
statute rather than a firm source form, so it needs attorney review before
production use.

## Known gaps

One answer this section records still has no generator support, and the seed
writes it into `goals_notes` so it cannot be missed at the drafting desk:

- **Springing power of attorney** — `templates/durable-power-of-attorney.docx`
  drafts an immediately effective power and the data dictionary has no
  effective-date field. A springing election has to be drafted by hand until the
  template carries the incapacity-determination language.
