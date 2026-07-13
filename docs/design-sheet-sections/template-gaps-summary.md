# Cornerstone Template Gaps Summary

**Generated:** July 10, 2026  
**Scope:** All templates/packages in `tools/aubreylaw-docgeneration/`, with emphasis on Cornerstone cv1 conversions completed in Jul 2026.

**Pipeline reference:**

```text
design_sheets → buildDraftPayload() → toEstateGeneratorData() → packages → Node/Python render
Asset transfer docs (deed, realty trust, trustees certificate) → separate docxtemplater path
```

**Cornerstone conversion scripts (12):** `convert_cornerstone_poa_doc.py`, `convert_cornerstone_healthcare_docs.py`, `convert_cornerstone_pourover_will.py`, `convert_cornerstone_realty_trust.py`, `convert_cornerstone_nominee_trust.py`, `convert_cornerstone_assignment_pp.py`, `convert_cornerstone_certificate_trust.py`, `convert_cornerstone_funding_instructions.py`, `convert_cornerstone_trust_funding_plan.py`, `convert_cornerstone_homestead_trustee.py`, `convert_cornerstone_temp_delegation_doc.py`, `convert_cornerstone_estate_plan_summary.py`

---

## 1. Cross-cutting gaps

These issues affect multiple documents or the shared generator layer.

