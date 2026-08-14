# College Preparation Plan — Template Alignment Review

Review of the three `college_plan_v1` source templates against the College
Preparation Plan design choices (`design_sheets.decisions.college_prep`,
vocabulary in `lib/collegePrepFields.ts`, drafting model in
`lib/collegePrepDesign.ts`). The source forms are staged under
`source-forms/college-prep/`:

| Source form | Contains |
| --- | --- |
| `education-poa-college-plan-v1.docx` | Special Durable Power of Attorney for Matters Concerning Education |
| `financial-poa-college-plan-v1.docx` | General Durable Power of Attorney |
| `health-care-documents-college-plan-v1.docx` | Health Care Proxy + Advance Directive + HIPAA Authorization + FERPA Authorization (one file, four instruments) |

**Status: implemented.** The conversion and wiring described below shipped as
the `college-financial-poa`, `college-education-poa`,
`college-health-care-documents`, and `college-advance-directive` packages —
see `docs/college-prep-placeholder-map.md` for the field-by-field map and the
list of new language awaiting attorney review. This document is retained as
the record of the field audit and design-gap analysis that drove the
conversion.

---

## 1. Field audit

### Fields that are canonical and populated (no action)

`client.full_name`, `client.city`, `client.county`, `client.date_of_birth`,
`client.pronoun_subject`, `execution.display_doc_date`,
`execution.display_ordinal_doc_date`, `execution.display_signing_county`,
`fiduciaries.agent.primary.full_name`, `fiduciaries.agent.successor.full_name`,
`healthcare.agent.primary.full_name` / `.address` / `.city` / `.state` / `.phone`,
`healthcare.agent.alternate.full_name`.

### Defects

| # | Template | Problem | Fix |
| --- | --- | --- | --- |
| F1 | health care | `healthcare.agent.alternateprimary.address` / `.city` / `.state` / `.phone` (4 uses) — not a canonical root; nothing populates it, every render prints `[[ MISSING ]]` | Rename to `healthcare.agent.alternate.*`. Note the dictionary defines `alternate.address` and `alternate.phone` but **not** `alternate.city` / `alternate.state` — either add those two fields (dictionary + `toGeneratorData` + draft payload) or print the single `alternate.address` line as the primary-agent block does not. |
| F2 | education POA | `{% if fiduciaries.agent.serve_jointly %}` — not a canonical flag. The canonical model is `fiduciaries.agent.co_agents_action` (`separate` / `joint` / `majority`) with `fiduciaries.agent.co_primary.full_name`, guarded by `has_co_poa` | Rebuild the appointment paragraph on `has_co_poa` + `co_agents_action` (see `references/conditional-patterns.md`). As written the paragraph names the **successor** and then optionally says the two "serve together" — it conflates a successor with a co-agent. |
| F3 | all three | `{{ execution.display_notary_commission }}` used bare — this is the one field the generator treats as optional, and every existing template renders it `\| optional` | Add `\| optional` so an unknown commission date renders blank instead of `[[ MISSING ]]`. |
| F4 | health care | `Relationship: Parent` hardcoded for both agents | Use `healthcare.agent.primary.relationship` / `healthcare.agent.alternate.relationship` (canonical, populated). A student's agent is usually but not always a parent. |
| F5 | health care | Anatomical-gifts sentence contains a literal fill-in `[ do  /  do not ]` | Bracket markers fail the QA scan (`markerScan.ts` blocks promotion). Must become a conditional on the college organ-donation answer (see G10). |
| F6 | financial POA | Successor/co-agent boilerplate is internally inconsistent: appoints primary and successor "in the order named," then says "Any one of my Attorneys-in-Fact may act alone … or may act jointly with any other Attorney-in-Fact" | Pick the incapacity-package appointment language (successor model), or branch on `has_co_poa` like the estate DPOA does. |
| F7 | financial POA | Execution date is a blank `___ day of ________` while the education POA merges `execution.display_ordinal_doc_date` | Use `execution.display_ordinal_doc_date` in all three for consistency. |
| F8 | education POA | Two notary blocks back-to-back: a standard acknowledgment **and** a combined principal-plus-witnesses jurat | Confirm both are intended; if the jurat is the keeper, drop the duplicate acknowledgment. |
| F9 | financial POA | Source-form artifacts: `ExeCuTION OF DOCUMENTS` heading, `transfergift`, and hyphenation debris (`ac-counts`, `in-formation`, `writ-ten`, `here-by`) | Clean during conversion. |

