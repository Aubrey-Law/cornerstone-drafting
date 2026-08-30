# Guided Intake — Question-by-Question Spec (for Lawmatics replication)

This document is a complete transcription of the Guided Interview served at `/intake`,
written so the same questionnaire can be rebuilt as a Lawmatics intake form without
reading the code.

**Source of truth in this repo**

| Piece | File |
| --- | --- |
| Section list, completion + validation rules (estate) | `lib/intakeSections.ts` |
| Section list, completion + validation rules (college prep) | `lib/collegePrepSections.ts` |
| Shell, progress, autosave, review/submit | `components/intake/GuidedInterview.tsx` |
| Estate step bodies | `components/intake/IntakeWizard.tsx`, `IntakePersonalStep.tsx`, `IntakeFamilySteps.tsx`, `IntakeChildrenStep.tsx`, `IntakeReferralStep.tsx` |
| College-prep step bodies | `components/intake/collegePrep/CollegePrepSteps.tsx` |
| Canonical option lists | `packages/estate-fields/src/core/options.ts`, `assets.ts`, `goals.ts`, `referral.ts`, `citizenship.ts` |
| College-prep option lists | `lib/collegePrepFields.ts` |
| Track selection | `lib/intakeTrack.ts` |

---

## 1. How the interview behaves

* **Two tracks.** `intake_track` on the intake row selects the question set:
  `estate` (default) or `college_prep`. A client only ever sees one of them.
  In Lawmatics these are **two separate forms** — there is no shared page.
* **Accordion, not a wizard.** Every section renders as a collapsible card in one
  long page. The first incomplete section opens on load. "Continue" closes the
  current card and opens the next.
* **Autosave.** Every keystroke debounces to a save 1.5s later; contacts (spouse,
  children, fiduciaries) are persisted when the client leaves a section.
* **Progress.** A right-hand rail lists every active section with a check mark, a
  percent ring, and a "~N min left" estimate summed from the per-section time
  estimates listed below. Optional sections are excluded from the percent.
* **Review & submit.** A "Review questionnaire →" button opens a read-only summary
  modal. Submitting sets `status = 'submitted'`, which locks the form and shows a
  thank-you screen; the client can request an unlock by email.
* **Two severities of validation.**
  * **error** — blocks submission, shown in an amber list under the section.
  * **warning** — surfaces the same way but does **not** block submission. Most
    fiduciary/naming questions are warnings, because "I don't know yet, let's
    discuss it" is a valid answer.
* **"Discuss with attorney" escape hatch.** The fiduciary sections carry a
  two-button control (`Discuss with attorney` / `Not provided yet`) that marks
  blanks as intentional and clears that section's warnings.

### Intro copy

*Estate track:*
> **Welcome, {FirstName}**
> Answer what you can before our meeting — rough answers are fine, and everything is
> strictly confidential. Your progress saves automatically.

*College-prep track:*
> **College Preparation Plan**
> Every document here is voluntary. The student chooses who receives authority, how
> much, and for how long — and can revoke any of it at any time. Leave blank anything
> you would rather discuss at the meeting; your progress saves automatically.

---

## 2. Track A — Estate Planning

Sections in order. "Shown when" blank means always shown.

| # | Section | Subtitle | Est. | Optional | Shown when |
| --- | --- | --- | --- | --- | --- |
| 1 | Getting Started | How did you find us? | 1 min | yes | — |
| 2 | Personal Information | Name, contact & address | 5 min | no | — |
| 3 | Family | Marital status & dependents | 2 min | no | — |
| 4 | Spouse Information | Spouse's details | 3 min | no | `marital_status = married` |
| 5 | Children | Children's information | 3 min | no | `has_children = true` |
| 6 | Financial | Assets & financial overview | 5 min | no | — |
| 7 | Goals & Wishes | Priorities & special wishes | 4 min | no | — |
| 8 | Additional Contacts | Other people you may name as fiduciaries (optional) | 3 min | yes | — |
| 9 | Your Fiduciaries | Trustees, agents & proxies | 7 min | no | — |
| 10 | Spouse's Fiduciaries | Spouse's trustees & agents | 5 min | no | `marital_status = married` |
| 11 | Guardian for Minors | Care for minor children | 2 min | no | `has_minor_children = true` |
| 12 | Review & Submit | Confirm & submit | 2 min | no | — |