| Gap | Affected templates | Status | Action needed |
| --- | --- | --- | --- |
| **Design sheet fields wired; templates not updated** | DPOA, HCP, living will, HIPAA, assignment, certificate, trust packages | Payload ✅ / Template ❌ | Many Jul 2026 payload additions (`dpoa.basic_powers`, `healthcare.client_*`, `hipaa.*`, `fiduciary_display.*`, `guardians.excluded[]`) exist in `toEstateGeneratorData()` and `buildNodeEstateContext()` but Cornerstone templates still use static text or legacy conditionals |
| **Co-agent / co-trustee unsupported in Cornerstone POA** | `durable-power-of-attorney.docx` | Payload ✅ / Template ❌ | `has_co_poa`, `co_poa_joint`, `co_poa_separate` flags exist in `context.ts`; Cornerstone cv1 POA template has **no** `co_primary` or co-agent appointment paragraphs (legacy v1.1 only). Co-agent names populate `fiduciaries.agent.co_primary` but render nowhere |
| **Pronoun hardcoding** | Living will, HCP, realty trust, nominee trust, homestead | Partial | `client.pronoun_*` wired for some blocks; living will witness section still uses **"her"**; HCP witness attestation uses **"her Health Care Proxy"**; realty/nominee trusts hard-code **"their"** |
| **Custom pronouns fall back** | All | By design | Only he/she/ze/they buckets in `pronounsFromPreference()`; custom pronouns → they/them |
| **HCP third agent (second alternate)** | HCP, HIPAA | Template ✅ / Payload ❌ | Template has `healthcare.agent.second_alternate.*` conditionals; `fiduciaryDetails.ts` only resolves `hcp_slots` orders 0–1; `toGeneratorData` sets `second_alternate: person(null)` |
| **HIPAA additional agents** | HIPAA | Payload ✅ / Template ❌ | `hipaa.client_additional_agents[]` wired in payload; HIPAA template lists primary + alternate + optional trustee only — **no** `{% for agent in hipaa.client_additional_agents %}` loop |
| **Healthcare provisions not driving template branches** | HCP, living will | Payload ✅ / Template ❌ | `healthcare.client_advance_directive`, `client_anatomical_gift`, spouse variants, and context flags `hcp_client_advance_*` are wired; Cornerstone HCP has no anatomical-gift sections; living will is **static** (no `{% if hcp_client_advance_* %}` branches) |
| **HIPAA psychotherapy / list-by-name toggles** | HIPAA | Payload ✅ / Template ❌ | `hipaa.psychotherapy_notes`, `hipaa.list_fiduciaries_by_name` in generator; Cornerstone HIPAA template does not branch on these |
| **Fiduciary display toggles** | HCP, POA, wills, trusts | Payload ✅ / Template ❌ | `fiduciary_display.show_phone/address/email/dob/relationship` wired; templates do not wrap optional contact lines |
| **Structured kinship on fiduciary objects** | HCP, all fiduciary docs | Payload ✅ / Template partial | `fiduciary_details.*.relationship` resolves from `contact_profiles.relationship_kind`; HCP uses relationship fields; other docs may ignore |
| **DPOA basic power matrix** | DPOA | Payload ✅ / Template ❌ | 14 `dpoa.basic_powers.*` toggles + `all_basic_powers` in generator; Cornerstone POA has only 3 module toggles (`include_entity_powers`, `include_advanced_trust_gifting`, `include_extended_personal_care`) — **no per-statutory-power branches** |
| **DPOA coagent field ambiguity** | DPOA | Both wired | `dpoa.coagent_serving` and `dpoa.coagent_manner` both in payload; template authoring should document which is authoritative |
| **Asset schedule incompleteness** | Trust funding plan, future Schedule A | Partial | `assets.items[]` wired; `owner`, `gross_value`, `net_value` default to `—` / `estimated_value` |
| **Execution blanks when signing TBD** | All Jinja packages | By design | `signing_scheduled: false` → `________________, 20___` date/county/notary blanks |
| **al-generator.py vs Node context** | Pour-over will (manual QA) | Divergence | `examples/client-ma-pourover.json` is minimal; `al-generator.py` does not flatten `family.*` flags the way Node does — manual CLI renders may differ from app |
| **Two render engines** | Realty transfer vs estate packages | Architectural | Transfer docs use docxtemplater `{field}` flat merge; estate packages use Jinja + clause library — different authoring rules |
| **Joint grantor wording** | Assignment, certificate of trust | Template gap | Single-assignor / single-grantor templates; no `has_spouse` joint-grantor branch |
| **Ancillary toggles default on** | Certificate, assignment, funding, homestead, funding plan | UX | When trust is included, ancillary docs default **true** in `normalizeAncillaryDocuments()` — may over-generate until attorney unchecks |
| **`include_temp_delegation` auto-triggers** | Temp delegation | Logic gap | Docs reference an inclusion toggle; `helpers.ts` sets `include_temp_delegation: isEP && hasMinorChildren` with **no** separate attorney opt-out |
| **`will_pr_powers` not in generator** | Pour-over will, simple will | Payload partial | Design sheet captures granular PR powers; not mapped to `EstateGeneratorData` |
| **Trust provision toggles vs clauses** | Joint trust, individual trust | Partial | Many `trust.provisions.*` booleans in payload; few clause `condition` hooks — templates may ignore new toggles |
| **Attorney review required** | All Cornerstone conversions | Process | Placeholder maps note templates are draft automation — Massachusetts attorney review before client use |
| **Missing template files block packages** | See §4 | Blocking | Several Node-supported packages reference `.docx` files that do not exist in `templates/` |

---

## 2. Per-document gaps

### Incapacity (Cornerstone cv1)

| Document | Package | Status | Data gaps (design sheet → payload → generator) | Template gaps | Manual attorney steps |
| --- | --- | --- | --- | --- | --- |
| **Durable Power of Attorney** | `incapacity-documents` | **Converted / wired** | Co-agent in `poa_slots` → `fiduciaries.agent.co_primary` but unused; `dpoa.basic_powers.*`, `allow_gifts`, `agent_compensation`, `trust_powers` wired to generator | No co-agent appointment language; no per-power statutory grant branches; 3 opt-in modules only (`include_entity_powers`, `include_advanced_trust_gifting`, `include_extended_personal_care`) | Review module selections; add co-agent paragraphs manually if needed; verify gifting/compensation elections |
| **Health Care Proxy** | `incapacity-documents` | **Converted / wired** | `hcp_slots` orders 0–1 only (no order-2 → `second_alternate`); per-party `healthcare.client_*` wired but unused; agent address falls back to client address | No anatomical-gift conditionals (Cornerstone form differs from legacy v1.1); witness block hard-codes **"her"**; `fiduciary_display` toggles ignored | Fix pronouns in witness attestation; add third alternate manually if needed |
| **Living Will / Advance Directive** | `incapacity-documents` | **Converted / wired** | `healthcare.client_advance_directive` + `hcp_client_advance_*` flags wired; **not consumed** | Entirely static text — no branches for prolong life / DNR / do not prolong; witness section hard-codes **"her"** | Select correct living-will variant manually or edit post-generation; fix pronouns |
| **HIPAA Authorization** | `incapacity-documents` | **Converted / wired** | `hipaa.client_additional_agents[]`, `include_poa`, `psychotherapy_notes`, `list_fiduciaries_by_name` wired | No loop for additional agents; no psychotherapy branch; no POA-as-recipient branch; trustee block conditional only | Add extra authorized recipients manually; verify psychotherapy election |
| **Spouse incapacity docs** | `spouse-incapacity-documents` | **Reuses client templates** | Spouse agent swap in generator; spouse healthcare provisions wired | Same template gaps as client docs; spouse-specific advance/anatomical branches missing | Same as client incapacity set |