---

## 2. Design-choice gaps (what "aligned" means)

The college-prep questionnaire produces the answers below; the attorney must
resolve every `discuss` before drafting (`collegePrepDraftingBlockers`), so
templates can rely on a real value being present. None of these answers
currently reach any of the three templates.

### Financial POA (`college_prep.dpoa_*`)

| # | Design choice | Template today | Alignment |
| --- | --- | --- | --- |
| G1 | `dpoa_effective` — `immediately` vs `springing` | Effective immediately; no springing variant | Branch the effectiveness article: immediate (current text) vs springing-on-incapacity language with a physician-determination mechanism. This is a guaranteed answer (drafting blocker), so an unconditional template is wrong half the time. |
| G2 | `dpoa_powers` — 16 selectable powers | Static full general-DPOA power list | Map each option key to a power paragraph and wrap in `{% if %}` (or render a granted-powers schedule). Mapping to existing paragraphs: `banking`→Banking Powers, `bills`→Powers of Collection and Payment, `taxes`→Tax Powers, `investments`→Voting Powers + Retirement Plan Powers (split needed), `auto`→Motor Vehicles and Boats, `digital`→Digital Assets, `retain_attorney`→Power to Hire and Pay for Services / Legal Proceedings, `citations`→Power to Act in Legal Proceedings, `contracts`→Contracts. **No existing paragraph:** `tuition`, `financial_aid`, `student_loans`, `credit_cards`, `housing` (leases), `insurance_claims`, `employment` — new student-specific paragraphs to draft (mark clause JSON `review_status: draft`). **Existing paragraphs with no option:** Acquire and Sell, Management, Probate, Governmental Entitlements, Substitute, Care, Mail — decide whether these are always-on baseline or need options. |
| G3 | `dpoa_withheld` | No hook | Render an express-exclusions paragraph when present. |
| G4 | `dpoa_notes` | No hook | Attorney drafting notes — feeds drafting decisions, not necessarily printed; confirm. |

### Education POA

| # | Design choice | Template today | Alignment |
| --- | --- | --- | --- |
| G5 | No inclusion key exists — the college track is defined as exactly four documents (DPOA, HCP, HIPAA, living will) in `designSheetDocumentInclusions.ts` | — | Decide: does the education POA ride along with the financial DPOA toggle, or get its own inclusion + questionnaire question? Wiring below assumes its own key. |
| G6 | `dpoa_effective` | Article Five hardcodes "effective immediately" | Same springing/immediate branch as G1, or a deliberate decision that the education POA is always immediate (document it in the placeholder map if so). |

### Health care documents (`college_prep.hcp_*`, `hipaa_*`, living-will set)