---

### 2.1 Getting Started (`referral`) — optional

| Label | Field | Type | Options / notes |
| --- | --- | --- | --- |
| How did you hear about us? | `referral_source` | Single-select pills | `Referral`, `Legal Insurance`, `Other` |
| Legal Insurance Plan | `legal_insurance_plan` | Single-select pills | `MetLife`, `ARAG`, `LegalEase` — shown only when source = Legal Insurance |
| Member ID / Case Number | `legal_insurance_member_id` | Text | placeholder "Enter your member ID or case number"; same condition |
| Who referred you? We'd love to thank them! | `referral_name` | Text | placeholder "Name of the person who referred you"; shown only when source = Referral |

Switching the source clears the other branch's answers. No validation; the section
counts complete once a source is chosen.

---

### 2.2 Personal Information (`personal`)

| Label | Field | Type | Options / notes |
| --- | --- | --- | --- |
| First Name | `first_name` | Text | **required** |
| Middle Name | `middle_name` | Text | |
| Last Name | `last_name` | Text | **required** |
| Suffix | `suffix` | Select | `Jr.`, `Sr.`, `II`, `III`, `IV`, `Esq.` |
| Prior Name (maiden/former) | `prior_name` | Text | |
| Preferred Name | `preferred_name` | Text | |
| Date of Birth | `date_of_birth` | Date | **required** |
| Pronouns | `preferred_pronoun` | Select | `He/Him`, `She/Her`, `They/Them`, `Ze/Zir`, `Other` |
| Citizenship / immigration status | `citizenship_status` | Select | `Unknown / not confirmed` (default), `US Citizen`, `Permanent Resident`, `Non-Resident Alien`, `Non-US — status unconfirmed`, `Other` |

**Contact Information**

| Label | Field | Type | Notes |
| --- | --- | --- | --- |
| Email | `email` | Email | **required**, format-validated |
| Phone | `phone` | Phone (auto-formats) | **required** |