### Estate / trust (Cornerstone cv1)

| Document | Package | Status | Data gaps | Template gaps | Manual attorney steps |
| --- | --- | --- | --- | --- | --- |
| **Pour-Over Will** | `pourover-will` | **Converted / wired** | `will_pr_powers` not in generator; `guardians.excluded[]` wired | cv1 uses clause library — generally complete; `al-generator.py` test data incomplete | Attorney review; verify excluded-guardian reasons render in clause |
| **Real Estate Trust (Realty Trust)** | Transfer pipeline (`include_real_estate_trust`) | **Converted / wired** | `buildTemplateFields()` populates flat fields; `successor_trustee` etc. **not** in merge map; `trust_term_extension_years` defaults 21, not in Transfers UI | Trustee pronouns hard-coded `their`; dual trustee/notary blocks always show; `{beneficial_owners}` is one string (no row loop) | Select trustees/beneficiaries in Transfers UI; fix pronouns; hide extra notary block if single trustee |
| **Nominee Trust (No Real Trust)** | *None* | **Converted / not wired** | No `include_nominee_trust` flag; `buildTemplateFields()` does not populate `{successor_trustee}`, `{co_trustee}`, `{beneficiary_*}` | Not in `selectedDocs`; second trustee notary always present; pronouns static `they/them/their`; only 2 beneficiary slots | Entire doc manual today; needs package + transfer UI wiring |
| **Assignment of Personal Property** | `assignment-of-personal-property` | **Converted / wired** | Ancillary toggle → `documents.include_assignment_of_personal_property` | Single assignor only; no joint-grantor `has_spouse` branch | Joint plans may need manual grantor language |
| **Certificate of Trust** (c. 203E § 1013) | `certificate-of-trust` | **Converted / wired** | Ancillary toggle wired | Assumes revocable trust; no joint-grantor plural; no irrevocable branch; no spouse package variant | Verify revocability line; joint trust may need manual "Grantors" edit |
| **Funding Instructions** | `funding-instructions` | **Converted / wired** | Names + trust titling line only | Subtitle maps married → client/spouse names (not trust name) — confirm with firm; checklist static (not driven by asset schedules); no separate-trusts branch | Confirm subtitle convention; customize checklist per client |
| **Trust Funding Plan** | `trust-funding-plan` | **Converted / wired** | `decisions.funding_plan` readable in payload but **no design-sheet UI**; `asset.owner` always `—` | Narrative/checklist empty without manual seed or future AI route; separate-trusts subtitle may need both trust names | Draft narrative via AI prompt (`lib/fundingPlan/prompt.ts`) or manual entry; review asset inventory table |
| **Declaration of Homestead (Trustee)** | `homestead-trustee` | **Converted / wired** | `homestead.trust_deed_book/page` blank (not on design sheet); `servicemember_names` empty; `land_court_document_number` not from deed extract | Elderly/disabled paragraphs always render; third trustee signature removed; spouse occupant line only | Check applicable homestead boxes; fill trust instrument recording refs; verify beneficiary names |

### Guardianship (Cornerstone cv1)