| # | Design choice | Template today | Alignment |
| --- | --- | --- | --- |
| G7 | `hcp_limits` (limits on the agent's authority) | Article III grants "complete authority"; nowhere to print limits | Conditional limits paragraph in the HCP. |
| G8 | `hcp_instructions` (guidance to the agent) | No hook | Conditional instructions paragraph or schedule. |
| G9 | `living_will_include` — `yes` / `no` | Advance Directive always included | Gate the entire Advance Directive instrument on `living_will_include == 'yes'` (`collegePrepIncludesLivingWill`). On the `no` answer the package is three instruments, not four. |
| G10 | `life_support` (`all_measures` / `comfort_only` / `trust_agent`), `cpr`, `artificial_nutrition`, `ventilation`, `comfort_always` | Directive hardcodes "I direct that my life **not** be extended" in all three trigger conditions — this is the `comfort_only` answer baked in | Branch the directive: `comfort_only` keeps current text; `all_measures` needs the opposite instruction; `trust_agent` defers to the agent. Layer the per-treatment choices (CPR / nutrition / ventilation: yes / no / agent_decides) and the comfort-always sentence on `comfort_always`. |
| G11 | `organ_donation` (`any` / `specific` / `no`) + `organ_donation_notes` | Literal `[ do / do not ]` bracket (F5) | Three-way branch; `specific` prints the notes. |
| G12 | `hipaa_scope` — `all` vs `all_except` + `hipaa_excluded_categories` (mental health, substance use, HIV, reproductive, genetic) | Grants unlimited disclosure; the HCP's own HIPAA paragraph even enumerates the sensitive categories as *included* | HIPAA authorization needs an exclusions block on `all_except`; the HCP Article III HIPAA-access clause needs the same carve-out so the two instruments don't contradict each other. |
| G13 | `hipaa_expiration` — `none` vs `date` + `hipaa_expiration_date` | Termination clause is death-or-revocation only (= `none`) | Branch: `date` prints an expiration date. HIPAA requires the authorization to state its expiration — this is why it's an unconditional drafting blocker. |
| G14 | `hipaa_recipients` (named list, own vocabulary) + `excluded_people` | Recipients hardcoded to the two health care agents | Render the named recipient list (`{% for %}`); add an express-exclusion sentence for `excluded_people`. The recipients are often the same people as the agents but the design lets them differ. |
| G15 | `other_medical_notes`, `family_circumstances`, `concerns` | No hook | Attorney-facing context; likely not printed. Confirm and record in the placeholder map. |
| G16 | Embedded FERPA authorization duplicates the wired `ferpa-release` package | Static FERPA release naming the *health care agents* | **Recommend removing it from this template.** The existing `ferpa-release` package already renders from `ferpa.school_name`, `ferpa.records[]`, `ferpa.recipients` and is selected only when the student asked (`college_prep.ferpa_release === true`). Keeping both produces two conflicting releases naming different recipients. |

---

## 3. Wiring plan (the "prepare" checklist)

The college track currently selects the estate `incapacity-documents`
package (`deriveEstateGeneratorPackages`). Aligning these templates means a
college-specific package set:

1. **Templates** — convert the three source forms into
   `templates/college-financial-poa.docx`, `templates/college-education-poa.docx`,
   and the health-care set (recommend splitting the combined file into
   per-instrument templates like the incapacity package: HCP, advance
   directive, HIPAA — the directive is conditionally included per G9, and
   per-document outputs keep numbering and QA simple).
2. **Merge data** — new `college.*` namespace in the data dictionary
   (dpoa effective/powers/withheld, hcp limits/instructions, hipaa scope /
   excluded categories / expiration / recipients / excluded people, living
   will + treatment choices, organ donation), populated from
   `decisions.college_prep` via `lib/buildDraftPayload.ts` →
   `lib/estateGenerator/toGeneratorData.ts`, with derived flags in
   `node/context.ts` (e.g. `college_dpoa_springing`,
   `college_hipaa_all_except`, `college_living_will_included`).
3. **Manifests** — `packages/college-*.json`, minimal `required_fields`
   (client, agents); conditional requirements (e.g. expiration date only
   when `hipaa_expiration == 'date'`) go in `node/packageValidation.ts`.
4. **Selection** — on college-track sheets route `dpoa` / `healthcare`
   inclusions to the college packages instead of `incapacity-documents`;
   add an inclusion for the education POA (G5); extend
   `NODE_SUPPORTED_PACKAGES` and the package-name union.
5. **Missing-field routing** — `missingFieldDesignMap.ts` entries for every
   new `college.*` field → `S.collegePlan` (prefix rule exists for `ferpa.`
   already; add `college.`).
6. **Examples / docs / tests** — `examples/client-ma-college-*.json`
   exercising springing + all_except + living-will-no branches; placeholder
   maps under `docs/`; extend `node-estate-generator`,
   `draft-document-selection`, and `design-sheet-document-inclusions`
   tests; re-run `npm run skill:refs`.
7. **New legal language** (springing clause, student-specific powers,
   directive variants) enters as clause JSON with `review_status: "draft"`
   for attorney review before production.
