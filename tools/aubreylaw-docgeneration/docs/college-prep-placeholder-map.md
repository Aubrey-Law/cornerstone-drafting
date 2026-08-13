# College Preparation Plan — Placeholder Map

Covers the five college-track templates converted from
`source-forms/college-prep/`:

| Template | Package | Output |
| --- | --- | --- |
| `college-financial-poa.docx` | `college-financial-poa` | `01-durable-power-of-attorney.docx` |
| `college-health-care-proxy.docx` | `college-health-care-documents` | `02-health-care-proxy.docx` |
| `college-advance-directive.docx` | `college-advance-directive` | `03-advance-directive.docx` |
| `college-hipaa-authorization.docx` | `college-health-care-documents` | `04-hipaa-authorization.docx` |
| `college-education-poa.docx` | `college-education-poa` | `06-education-power-of-attorney.docx` |

(`05-ferpa-release.docx` comes from the pre-existing `ferpa-release` package.)

The student is the client, so the source forms' student identity markers map
to the ordinary `client.*` fields. All `college.*` fields flow from
`design_sheets.decisions.college_prep` through `buildCollegePrep()` →
`toEstateGeneratorData()`; deferred answers ("discuss at the meeting")
normalize to empty and the drafting blockers stop generation until the
attorney resolves them.

## Source marker → canonical field

| Source marker / fixed text | Canonical replacement |
| --- | --- |
| Student name / `[CLIENT]` | `{{ client.full_name \| name }}` |
| City, county | `{{ client.city }}`, `{{ client.county }}` |
| DOB (HIPAA) | `{{ client.date_of_birth }}` |
| Financial/education agent names | `fiduciaries.agent.primary/successor/co_primary.full_name` |
| `fiduciaries.agent.serve_jointly` (non-canonical) | `has_co_poa` + `co_poa_joint` / `co_poa_majority` flags |
| Health care agent blocks | `healthcare.agent.primary/alternate` `.full_name/.relationship/.address/.phone` |
| `healthcare.agent.alternateprimary.*` (broken) | `healthcare.agent.alternate.*` |
| Hardcoded `Relationship: Parent` | `{{ healthcare.agent.*.relationship }}` |
| `[ do / do not ]` organ bracket | `college_organ_donation_any/specific/none` branch |
| Blank `___ day of ___` execution dates | `{{ execution.display_ordinal_doc_date }}` |
| Notary blocks | `execution.display_doc_date` / `display_signing_county` / `display_notary_commission` (context builder supplies fill-in lines when unscheduled) |

## Conditional logic

| Flag / field | Template | Behavior |
| --- | --- | --- |
| `college_dpoa_springing` | financial POA, education POA | Springing (physician-determination) effectiveness article; else effective immediately. |
| `college_dpoa_all_powers` | financial POA | Full general grant with every enumerated power (including Acquire and Sell, Management, Governmental Entitlements); else a limited grant of only the enumerated powers. |
| `college_power_<key>` (16) | financial POA | One flag per questionnaire power; each power paragraph renders only when granted. `retain_attorney`/`citations` also pull in the Legal Proceedings paragraph. |
| `has_college_dpoa_withheld` | financial POA | EXCLUDED POWERS article printing `college.dpoa_withheld`. |
| `has_co_poa`, `co_poa_joint`/`co_poa_majority` | education POA | Co-agent appointment (jointly vs independently); else primary + successor in order named. |
| `has_college_hcp_limits` | health care proxy | Limitations paragraph printing `college.hcp_limits`. |
| `has_college_hcp_instructions` | health care proxy | Guidance paragraph printing `college.hcp_instructions`. |
| `college_hipaa_all_except` | proxy + HIPAA | Withheld-categories carve-out in the proxy's HIPAA-access power and a Withheld Categories article in the authorization, iterating `college.hipaa_excluded_categories`. |
| `has_college_hipaa_recipients` | HIPAA | Named recipients from `college.hipaa_recipients` (name, relationship, phone); falls back to the health care agents. |
| `has_college_excluded_people` | HIPAA | Persons Not Authorized article printing `college.excluded_people`. |
| `college_hipaa_expires_on_date` | HIPAA | Termination on `college.hipaa_expiration_date`; else death-or-revocation only. |
| package selection | advance directive | Generated only when `college_prep.living_will_include === 'yes'`. |
| `college_life_support_all_measures/_comfort_only/_trust_agent` | advance directive | The operative instruction: prolong by all measures / comfort-only (source text) / defer to the agent. |
| `college.cpr` / `college.artificial_nutrition` / `college.ventilation` | advance directive | Per-treatment sentence (`yes` / `no` / `agent_decides`); omitted when unanswered. |
| `college_organ_donation_any/_specific/_none` | advance directive | Anatomical-gift election; `specific` prints `college.organ_donation_notes`; unanswered defers to the agent (source language). |

## Deliberate departures from the source forms

- **Embedded FERPA release removed** from the health-care source: the wired
  `ferpa-release` package renders it from the student's actual FERPA answers;
  keeping both would issue two conflicting releases.
- **Financial POA appointment language** now uses the successor model
  consistently (the source mixed "in the order named" with co-agent
  language).
- **Education POA** keeps a single acknowledgment notary block (the source
  carried a duplicate combined jurat).
- **Source typos fixed** during conversion (`ExeCuTION`, `transfergift`,
  hyphenation debris).
- The comfort-care paragraph in the advance directive is retained
  unconditionally; `college.comfort_always` is carried in the merge data for
  future use but does not currently gate it.
- `college_prep.dpoa_notes`, `other_medical_notes`, `family_circumstances`,
  and `concerns` are attorney-facing context and are not printed in any
  instrument.

## Attorney review required

The springing-effectiveness article, the seven student-specific power
paragraphs (tuition, financial aid, student loans, credit cards, housing,
insurance, employment), the limited-grant intro, the advance directive's
all-measures and trust-agent instructions and per-treatment sentences, and
the HIPAA withheld-categories / dated-termination language are new drafting
introduced in this conversion and have not been attorney-approved. Review
before production use.