| Document | Package | Status | Data gaps | Template gaps | Manual attorney steps |
| --- | --- | --- | --- | --- | --- |
| **Temporary Delegation of Parental Powers** | `temporary-delegation-parental-powers` | **Converted / wired** (firm `parental-delegation.docx`) | Auto-included when minor children (no opt-out toggle); `guardians.temporary_co` + phone wired Jul 2026; `temporary_successor` / `temporary_second_successor` unused in firm template | Firm template: inline children list, co-agent on same line, no alternate-agent section; Cornerstone cv1 converter retained as legacy | Verify solo-parent branches; alternate agent not in firm form |
| **Parental Appointment of Guardian** | `parental-guardian-appointment` | **Package exists / template missing** | Auto-included for minor children EP matters; slots wired | **`templates/parental-guardian-appointment.docx` does not exist** — `parental-delegation.docx` is **not** this form (it is temp delegation §5-103) | Use firm form manually until correct source converted |

### Pre-Cornerstone templates (still in production path)

| Document | Package | Status | Data gaps | Template gaps | Manual attorney steps |
| --- | --- | --- | --- | --- | --- |
| **Joint Revocable Trust** | `joint-trust`, `joint-trust-simplified` | **Not Cornerstone cv1** — older `joint-trust.docx` | `trust_planning_type` / Clayton / disclaimer branching needs verification | Many `trust.provisions.*` toggles lack clause hooks; `residuary_after_death` enum coverage unverified; `special_trustee_instructions` needs placeholder | Attorney review; Cornerstone joint-trust source not yet converted |
| **Individual Single Revocable Trust** | `trust-individual-single` | **Not Cornerstone cv1** | Same trust-provision gaps | Pre-Cornerstone source form | Attorney review |
| **Individual Disclaimer Trust** | `indv-disclaimer-trust` | **Package exists / template missing** | `trust.spousal_funding` / disclaimer logic wired | **`templates/indv-disclaimer-trust.docx` missing** | Manual trust doc until template added |
| **Deed** | Transfer pipeline (`include_deed`) | **Not Cornerstone** — starter `deed.docx` | Preflight when deed toggle on but form incomplete; single-property workflow | Not updated in Cornerstone pass; field keys must match `buildTemplateFields()` | Complete Transfers & Assignments form; verify one parcel per generation |
| **Trustee's Certificate** (c. 184 § 35) | Transfer pipeline (`include_trustees_certificate`) | **Not Cornerstone** — `trustees-certificate.docx` | Separate from certification of trust (c. 203E § 1013) | Not updated in Cornerstone pass | Do not confuse with `certificate-of-trust.docx` |

### Summary / ancillary packages (no Cornerstone conversion)

| Document | Package | Status | Notes |
| --- | --- | --- | --- |
| **Estate Plan Summary** | `estate-plan-summary` | **Converted / wired** | Cornerstone cv1 (`estate-plan-summary_cv1.docx`); pure Jinja conditionals on `planning.include_*` |
| **Design Summary (detailed + worksheet)** | `design-summary` | **Templates missing** | `design-summary-detailed.docx`, `design-summary-worksheet.docx` missing; worksheet caps children at 3 rows |
| **Personal Property Memorandum** | `personal-property-memorandum` | **Template missing** | Included when will selected; template missing |
| **Young Adult Estate Plan** | `young-adult-estate-plan` | **Template missing** | Toggle for ages 17.5–25; template missing |
| **Simple Will** | `simple-will` | **Template missing** | References `templates/will.docx` (not in repo) |
| **Testamentary Trust Will** | `testamentary-trust-will` | **Template missing** | No `testamentary-trust-will.docx` in `templates/` |
| **Trust summary, signing guide, flowchart, etc.** | Ancillary toggles in UI | **No templates** | `trust_summary`, `estate_plan_signing_guide`, `successor_trustee_checklist`, `fiduciary_role_guide`, `flowchart` toggles exist — no packages or templates |

---

## 3. Priority recommendations

Ordered for production readiness of a typical MA pour-over + incapacity + transfer package.