**Address** — an address autocomplete that fills the fields below ("Search to
auto-fill, or enter manually below.")

| Label | Field | Type | Notes |
| --- | --- | --- | --- |
| Street address | `street_address` | Text | **required** |
| City | `city` | Text | **required** |
| State | `state` | Text | **required**, defaults `MA` |
| ZIP | `zip` | Text | **required** |
| County | `county` | Select | **required**; Massachusetts counties only: Barnstable, Berkshire, Bristol, Dukes, Essex, Franklin, Hampden, Hampshire, Middlesex, Nantucket, Norfolk, Plymouth, Suffolk, Worcester |

---

### 2.3 Family (`family`)

| Label | Field | Type | Options / notes |
| --- | --- | --- | --- |
| Marital Status | `marital_status` | Single-select pills | **required** — `Single`, `Married`, `Divorced`, `Widowed`, `Separated`, `Domestic partner`, `Civil union`, `Unmarried partnership` |
| Do you have children? | `has_children` | Yes / No pills | **required** |
| Do you have children under 18? | `has_minor_children` | Yes / No pills | **required** when `has_children = Yes`; shown only then. Answering "No" to children forces this to No. |

Info box shown under the questions:
> The information you share here helps us understand your family situation so we can
> prepare the right documents. If you are married, we'll ask about your spouse next.
> If you have children, we'll collect their details in a following step.

---

### 2.4 Spouse Information (`spouse`) — only when married

Same shape as Personal, stored on the spouse contact.

| Label | Field | Type | Notes |
| --- | --- | --- | --- |
| First Name | `spouse.first_name` | Text | **required** |
| Middle Name | `spouse.middle_name` | Text | |
| Last Name | `spouse.last_name` | Text | **required** |
| Suffix | `spouse.suffix` | Select | suffix list |
| Prior Name (maiden/former) | `spouse.prior_name` | Text | |
| Preferred Name | `spouse.preferred_name` | Text | |
| Date of Marriage | `date_of_marriage` | Date | on the client record, not the spouse |
| Date of Birth | `spouse.date_of_birth` | Date | warning if blank ("…if you have it, or leave this blank to discuss later.") |
| Pronouns | `spouse.preferred_pronoun` | Select | pronoun list |
| Citizenship / immigration status | `spouse.citizenship_status` | Select | citizenship list |
| Email | `spouse.email` | Email | |
| Phone | `spouse.phone` | Phone | |

---

### 2.5 Children (`children`) — only when `has_children = true`

A **repeating block**, "Child 1…N", with an "Add child" button and a delete icon per row.
At least one child is required for the section to pass.

| Label | Field | Type | Notes |
| --- | --- | --- | --- |
| First Name | `first_name` | Text | **required** (first + last together) |
| Middle Name | `middle_name` | Text | |
| Last Name | `last_name` | Text | **required** |
| Suffix | `suffix` | Select | suffix list |
| Date of Birth | `date_of_birth` | Date | **required** when `has_minor_children = Yes`; warning otherwise |
| Relationship | `relationship` | Select | `Biological` (default), `Adopted`, `Stepchild` |
| Pronouns | `pronouns` | Select | pronoun list |
| Email | `email` | Email | |
| Phone | `phone` | Phone | |
| Same address as client | `same_address` | Toggle | |
| Parent | `parent` | Pills | `Both` (default), `{Client first name}`, `{Spouse first name}` (spouse option only when married and named) |

---

### 2.6 Financial (`estate`)

| Label | Field | Type | Options / notes |
| --- | --- | --- | --- |
| Estimated Total Estate Value | `estate_value` | Select | **required** — `Under $500,000`, `$500,000 to $2 million`, `$2 million to $4 million`, `$4 million to $6 million`, `Over $6 million` |
| What types of assets do you own? | `asset_types[]` | Checkbox grid | **required — at least one.** Helper: "Check everything that applies. Tap 'Add details' only if you want to share more now — it is optional." |

Asset checkboxes (in order): Real Estate, Bank Accounts, Investment Accounts
(Non-Retirement), Retirement Accounts, Life Insurance, Business Interests, Custodial
Accounts, Cryptocurrency, Personal Property, Other Assets, Liabilities / Money You Owe.

Each checked asset exposes an **"Add details"** modal. Every modal is optional and is
headed: *"These details are optional. Rough estimates are fine, and you can skip for now
and add more at your appointment."*

**Real Estate** — repeating "Property N": Type (`Residential`, `Commercial`, `Rental`,
`Vacation Home`, `Land`, `Other`), Owner (`Client`, `Spouse`, `Joint`), Address,
Estimated Value, Mortgage Balance, Notes.

**Business Interests** — repeating "Business N": Name of Business, Type (`Sole
Proprietorship`, `LLC`, `Partnership`, `Corporation`, `Other`), Owner (`Client`,
`Spouse`, `Joint`), Size of Interest (%), Estimated Value.

**Liabilities** — repeating "Liability N": Description, Amount Owed, Owner (`Client`,
`Spouse`, `Joint`).

**Bank Accounts, Investment Accounts, Retirement Accounts, Life Insurance, Custodial
Accounts, Cryptocurrency** — three dollar totals each: `{Client} Total`, `{Spouse}
Total`, `Joint Total`, prompted "Enter approximate totals for all … combined."

**Personal Property, Other Assets** — one free-text box: "Describe your … — include
approximate values if known."

**Special Circumstances** — six toggles; turning one on reveals a free-text box
("Please provide additional information…"):

| Toggle | Field |
| --- | --- |
| I own real estate outside Massachusetts | `owns_real_estate_outside_ma` |
| I own or co-own a business | `has_business_interest` |
| I have a dependent with special needs | `has_special_needs_dependent` |
| I have children from a prior relationship | `has_prior_marriage` |
| I expect to receive a significant inheritance | `expects_inheritance` |
| I want to include charitable giving in my plan | `has_charitable_intent` |

---

### 2.7 Goals & Wishes (`goals`)

Three optional free-text questions, each with a "Why we ask" expander:

| Label | Field | Placeholder | "Why we ask" |
| --- | --- | --- | --- |
| Why did you choose Aubrey Law? | `planning_objectives.why_choose_firm` | "A referral, online search, prior experience…" | This helps us understand what mattered to you when choosing counsel and tailor your first conversation. |
| Why are you planning now? | `planning_objectives.why_now` | "A life event, peace of mind, a nudge from family…" | Your timing and motivation help your attorney focus the plan on what is driving you right now. |
| Is making things easy for loved ones important to you? | `planning_objectives.make_things_easy` | "Most clients say yes — share anything specific you have in mind." | Many clients want to spare family from confusion, conflict, or extra court steps. Your answer shapes how we structure the plan. |

`why_now` blank raises a **warning** ("Briefly explain why you are moving forward with
estate planning now.").

**What are your estate planning goals?** — `planning_goals[]`, multi-select cards,
**at least one required**:

| Goal | Value | Description shown |
| --- | --- | --- |
| Avoid probate | `avoid_probate` | Keep estate settlement private and faster |
| Protect my spouse | `protect_spouse` | Ensure my spouse is provided for |
| Protect my children | `protect_children` | Provide for children and protect their inheritance |
| Minimize estate taxes | `minimize_taxes` | Reduce tax burden on the estate |
| Charitable giving | `charitable_giving` | Include donations to causes I care about |
| Plan for incapacity | `incapacity_planning` | Ensure someone can act on my behalf if needed |
| Business succession | `business_succession` | Plan for business continuity |
| Medicaid planning | `medicaid_planning` | Protect assets for long-term care |

**Additional Planning Information** — four Yes/No toggles; three of them reveal a
document upload when Yes:

| Label | Field | Upload on Yes |
| --- | --- | --- |
| Do you have a will, trust, or other estate planning document? | `has_existing_plan` | will, trust, or other estate planning documents |
| Are you making payments pursuant to a divorce or property settlement order? | `has_divorce_settlement` | divorce or property settlement order |
| Do you own a long-term care (nursing home) insurance policy? | `has_ltc_insurance` | — |
| Have you ever filed federal or state gift tax returns? | `has_prior_gift_tax` | federal or state gift tax returns |

| Label | Field | Type |
| --- | --- | --- |
| Anything else you'd like us to know? | `special_notes` | Long text — "Any specific concerns, questions, or wishes you'd like to share..." |

---

### 2.8 Additional Contacts (`additional_contacts`) — optional

Info box:
> Add siblings, trusted friends, or professionals you might name under **Fiduciaries**
> (trustee, power of attorney, health care proxy, guardian, etc.). This step is
> optional — you only need people you already want the firm to have on file.

Repeating "Additional contact N" with "Add contact":
First name, Middle name, Last name, Suffix, Relationship to you ("e.g. Sister, Cousin,
Financial advisor"), Email, Phone, Pronouns, Street / City / State / ZIP.

People entered here become selectable in every fiduciary picker downstream.

---

### 2.9 Your Fiduciaries (`fiduciaries`)

Intro:
> Name the people who would step in to manage your trust, settle your estate, and make
> decisions if you cannot. Many clients choose a spouse, adult child, or trusted sibling
> — you can leave any role blank and discuss options with Aubrey Law.

Expander "Learn more about these roles" explains Successor Trustee vs. Personal
Representative and which role does the heavy lifting in a trust-based vs. will-based plan.

Info box: *If you are unsure who should serve in any role, you can leave it blank and
discuss options with Aubrey Law.*

Escape hatch (`_review_choices.fiduciaries`): "If you are leaving any fiduciary roles
blank, choose the reason so your attorney knows it is intentional." → `Discuss with
attorney` / `Not provided yet`.

Four roles, each a repeating person picker (Primary, then Alternate 1…4; up to five
principals; each principal except HCP may also carry one **Co-Agent**):

| Role | Field | Description shown | Example shown | Co-agent |
| --- | --- | --- | --- | --- |
| Your Successor Trustee | `fid_trustee_client` | Manages trust assets — property titled in the name of your trust during your lifetime or made payable to the trust at death. You will be the initial trustee of your trust. | An adult child or trusted sibling who is organized and comfortable managing finances. | yes |
| Your Personal Representative (Executor) | `fid_personal_rep_client` | Settles your probate estate — property titled solely in your name without a designated beneficiary or survivorship rights. | A family member who can handle paperwork, court filings, and communicating with heirs. | yes |
| Your Financial Power of Attorney | `fid_poa_client` | Manages your finances and legal matters if you become incapacitated. | Your spouse or adult child who would pay bills and manage accounts if you were hospitalized. | yes |
| Your Health Care Proxy | `fid_hcp_client` | Makes medical decisions on your behalf if you cannot. | Someone who knows your wishes and would speak with doctors on your behalf. | **no** |

Each named person captures: First / Middle / Last / Suffix, Relationship, Pronouns,
Phone, Email, Street / City / State / ZIP. The picker also searches people already
entered elsewhere in the intake (client, spouse, children, additional contacts, other
fiduciaries) so they can be reused without retyping.

All four "name someone" prompts are **warnings**, not errors — e.g. *"Name a Trustee if
you know who you want, or leave this blank to discuss later."*

---

### 2.10 Spouse's Fiduciaries (`spouse_fiduciaries`) — only when married

Info box:
> These are the people {Spouse} would like to serve as their fiduciaries. They may be
> the same as yours or different. If you are unsure, leave any role blank and discuss it
> with Aubrey Law.

Escape hatch key `spouse_fiduciaries`. Three roles, same person fields:

| Role | Field | Description | Co-agent |
| --- | --- | --- | --- |
| {Spouse}'s Personal Representative | `fid_personal_rep_spouse` | Manages {Spouse}'s probate estate. | yes |
| {Spouse}'s Financial Power of Attorney | `fid_poa_spouse` | Manages {Spouse}'s finances and legal matters if they become incapacitated. | yes |
| {Spouse}'s Health Care Proxy | `fid_hcp_spouse` | Makes medical decisions on {Spouse}'s behalf. | **no** |

The spouse is excluded from their own picker; the client is offered.

---

### 2.11 Guardian for Minors (`guardian`) — only when `has_minor_children = true`

Info box: *If you know who you would want to serve as guardian for your minor children,
add them here. If you are unsure, you can leave this blank and discuss it with Aubrey Law.*

Escape hatch key `guardian`.

| Role | Field | Description | Example |
| --- | --- | --- | --- |
| Your Guardian for Minor Children | `fid_guardian_client` | If you have children under 18, this person will raise them and be responsible for their care, custody, and control until they reach adulthood. | A relative or close friend who shares your values and would raise your children if both parents could not. |

Naming a guardian is an **error** (blocks submit) when there are minor children, unless
the escape hatch is used; a warning otherwise.

**Excluded Persons**

| Label | Field | Type |
| --- | --- | --- |
| Is there anyone you specifically do NOT want as guardian? | (toggle) | Yes / No |
| Person(s) to exclude as guardian | `fid_excluded_guardian` | Person picker, shown on Yes — "Add anyone you specifically do not want to serve as guardian of your minor children." |

Parents are only offered as guardian candidates when at least one child belongs to only
one of the two parents.

---

### 2.12 Review & Submit (`review`)

Read-only summary of every answer, grouped by section, with an "Edit" link back to each.
Submitting locks the questionnaire.

---

## 3. Track B — College Preparation Plan

For a student turning 18: durable power of attorney, health care proxy, HIPAA
authorization, FERPA release, and living will. The **student is the client** — every
identity field is the student's, and the parents are contacts.

| # | Section | Subtitle | Est. | Optional |
| --- | --- | --- | --- | --- |
| 1 | Student Information | The student is the client — every document is signed by them | 3 min | no |
| 2 | School Information | Where the student is headed, and school records access | 2 min | no |
| 3 | Parents & Guardians | Who may be named, and anything we should know | 2 min | no |
| 4 | Agent Designations | Financial agent, health care agent, and who may receive information | 4 min | no |
| 5 | Power of Attorney — Scope | When it takes effect and what it covers | 2 min | no |
| 6 | Health Care Proxy | Limits and personal instructions (optional) | 1 min | yes |
| 7 | HIPAA Authorization | What may be shared, and for how long | 2 min | no |
| 8 | Living Will | Written instructions about care | 2 min | no |
| 9 | Other Matters | Anything else we should know (optional) | 1 min | yes |
| 10 | Review & Submit | Confirm & submit | 1 min | no |

### 3.1 Student Information (`cp_student`)

First name (as it appears on government ID) **req**, Middle name, Last name **req**,
Suffix, Preferred name, Pronouns, Date of birth **req**, "U.S. citizen" toggle,
Cell phone **req**, Email **req**, and the permanent legal address (street **req**,
city **req**, state **req**, ZIP **req**, MA county **req**).

If the DOB shows the student is under 18, a **warning**: *"The student is under 18. These
documents can only be signed on or after their eighteenth birthday — we will schedule
around it."*

### 3.2 School Information (`cp_school`)

| Label | Field | Type | Notes |
| --- | --- | --- | --- |
| College / university / program | `college_school_name` | Text | **required** |
| Move-in / orientation date | `college_move_in_date` | Date | warning if blank |
| Campus city | `college_school_city` | Text | warning if city or state blank |
| Campus state | `college_school_state` | Text | default placeholder `MA` |
| The student will study or travel abroad during the program | `college_studying_abroad` | Toggle | |
| Country / countries | `college_abroad_country` | Text | shown when abroad = Yes |

**School records (FERPA)** primer: *HIPAA covers medical information. Education records —
grades, the bursar's office, financial aid, housing, and disciplinary files — are covered
by a different law, FERPA, and a health care proxy does nothing for them… Colleges each
publish their own FERPA form. We can prepare a general authorization and tell you which of
the school's own forms to file alongside it.*

| Label | Field | Type | Notes |
| --- | --- | --- | --- |
| Include a FERPA release for education records | `college_ferpa_release` | Toggle | **must be answered** |
| Which records should the release cover? | `college_ferpa_records[]` | Checkboxes | **required when release = Yes** — Grades and transcripts, Bursar / tuition account, Financial aid records, Housing and residence life, Student conduct and disciplinary records, Campus health / counseling center |
| Who should be able to receive education records? | `college_ferpa_recipients` | Text area | hint: "Usually the same parents named elsewhere, but the student may choose differently." |

### 3.3 Parents & Guardians (`cp_parents`)

Repeating "Add parent or guardian" — **at least one required**: First / Middle / Last /
Suffix, Relationship to the student ("e.g. Mother, Father, Guardian, Aunt"), Cell phone,
Email, Pronouns, address. A parent with neither phone nor email raises a warning
("an agent we cannot reach is not much use in an emergency").

Plus: **Family circumstances we should know about** → `college_family_circumstances`
(long text).

### 3.4 Agent Designations (`cp_agents`)

Three primers, then two person pickers and one repeating list.

*Durable power of attorney primer:* at 18 the student gains independence in signing
contracts, taking loans and credit cards, and in being sued; "durable" means the
authority survives incapacity.

*Health care proxy primer:* once the student turns 18 parents can no longer access
medical records or make most medical decisions; **Massachusetts permits only one health
care agent at a time — name a single agent and one alternate, not co-agents.**

*HIPAA primer:* a HIPAA authorization grants no decision-making power at all — it simply
permits a provider to talk, so it usually goes to more people than hold the proxy.

| Item | Field | Notes |
| --- | --- | --- |
| Escape hatch | `_review_choices.cp_agents` | "If you would rather choose the agents at the meeting, mark that here so your attorney knows the blanks are intentional." |
| Financial and legal agent | `fid_poa_client` | Primary + alternates, co-agents allowed. Warning if unnamed. |
| Health care agent | `fid_hcp_client` | Primary + one alternate, **no co-agents**. Warning if unnamed. |
| People who may receive medical information | `college_hipaa_recipients[]` | Repeating: Name, Relationship ("e.g. Mother, Grandfather, Sister"), Phone, Email. Warning if empty. |
| Anyone who should specifically NOT receive access | `college_excluded_people` | Long text |

### 3.5 Power of Attorney — Scope (`cp_dpoa`)

| Label | Field | Type | Options |
| --- | --- | --- | --- |
| When does the power of attorney take effect? | `college_dpoa_effective` | Choice cards | **required** — `Immediately upon signing` (Recommended — institutions act without demanding proof of incapacity), `Only upon a documented determination of incapacity` ("Springing" — the agent must produce a physician's determination first), `Discuss at the meeting` |
| Powers to grant | `college_dpoa_powers[]` | Checkboxes | shown unless "Discuss at the meeting"; warning if none selected |
| Powers to expressly withhold or limit | `college_dpoa_withheld` | Long text | hint: "For example: no authority over a brokerage account, or no authority to sign a lease without speaking to the student first." |
| Notes or concerns about financial authority | `college_dpoa_notes` | Long text | |

Powers list, in order: Banking and bank accounts; Paying bills and routine expenses;
Tuition, bursar, and student accounts; Financial aid office and scholarships; Student
loans and loan servicers; Credit cards and consumer debt; Tax filings and communication
with the IRS / DOR; Leases, housing, and security deposits; Auto — registration,
insurance, repairs; Insurance claims of any kind; Retaining and instructing an attorney;
Responding to citations, summonses, or conduct charges; Investment and brokerage
accounts; Digital accounts and online access; Employment paperwork and payroll; Signing
contracts on the student's behalf.

Expander "Why we usually recommend 'immediately'": a springing power only works once
someone produces a physician's written determination; banks and bursars are cautious, and
collecting it takes days you may not have.

### 3.6 Health Care Proxy (`cp_healthcare`) — optional

Intro: *By default the health care agent may make any health care decision the student
could make. Both questions below are optional — leave them blank if nothing comes to mind.*

| Label | Field | Hint |
| --- | --- | --- |
| Limits on the agent's authority | `college_hcp_limits` | Anything the agent should not be able to decide alone. |
| Religious, cultural, or personal instructions | `college_hcp_instructions` | Dietary requirements, observances, a preference about who is in the room, a clinician the student would want called. |

### 3.7 HIPAA Authorization (`cp_hipaa`)

| Label | Field | Type | Options |
| --- | --- | --- | --- |
| What health information may be released? | `college_hipaa_scope` | Choice cards | **required** — `All health information, without limitation`; `All health information EXCEPT the categories below`; `Discuss at the meeting` |
| Categories to withhold | `college_hipaa_excluded_categories[]` | Checkboxes | **required** when scope = "all except" — Mental health / psychotherapy notes; Substance use treatment; HIV / AIDS status and testing; Reproductive and sexual health; Genetic testing and results |
| Different scope for different people? | `college_hipaa_different_scope` | Long text | "For example: full access to one parent, emergency-only information to another." |
| When should the authorization expire? | `college_hipaa_expiration` | Choice cards | **required (cannot be deferred — HIPAA requires the document to state it)** — `No expiration — until the student revokes it`; `Expires on a specific date` |
| Expiration date | `college_hipaa_expiration_date` | Date | **required** when "Expires on a specific date" |

### 3.8 Living Will (`cp_living_will`)

Primer: a living will is a written statement of the care the student would and would not
want; Massachusetts does not give it the same statutory force as a health care proxy, but
doctors and agents read them — its real value is that it takes the weight off the agent.

| Label | Field | Options |
| --- | --- | --- |
| Should the package include a living will? | `college_living_will_include` | **required** — `Yes — include written treatment instructions`; `No — leave every decision to the health care agent`; `Discuss at the meeting` |

Everything below shows only when the answer is Yes:

| Label | Field | Options |
| --- | --- | --- |
| If there is no reasonable hope of recovery, what should happen? | `college_life_support` | **required** — `Use all available measures to prolong life`; `Comfort care only if there is no reasonable hope of recovery`; `Leave it to my health care agent`; `Discuss at the meeting` |
| Attempted resuscitation (CPR) | `college_cpr` | `Yes, I would want it` / `No, I would not want it` / `My agent decides` / `Discuss at the meeting` |
| Artificial nutrition and hydration (feeding tube) | `college_artificial_nutrition` | same four |
| Mechanical ventilation (breathing machine) | `college_ventilation` | same four |
| Provide pain relief and comfort care at all times, even if it may hasten death | `college_comfort_always` | Toggle, **default On** |
| Would the student want to donate organs or tissue? | `college_organ_donation` | warning if blank — `Yes — any needed organs or tissue`; `Yes — only the organs or purposes I name below`; `No`; `Discuss at the meeting` |
| Which organs, tissue, or purposes? | `college_organ_donation_notes` | shown when "only the organs I name" |
| Anything else the family and doctors should know | `college_other_medical_notes` | Long text |

### 3.9 Other Matters (`cp_other`) — optional

| Label | Field |
| --- | --- |
| Anything worrying you that we have not asked about | `college_concerns` |

---

## 4. Notes for building this in Lawmatics

1. **Build two forms.** `Estate Planning Intake` and `College Preparation Plan Intake`.
   Do not try to branch one form on a track field — the two question sets share only
   name, contact, and address.
2. **Pages ≈ sections.** Lawmatics multi-page forms give the closest analogue to the
   accordion, with one page per section in the order above. Lawmatics shows a progress
   bar automatically; the "~N min" estimates can go in the page subtitles.
3. **Conditional logic** maps one-to-one onto Lawmatics field/page conditions:
   * Spouse page ← `marital_status = Married`
   * Children page ← `has_children = Yes`
   * Guardian page ← `has_minor_children = Yes`
   * Referral sub-fields ← `referral_source`
   * Asset detail groups ← the matching `asset_types` checkbox
   * Special-circumstance detail boxes ← the matching toggle
   * FERPA records ← FERPA toggle; HIPAA categories ← "all except"; HIPAA date ←
     "expires on a date"; living-will detail ← "Yes"; DPOA powers ← not "discuss"
4. **Repeating blocks** (children, additional contacts, real estate, businesses,
   liabilities, fiduciary alternates, HIPAA recipients) are the one part Lawmatics does
   not model natively. Options, roughly in order of fidelity:
   * Lawmatics **repeatable field groups** where available on your plan;
   * otherwise, fixed slots — e.g. Child 1–4, Alternate 1–2 per role — each slot's
     fields revealed by an "Add another?" conditional;
   * for the optional asset detail modals, a single long-text box per asset category is
     an acceptable v1: those details are explicitly optional in this form.
5. **Required vs. optional.** Mark only the **error**-severity items required in
   Lawmatics. Everything described above as a *warning* must stay optional — the whole
   design assumes a client can submit with fiduciaries unnamed and settle them at the
   meeting. Reproduce the "Discuss with attorney / Not provided yet" control as a
   two-option radio on each fiduciary page so the attorney can tell a deliberate blank
   from an oversight.
6. **Validated formats:** email (format check), phone (auto-formatted), MA county
   (restricted to the 14 counties), all selects restricted to the values listed.
7. **Field mapping.** Map `first_name`, `last_name`, `email`, `phone`,
   `date_of_birth`, and the address to Lawmatics' **standard contact fields**; the spouse,
   children, and each fiduciary to **related contacts** with a relationship label; and
   everything else to **custom fields on the matter**, keeping the field keys in the
   tables above as the custom-field API names so data can be moved between the two
   systems without a translation layer.
8. **Uploads.** Four questions attach documents (existing plan, divorce/settlement order,
   gift tax returns). Lawmatics file-upload fields, conditional on the same Yes toggle.
9. **Copy matters.** The primers, examples, and "why we ask" expanders are doing real
   work — they are the reason clients answer the fiduciary questions at all. Carry them
   over as Lawmatics description/help text rather than dropping them.