| Priority | Item | Why | Effort |
| --- | --- | --- | --- |
| **P0 — Blocking** | Add missing templates: `parental-guardian-appointment.docx` | Preflight fails for minor-child matters | Medium (need Cornerstone source or firm form conversion) |
| **P0 — Blocking** | Add `will.docx` / testamentary / disclaimer trust templates OR disable those plan types in UI | Outright and testamentary plans cannot generate | Medium–High |
| **P1 — High** | Wire Cornerstone POA co-agent paragraphs + `dpoa.basic_powers` branches | Co-agents are common; design sheet captures powers that silently don't render | High (template + possibly source form) |
| **P1 — High** | Connect living will + HCP to `hcp_client_advance_*` / anatomical gift flags | Design sheet healthcare section is misleading — elections don't change output | Medium |
| **P1 — High** | Wire `hcp_slots` order 2 → `healthcare.agent.second_alternate` | Template already supports third agent | Low |
| **P1 — High** | Add HIPAA `client_additional_agents` loop + psychotherapy / list-by-name branches | HIPAA design choices ignored in output | Low–Medium |
| **P1 — High** | Fix pronoun hardcoding (living will, HCP witness blocks) | Incorrect gendered language in recorded instruments | Low |
| **P2 — Medium** | Trust funding plan UI for `decisions.funding_plan` + preflight when narrative empty | Optional doc ships empty by default | Medium |
| **P2 — Medium** | Extend `AssetItem` with `owner`, `gross_value`, `net_value` | Trust funding plan inventory incomplete vs firm spreadsheet | Medium |
| **P2 — Medium** | Nominee trust: package + `selectedDocs` + `buildTemplateFields()` fields | Template exists but unreachable | Medium |
| **P2 — Medium** | Homestead: design-sheet fields for trust deed book/page; conditional elderly/disabled paragraphs | Attorneys must redline every homestead doc | Medium |
| **P2 — Medium** | Realty trust: trustee pronouns, conditional dual-notary, expose `trust_term_extension_years` in UI | Common transfer doc quality issues | Medium |
| **P2 — Medium** | `include_temp_delegation` explicit toggle (not auto-on for all minor-child matters) | Attorneys may not want delegation every time | Low |
| **P3 — Lower** | Cornerstone conversion for `joint-trust.docx` | Current joint trust is pre-Cornerstone; works but diverges from firm cv1 forms | High |
| **P3 — Lower** | Deed + trustees-certificate Cornerstone conversion | Transfer starter templates functional but not firm-standard | Medium |
| **P3 — Lower** | `will_pr_powers` → generator + pour-over clause hooks | Granular PR powers captured but unused | Medium |
| **P3 — Lower** | Fiduciary `show_phone/address/...` template wrappers | Optional contact detail display | Low–Medium |
| **P3 — Lower** | Design summary + PPM + young-adult templates | Important but not core signing set | Medium each |

---

## 4. Not yet converted

### Cornerstone source forms present (converted)

| Source | Template |
| --- | --- |
| `incapacity/cornerstone/Power of Attorney_cv1.docx` | `durable-power-of-attorney.docx` |
| `incapacity/cornerstone/Health Care Proxy_cv1.docx` | HCP + HIPAA + living will (split) |
| `estate/cornerstone/pourover-will_cv1.docx` | `pourover-will.docx` |
| `trust/cornerstone/Realty Trust.docx` | `real-estate-trust.docx` |
| `trust/cornerstone/Nominee Trust (No Real Trust).docx` | `nominee-trust.docx` |
| `transfers/cornerstone/assignment-pp_cv1.docx` | `assignment-of-personal-property.docx` |
| `transfers/cornerstone/certificate-trust_cv1.docx` | `certificate-of-trust.docx` |
| `transfers/cornerstone/funding-instructions_cv1.docx` | `funding-instructions.docx` |
| `transfers/cornerstone/trust-funding-plan_cv1.docx` | `trust-funding-plan.docx` |
| `transfers/cornerstone/homestead-trustee_cv1.docx` | `homestead-trustee.docx` |
| `estate/cornerstone/estate-plan-summary_cv1.docx` | `estate-plan-summary.docx` |
| `guardianship/cornerstone/Delegation of Powers..._cv1.docx` | `temporary-delegation-parental-powers.docx` (legacy) |
| `guardianship/parental-delegation.docx` | `temporary-delegation-parental-powers.docx` (firm OneDrive — authoritative) |

### Packages/templates still needing Cornerstone (or any) source conversion

| Item | Package | Missing artifact |
| --- | --- | --- |
| Parental appointment of guardian | `parental-guardian-appointment` | Template + Cornerstone source |
| Joint revocable trust (cv1) | `joint-trust` | Cornerstone source (current template from older `joint-trust.docx`) |
| Individual disclaimer trust | `indv-disclaimer-trust` | Template file |
| Simple / outright will | `simple-will` | `will.docx` |
| Testamentary trust will | `testamentary-trust-will` | Template |
| Personal property memorandum | `personal-property-memorandum` | Template |
| Young adult estate plan | `young-adult-estate-plan` | Template |
| Estate plan summary | `estate-plan-summary` | ~~Template~~ **Converted Jul 2026** |
| Design summaries (2 docs) | `design-summary` | Both templates |
| Deed | Transfer pipeline | Cornerstone deed source |
| Trustee's certificate (c. 184 § 35) | Transfer pipeline | Cornerstone source |
| Trust summary | UI toggle only | Package + template |
| Estate plan signing guide | UI toggle only | Package + template |
| Successor trustee checklist | UI toggle only | Package + template |
| Fiduciary role guide | UI toggle only | Package + template |
| Flowchart | UI toggle only | Package + template |
| Asset spreadsheet export | UI toggle only | Generator path |

### Legacy / superseded

| Item | Notes |
| --- | --- |
| `tools/convert_pourover_will.py` | Superseded by `convert_cornerstone_pourover_will.py` for Cornerstone work |
| `tools/convert_incapacity_docs.py` | Legacy v1.1 incapacity forms; Cornerstone cv1 replaces for MA production |
| `packages/core-estate.json` | References `will.docx`, `revocable-trust.docx`, `ancillary-execution.docx` — none exist; not used by Node package derivation |

---

## 5. Quick reference — template inventory

| Template file | Cornerstone? | Wired to draft? |
| --- | --- | --- |
| `durable-power-of-attorney.docx` | ✅ | ✅ `incapacity-documents` |
| `health-care-proxy.docx` | ✅ | ✅ |
| `hipaa-authorization.docx` | ✅ | ✅ |
| `living-will.docx` | ✅ | ✅ |
| `pourover-will.docx` | ✅ | ✅ `pourover-will` |
| `real-estate-trust.docx` | ✅ | ✅ transfer pipeline |
| `nominee-trust.docx` | ✅ | ❌ |
| `assignment-of-personal-property.docx` | ✅ | ✅ ancillary |
| `certificate-of-trust.docx` | ✅ | ✅ ancillary |
| `funding-instructions.docx` | ✅ | ✅ ancillary |
| `trust-funding-plan.docx` | ✅ | ✅ ancillary (optional) |
| `homestead-trustee.docx` | ✅ | ✅ ancillary |
| `temporary-delegation-parental-powers.docx` | ✅ firm OneDrive | ✅ (auto minor children) |
| `joint-trust.docx` | ❌ | ✅ married joint |
| `trust-individual-single.docx` | ❌ | ✅ individual |
| `deed.docx` | ❌ | ✅ transfer pipeline |
| `trustees-certificate.docx` | ❌ | ✅ transfer pipeline |
| `parental-guardian-appointment.docx` | ❌ | ❌ **missing file** |
| `estate-plan-summary.docx` | ✅ | ✅ auto-appended when ancillary toggle on |
| `design-summary-*.docx` | ❌ | ❌ **missing files** |
| `will.docx` / testamentary / disclaimer / PPM / young-adult | ❌ | ❌ **missing files** |

---

## Related docs

- Section guides: [README.md](./README.md)
- Per-document maps: `tools/aubreylaw-docgeneration/docs/*-placeholder-map.md`
- Template authoring: `tools/aubreylaw-docgeneration/docs/document-template-guide.md`
- Gap wiring tests: `tests/draft-payload-generator-gaps.test.ts`
