# Design Sheet — Questions and Choices

Every question the attorney answers on the design sheet (`/admin/drafting/<matterId>` → Design),
in the order the sheet's navigation shows them, with the choices each one offers.
Where the stored value differs meaningfully from the label it appears in backticks, e.g.
"Joint majority (`joint_majority`)".

Compiled from the section components in `app/admin/drafting/[matterId]/design/sections/`
and the option lists they read from `lib/`. It is a snapshot, not generated — when a
section's controls change, update this file too. For how each field feeds the document
generator, see [design-sheet-sections/](./design-sheet-sections/README.md); for the
meeting-order checklist, see [design-meeting/checklist.md](./design-meeting/checklist.md).

**Which sections appear.** The full estate layout shows the sections below in order.
A document section (Trust, Trust provisions, Asset Schedules, Last Will and Testament,
Will Details, Financial Power of Attorney, Health Care & Directives, Transfers &
Assignments) appears only when that document is included under Estate Plan Design.
The short *Essential* layout and the *College Preparation Plan* track are listed
near the end. Signing & Execution is on the Review step, not in the Design step.

## Contents

1. [Field conventions](#field-conventions-sharedtsx)
2. [Client Information](#client-information)
3. [Fiduciary Role Assignment](#fiduciary-role-assignment)
4. [Estate Plan Design](#estate-plan-design)
5. [Trust](#trust)
6. [Trust provisions](#trust-provisions)
7. [Asset Schedules](#asset-schedules)
8. [Last Will and Testament](#last-will-and-testament)
9. [Will Details](#will-details)
10. [Financial Power of Attorney](#financial-power-of-attorney)
11. [Health Care & Directives](#health-care--directives)
12. [Transfers & Assignments](#transfers--assignments)
13. [Attorney Notes](#attorney-notes)
14. [Signing & Execution](#signing--execution)
15. [Estate Plan Design (Essential layout)](#estate-plan-design-essential-layout)
16. [College Preparation Plan](#college-preparation-plan)
17. [Intake Review](#intake-review)
18. [Appendix: Person / contact fields](#appendix-person--contact-fields)

## Field conventions (shared.tsx)

- **DecisionRow**: a question shown as a row of option buttons (single choice). Some are marked "Blocks drafting".
- **AttorneySelect / PrefilledSelect**: dropdown. **AttorneyInput**: free text (or date). **DesignSheetCheckboxOption**: a checkbox with a description (Yes / No; unchecked by default). Many are stored as `yes`/`no` strings.
- **Fields prefilled from intake**: these show a "Prefilled: <value>" note when the attorney has changed the value.
- **Tri-state "Not asked" convention** (Client Information): some Yes/No questions are dropdowns that start blank. The blank value shows as "Not asked" and means "not asked yet" (stored as `null`). The choices are Yes / No.

## Client Information
_College Preparation Plan sheets call this section "Student Information". The fields are the same, except the "Plan" block is hidden._

### Plan — Who this plan is drafted for
_Hidden on College Preparation Plan sheets._
- **Who is this plan for?** (blocks drafting) — choices: Individual (`individual`) / Couple (`couple`)

### Client — Primary grantor
- **Full Legal Name** — free text (prefilled from intake)
- **Also Known As (AKA)** — free text ("Other names used (used in Wills)")
- **Pronouns** — choices: He/Him / She/Her / They/Them / Ze/Zir / Other
- **Marital Status** — choices: Single / Married / Divorced / Widowed / Separated / Domestic partner / Civil union / Unmarried partnership
- **Gender** — choices: Male / Female / Nonbinary / Other
- **Date of Birth** — date (the computed age is shown under it)
- **Phone** — phone number
- **Email** — email
- **Former Spouse Name** — free text — _shown only when the marital status contains "divorced"_
- **Deceased Spouse Name** — free text — _shown only when the marital status contains "widow"_
- **Street Address** — free text
- **Street Address Line 2** — free text (apartment / unit / suite)
- **City** — free text
- **State** — free text
- **ZIP** — free text
- **County** — choices: the 14 Massachusetts counties (Barnstable / Berkshire / Bristol / Dukes / Essex / Franklin / Hampden / Hampshire / Middlesex / Nantucket / Norfolk / Plymouth / Suffolk / Worcester)
- **Disabled Veteran** — choices: (Not asked) / Yes / No

### Spouse / Partner — Co-grantor
_Shown only when the plan is for a couple (`matter_type = couple`)._
- **Full Legal Name** — free text
- **Also Known As (AKA)** — free text
- **Date of Birth** — date (age shown)
- **Phone** — phone number
- **Email** — email
- **Pronouns** — choices: He/Him / She/Her / They/Them / Ze/Zir / Other
- **Citizenship** — choices: US Citizen / Permanent Resident / Non-Resident Alien / Non-US — status unconfirmed
- **Gender** — choices: Male / Female / Nonbinary / Other
- **Date of Marriage** — date
- **Place of Marriage or Registration** — free text (city and state)
- **Survivor Designation** — choices: Settlor 1 (`settlor_1`) / Settlor 2 (`settlor_2`) / Both (`both`)
- **Settlors Live Together** — choices: (Not asked) / Yes / No

### Children
A list of rows ("Add Child"). Each row has:
- **Full Name** — free text
- **Date of Birth** — date
- **Age** — computed from the date of birth (read-only)
- **Deceased** — choices: No / Yes (default No)
- _The fields below are shown only when the child is not deceased:_
  - **Gender** — choices: Male / Female / Other
  - **Child of** — _only for couples_ — choices: Joint (both) (`joint`, the default) / the client's name (`client`) / the spouse's name (`spouse`)
  - **Relationship** — _only for individuals_ — choices: Biological (default) / Adopted / Stepchild
  - **Treat as minor** — checkbox (Yes / No). It is set automatically from the date of birth and can be overridden. A Minor / Adult / Age unknown label is shown next to it.

### Citizenship & Residency
- **Citizenship** (client) — choices: US Citizen / Permanent Resident / Non-Resident Alien / Non-US — status unconfirmed
- **State of Domicile** — free text (defaults to the address State)

## Fiduciary Role Assignment

_Nav label is "Agent Designations" on the College Preparation track. The section takes `isLP` / `lpData` props but renders no LP-only fields. There are no "same as trustee" toggles and no HIPAA role column: HIPAA is not a fiduciary role here._

### Fiduciary assignments

**People in this matter** (roster; only these people can be chosen below)
- **Full name** (new person): free text
- **Relationship** (new person): free text. _"Add person" adds a row to the roster._

**Party tabs**: _shown only when the matter is a couple (`matter_type = couple`)_
- **Party**: choices: <client full name> / <spouse full name> (computed from the sheet, falling back to the matter; defaults to "Client" / "Spouse / Partner")
- **Mirror reversed**: action that copies the current party's appointments to the other party and swaps client and spouse

**Role grid** (one row per roster contact, one column per role; each cell toggles that contact into the role's line of succession)
- Each cell: choices: not named (+) / 1st / 2nd / 3rd / Nth (the order is set by click order and can be reordered with up/down; a contact can be removed) / Co-<role> (paired with a line)
- **Pair with <1st/2nd…> (n/max)**: per-column control. It targets a succession line so the next contact clicked serves jointly as a co-fiduciary on that line. _Shown as "Pick a line to pair first" until someone is named._ The maximum number of co-fiduciaries per line is shown as "Co max per line".
- Column status badge (computed): Not named / No alternate / N in line. _Amber when the role is required and empty._

Per-party columns (slots stored as client `*_slots`; spouse tab uses `spouse_*_slots`):
- **Successor trustee** (Trust; `trustee_slots` / `spouse_trustee_slots`): Primary / Alternate / Co-Trustee, max 3 co per line. _Shown only when the plan type includes a trust (Pour-Over or Testamentary Trust). On a joint trust both spouse tabs edit the same `trustee_slots`, and only separate trusts (`is_joint = false`) get a separate spouse set. Required when the Trust document is included._
- **Personal representative** (Will; `executor_slots` / `spouse_executor_slots`): Primary / Alternate / Co-Personal Representative, max 3 co. _Required when the Will is included._
- **Financial POA agent** (Durable POA; `poa_slots` / `spouse_poa_slots`): Primary / Alternate / Co-Agent, max 3 co. _Required when the DPOA is included._
- **Health care agent** (HCP; `hcp_slots` / `spouse_hcp_slots`): Primary / Alternate / Co-Agent, max 1 co. _Required when the health care documents are included._

**For the children** (shared grid, named once; both wills appoint the same people)
- **Guardian** (Will / appointment; `guardian_slots`): Primary / Alternate / Co-Guardian, max 1 co. _Required when the Will is included and there are minor children._
- **Temporary guardian** (Parental delegation; `temporary_guardian_slots`): Primary / Alternate / Co-Temporary Guardian, max 1 co. _Shown only when there are minor children. Never a drafting blocker._

_Columns that do not apply are hidden unless "show inapplicable" is on, in which case they are dimmed._

### Excluded Guardian(s)
- **Exclude one or more individuals from serving as guardian** (`excluded_guardian_flag`): Yes / No
- _When Yes:_ a list of repeating rows:
  - **Excluded individual**: contact picker
  - **Reason**: free text (e.g. "estranged")

## Estate Plan Design

_Full estate-track layout. The section subtitle shows "N document(s) selected"._

### Plan track
- Read-only. Shows the matter's practice-area label with "Change on the matter" (a link to the matter page). The track is set by the practice area and cannot be edited here.

### Plan Type
- **Plan type** (`plan_type`, blocking): choices: Pour-Over Will + Revocable Trust (`pour_over`) / Will — Outright Distributions (`outright_will`) / Will — Testamentary Trust (`testamentary_trust`)

### Documents Included
_A "distribution method not yet selected" callout appears when no residual beneficiary method is set._

**Core Documents**
- **Trust**: Yes / No. _Disabled for Will — Testamentary Trust. Hidden or dimmed unless the plan type is Pour-Over or not yet set. Checking it sets the will title to Pour-Over Will, and unchecking it sets Last Will._
- **Will**: Yes / No
- **Power of Attorney**: Yes / No (`dpoa`)
- **Health Care Proxy**: Yes / No
- **HIPAA Authorization**: Yes / No
- **Living Will**: Yes / No. _If any of the last three is checked, the healthcare package is included._
- **Generate spouse / partner documents** (`spouse_docs`): Yes / No. _Shown only for couples. Applies to the Will, DPOA and Health Care packages._

**Ancillary Documents**
- **Funding Documents**: _Shown only for Pour-Over plans or when the plan type is unset. Each defaults to on when the trust is included._
  - **Certificate of Trust** (`certificate_of_trust`): Yes / No
  - **Assignment of Personal Property** (`assignment_of_personal_property`): Yes / No
  - **Funding Instructions** (`funding_instructions`): Yes / No
  - **Funding Recommendation** (`funding_recommendation`): Yes / No
  - **Declaration of Homestead (Trustee)** (`homestead_trustee`): Yes / No
- **Trust Summary** (`trust_summary`): Yes / No. _Trust plans only. Defaults to on when the trust is included._
- **Estate Plan Summary** (`estate_plan_summary`): Yes / No. _Defaults to on (estate track)._
- **Estate Plan Signing Guide** (`estate_plan_signing_guide`): Yes / No. _Defaults to on._
- **Successor Trustee Checklist** (`successor_trustee_checklist`): Yes / No. _Trust plans only. Defaults to on when the trust is included._
- **Fiduciary Role Guide** (`fiduciary_role_guide`): Yes / No. _Defaults to on._
- **Flowchart** (`flowchart`): Yes / No. _Defaults to off._
- **Include Asset Spreadsheet** (`include_asset_spreadsheet`): Yes / No. _Defaults to off._
- **Captured, Not Drafted**: these are recorded on the sheet but no template drafts them. All default to off.
  - **Dementia Directive**: Yes / No
  - **Visitation Authorization**: Yes / No
  - **Final Disposition Instructions** (`final_disposition`): Yes / No
  - **Comprehensive Transfer Document**: Yes / No
  - **Client Self-Declaration of Capacity**: Yes / No
  - **Comprehensive Transfer Document Title**: choices: Declaration of Trust / Comprehensive Transfer of Assets / General Assignment. _Shown only when Comprehensive Transfer Document is checked. No default._

**Document Titles**
- **Healthcare Directive Title**: choices: State Default (Health Care Proxy) (`state_default`, default) / Advance Directive / Advance Health Care Directive / Health Care Directive / Health Care Power of Attorney / Other
- **Form of Power of Attorney** (`poa_form`): choices: Short form (`short`) / Long form (`long`, default) / Both forms (`both`)
- **Long-Form Power of Attorney Title**: choices: Power of Attorney / Durable Power of Attorney (`durable_power_of_attorney`, default)

**Asset Transfer Documents**
- **Deed (Registry or Land Court)** (`deed`): Yes / No
- **Trustee's Certificate** (`trustees_certificate`): Yes / No
- **Real Estate Trust** (`real_estate_trust`): Yes / No

### Children Options
- **Include child gender markers**: Yes / No
- **Include afterborn children**: Yes / No
- **Include posthumous children** (`include_expectant_children`): Yes / No
- **Omissions intentional**: Yes / No

### Disinherited Heirs
- **Disinherited Children**: a Yes / No checkbox for each named child from Intake Details. Deceased children are badged.
- **Disinherited Heirs**: a list of repeating rows:
  - **Name**: free text
  - **Relationship**: free text
- **Disinherit issue**: Yes / No
- **General disinheritance language** (`include_general_disinheritance`): Yes / No
- **Additional Disinheritance Language**: free text (multi-line, up to 4000 characters)

### Additional Beneficiaries
- **Additional Beneficiaries** (`include_additional_beneficiaries`): Yes / No
- _When Yes:_ a list of repeating rows:
  - **Name**: free text
  - **Type**: choices: Individual / Group of individuals (`group`) / Charity
  - **Relationship / Role**: free text

## Trust

### Joint Trust
- **Joint or separate trusts?** (required) — choices: Joint trust (`yes`, stored `is_joint=true`) / Separate trusts (`no`, `is_joint=false`). _The component shows this whatever the marital status._

### Trust Name
- **Trust Name** — free text, prefilled with a derived name. _Labelled "<Client first name>'s Trust Name" when married with separate trusts._ Quick-fill buttons: joint plan "The <Last> Family Trust" / "The <Client> and <Spouse> Trust"; otherwise "The <Client full name> Trust" / "The <Initials> Trust".
- **Trust Name Format** — choices: Use "U/A dated" (`ua_dated`, default) / Use "dated" only (`dated_only`)
- **Append "and any amendments thereto"** — Yes / No (default No)
- **<Spouse first name>'s Trust Name** — free text, prefilled with a derived name, with quick-fill suggestions (spouse full name / initials). _Shown only when married with separate trusts._
- **Trust Name Format** (spouse) — choices: Use "U/A dated" (`ua_dated`) / Use "dated" only (`dated_only`). _Separate trusts only._
- **Append "and any amendments thereto"** (spouse) — Yes / No. _Separate trusts only._

### Specific Bequests
_An optional repeating list. Add a row with the **Cash Legacy**, **Specific Item** or **Charitable** button. Each row has:_
- **In document** — choices: Will (`will`) / Trust (`trust`)
- **Distribute at** — choices: <Client>'s death (`client_death`) / <Spouse>'s death (`spouse_death`) / Death of survivor (`survivor_death`). _The last two appear only for couple matters._
- _Cash Legacy row:_ **Amount** — number; **Beneficiary Full Name** — free text
- _Specific Item row:_ **Item Description** — free text; **Beneficiary Full Name** — free text
- _Charitable Bequest row:_ **Amount or Property** — number; **Charity Name** — free text; **Organization Type** — free text (e.g. 501(c)(3)); **State of Organization** — free text; **Charity Address** — free text

### Pet Care Provisions
- **Pet care provision** — choices: Omit (no pets) (`omit`, default) / Direct bequest of pet + cash gift to caretaker (`direct_bequest`) / Statutory pet trust under M.G.L. c. 203E §408 (`pet_trust`)
- **Include pet care provision in** — choices: Will (`will`) / Trust (`trust`). _Shown when the option is not Omit._
- _Direct bequest only:_ **Cash Amount** — number; **Primary Caretaker** — free text; **Successor Caretaker** — free text
- _Pet trust only:_ **Cash Amount** — number; **Pet Trustee** — free text; **Remainder Beneficiary** — free text; **Pet Trust Enforcer** — free text (with a callout saying the enforcer is required)

### Residuary Distribution
- **Residual beneficiary** — choices: Children (`children`) / Descendants (`descendants`) / Named individuals (`named`)
- **Residual Beneficiary Method** (required) — choices: Outright (`outright`) / Staggered (`staggered`) / Held in trust for lifetime (`trust_for_life`) / Custom distribution schedule (`custom`)
- **"Following the death of <Client> [and <Spouse>], the remaining trust property shall be:"** (computed label) — choices:
  - Distributed outright to descendants, per stirpes. (`descendants_outright_per_stirpes`)
  - Divided into shares for descendants, per stirpes, to be distributed outright to children of the Grantor and held in trusts for others. (`descendants_shares_outright_children_trusts_others`)
  - Divided into shares, per stirpes, each share held in trust. State the terms of the trust once and apply to all descendants' trusts. (`descendants_shares_all_trusts`)
  - Divided into shares for named beneficiaries. Separately state terms of administration and distribution for each beneficiary. (`named_beneficiaries_separate_terms`)
- **Named Individuals** — contact picker, repeating (add one at a time). _Shown only when Residual beneficiary = Named individuals._
- **Final Distribution Age** — number (e.g. 30). _Shown only when Method = Outright._
- **Staggered Distributions** — repeating rows, each with **Amount** (free text, e.g. 1/3) and **Age** (number). Quick-fill presets: All at 30 / 1/2 at 25 and 30 / 1/3 at 25, 30, 35. _Shown only when Method = Staggered._

### Remote Beneficiaries
- **Remote Beneficiaries** — choices: My heirs at law (`heirs_at_law`) / 1/2 my heirs at law, 1/2 spouse's heirs at law (`half_heirs_spouse`, couple matters only) / Named individuals / charities (`named`)
- **Named Individuals** — contact picker, repeating. _Shown only when "Named individuals / charities" is selected._
- **Charities** — repeating rows, each with **Charity Name**, **Organization Type** (e.g. 501(c)(3)), **State**, **Address** (all free text). _Shown only when "Named individuals / charities" is selected._

## Trust provisions

### Spousal Trust Funding
_Shown only when married with separate trusts (`is_joint` not true)._
- **Spousal Trust Funding** — choices: Outright to Spouse (`outright_to_spouse`, default) / Distribute in Trust (`in_trust_for_spouse`) / Disclaimer (`disclaimer`) / Clayton Election (`clayton_election`) / Do Not Distribute to Spouse/Partner (`not_to_spouse`)

### Trusts for Survivor
_Shown only for a married joint trust._
- **Marital Trust** — choices: None (`none`) / General Power of Appointment Trust (`general_power_of_appointment`) / Qualified Terminable Interest Property Trust (QTIP) (`qtip`). Nothing is selected by default.
- **Marital Trust Invasion Powers** — choices: No Invasion (`no_invasion`) / Invasion for HEMS (`hems`) / "5 by 5" Invasion Power (`five_by_five`) / Complete Invasion Power (`complete`). _Shown when the Marital Trust is GPOA or QTIP._
- **QTIP Remainder Power of Appointment** — choices: No appointment power (`none`) / Limited testamentary power (`limited_testamentary`). _Shown only when the Marital Trust is QTIP._
- **Include QDOT Language** — Yes / No. _Shown when the Marital Trust is GPOA or QTIP._

### Bypass Trust Options
_Shown only for a married joint trust._
- **Bypass Trust** — choices: None (`none`; disabled when a "None" marital trust was chosen) / Bypass Trust (A/B) (`bypass`) / Contingent Disclaimer Trust (`disclaimer`)
- **Bypass Trust Formula** — choices: Clayton Election (`clayton_election`) / Formula (`formula`) / Fixed Amount (`fixed_amount`) / Percentage (`percentage`). _Shown only when Bypass Trust = Bypass Trust (A/B)._
- **Fixed Amount** — number ($). _Shown only when Formula = Fixed Amount._
- **Percentage** — number (0–100). _Shown only when Formula = Percentage._
- **Bypass Trust Power of Appointment** — choices: No appointment power (`none`) / Limited testamentary power (`limited_testamentary`). _Shown only when Bypass Trust = Bypass Trust (A/B)._
- **Allow Discretionary Sprinkling** — Yes / No. _Shown when Bypass Trust = Bypass or Disclaimer._

### Trust(s) for Spouse
_Shown only when married with separate trusts and Spousal Trust Funding is Distribute in Trust, Disclaimer or Clayton Election. The questions are the same as for the joint trust, with this wording and order:_
- **Marital Trust for the Spouse** — choices: Qualified Terminable Interest Property Trust (QTIP) (`qtip`) / General Power of Appointment Trust (`general_power_of_appointment`) / No Marital Trust (`none`)
- **Marital Trust Invasion Powers**, **QTIP Remainder Power of Appointment**, **Include QDOT Language** — same choices and conditions as for the joint trust
- **Bypass Trust for the Spouse** — choices: Bypass/Credit-Shelter Trust (`bypass`) / Disclaimer Trust (`disclaimer`) / No Bypass Trust (`none`; disabled when No Marital Trust was chosen)
- **Bypass Trust Formula** — choices: All Assets (`all_assets`; disabled when a marital trust exists) / Formula (`formula`) / Fixed Amount (`fixed_amount`) / Percentage (`percentage`) / Clayton Election (`clayton_election`). _Shown only when Bypass = Bypass/Credit-Shelter._
- **Fixed Amount** / **Percentage** / **Bypass Trust Power of Appointment** — same as for the joint trust
- **Should the Bypass Trust sprinkle to children/grandchildren?** — Yes / No. _Shown when Bypass = Bypass or Disclaimer._

### Restatement
- **Restatement** — choices: Yes — restating existing trust (`yes`) / No — new trust (`no`, default)

### Trust Protector
- **Include a trust protector?** — Yes / No (default No)
- **Trust Protector Full Name** — free text. _Shown only when the answer is Yes._

### Trustee Provisions
- **Who serves as initial trustee?** — choices: The grantor (`grantor`, default) / The grantor and spouse (`grantor_and_spouse`) / A single named trustee (`single_initial_trustee`)
- **Who serves as initial trustee of the spouse's trust?** — choices: The spouse (`spouse`, default) / Both spouses (`client_and_spouse`) / A single named trustee (`single_initial_trustee`). _Shown only when married with separate trusts._
- **If the trust ever has co-trustees, how should they make decisions?** — choices: Co-trustees must act jointly (`joint_majority`, default) / Co-trustees may act separately (`independent`) / Do not include (`omit`) / Settlors act separately, others jointly (`settlor_separate_others_joint`)
- **Trustee compensation** — choices: Prevailing Rate for Corporate Trustees (`prevailing_corporate`) / Prevailing Rate for Professional Fiduciaries (`prevailing_professional`) / Reasonable Compensation (`reasonable`, default) / Based on Trustee Type (`based_on_trustee_type`) / No Compensation (`none`)
- **Protect U.S. trust status** — Yes / No (default No; Yes forces Allow Special Trustee on)
- **Allow Special Trustee** — Yes / No (default No; locked on while U.S. trust status protection is on)
- **Special Trustee Instructions (optional)** — free text (long, up to 4000 characters). _Shown when Allow Special Trustee or Protect U.S. trust status is on._
- **Power to manage §529 educational savings plans** — Yes / No
- **Power to manage farms and ranches** — Yes / No
- **Power to manage closely held businesses** — Yes / No
- **Power to manage professional corporations** — Yes / No
- **Subchapter S stock provisions** — Yes / No
- **Allow trustee to change situs** — Yes / No
- **Require bond for trustee** — Yes / No
- **Limit trustee's duty to account** — Yes / No
- **Include reverse mortgage clause** — Yes / No
- **Include firearms administration provisions** — Yes / No
- **Allow a sole acting trustee to appoint co-trustees** — Yes / No
- **Allow an acting trustee to designate alternate successor trustees** — Yes / No
- **Successor Trustee Vacancy** — choices: Majority of income beneficiaries may appoint any successor trustee (`income_beneficiaries_any`) / Majority of income beneficiaries may appoint a professional fiduciary or corporate trustee only (`income_beneficiaries_professional`) / Resigning trustee may appoint any neutral and disinterested party (`resigning_neutral`) / Resigning trustee may appoint a professional fiduciary or corporate trustee only (`resigning_professional`) / Only the settlor(s) may appoint; if unable, court petition (`settlor_or_court`). No default.

### Tangible Personal Property
- **Distribution of tangible property** — choices: Spouse, then children (`spouse_then_children`) / Children, then descendants (`children_then_descendants`) / Named individual, then children (`named_then_children`) / Personal property memorandum (`memorandum`)
- **Named Individual** — free text. _Shown only for "Named individual, then children"._

### Distribution provisions
- **Include provisions for a common trust for Grantor's children?** — Yes / No
- **Special Distributions Age** — Yes / No (turning it on sets the age to 25)
- **Age (years old)** — number (default 25). _Shown only when Special Distributions Age is on._
- **Allow trustee to hold distributions to young beneficiaries in trust** — Yes / No
- **Include substance abuse provisions** — Yes / No
- **Include creditor claims and divorce provisions** — Yes / No
- **Include marital deduction savings language in spendthrift clause** — Yes / No. _Becomes a fixed "included automatically" notice, not a checkbox, when a marital trust (GPOA/QTIP) is chosen, or when separate-trust Spousal Funding is Disclaimer or Clayton Election._
- **Include contingent special needs trust provisions** — Yes / No
- **Allow the trustee to make distributions to dependents if settlor(s) are incapacitated** — Yes / No

### Administrative Provisions
- **Include a no-contest clause in the trust and pour-over will** — Yes / No
- **Name specific people in the no-contest clause** — Yes / No
- **Require mandatory arbitration for trust disputes** — Yes / No
- **Prorate estate taxes among beneficiaries** — Yes / No
- **Representation type** — choices: By right of representation (`by_representation`) / Per stirpes (`per_stirpes`) / Per capita at each generation (`per_capita_each_generation`)
- **Survivorship Requirement (days)** — number (e.g. 30)

### Definitions
- **Include detailed definition of discretionary distributions** — Yes / No
- **Include detailed definition of education expenses** — Yes / No
- **Include arts education in approved educational expenses** — Yes / No
- **Include vocational training in approved educational expenses** — Yes / No
- **Include homeschooling in approved educational expenses** — Yes / No
- **Include definition of disappearance** — Yes / No
- **Parent-child relationships** — choices: State Probate Code (`state_probate_code`) / Custom Definition (`custom`)

### Retirement Accounts, Gifts and Protections
- **Include provisions for distributing retirement accounts** — Yes / No
- **Allow Trust Protector to convert conduit retirement trusts** — Yes / No
- **Allow direct distributions to young or incapacitated beneficiaries** — Yes / No
- **Include slayer provision (disqualification for wrongful killing)** — Yes / No
- **Allow the trustee to continue customary charitable giving during incapacity** — Yes / No
- **Forgive all debts owed by any beneficiary** — Yes / No

### Incapacity
- **Include definition of incapacity** — Yes / No
- **Allow clinical psychologist to substitute for physician** — Yes / No
- **Allow physician assistant or nurse practitioner to substitute for physician** — Yes / No
- **Incapacity of a settlor is determined by** — select: Attending and second physician / Single licensed physician / Attending or any two physicians / Single physician or clinical psychologist / Two licensed physicians / Two physicians or psychologists / One physician and one psychologist / Attorney-at-law / Governmental official / Trust protector / Successor trustee / Majority of adult children / Incapacity panel / Court of competent jurisdiction / Other settlor and successor trustee / Custom (stored values are the snake_case forms, e.g. `attending_and_second_physician`, `court`, `other_settlor_and_successor_trustee`)
- **Incapacity of an acting trustee is determined by** — select: Attending and second physician / Single licensed physician / Attending or any two physicians / Single physician or clinical psychologist / Two licensed physicians / Two physicians or psychologists / One physician and one psychologist / Attorney-at-law / Governmental official / Trust protector / Court of competent jurisdiction / Custom

## Asset Schedules
_Shown only when the plan includes a revocable trust._

### Asset Inventory — Key assets to be coordinated with the estate plan
A list of rows ("Add Asset"). A gross estate total is computed and shown. Each row has:
- **Type** — choices: Real Property (`real_property`) / Financial Account (`financial`, the default) / Retirement / Life Insurance (`life_insurance`) / Business Interest (`business`) / Other
- **Description** — free text
- **Est. Value** — number (currency)
- **Institution / Holder** — free text
- **Notes** — free text
- **Current owner / title** — free text
- **Target owner / title** — free text
- **Beneficiary designation** — free text

### Schedule A Options — How each settlor's schedule of trust assets is drafted
- **Include signature block on each settlor's Schedule A** — Yes / No
- **Include general catchall language on each settlor's Schedule A** — Yes / No
- **Include a schedule of non-trust assets for each settlor** — Yes / No
- **Format for asset schedules** — choices: Assets in table format (`table`) / Assets in paragraph format (`paragraph`)

### Trust Funding Roadmap — Editable instructions used by the funding-plan document
- **Client-facing funding narrative** — long free text
- A list of funding action rows ("Add funding action"; numbered automatically). Each row has:
  - **Funding action** — free text
  - **Target trust** — free text
  - **Priority** — choices: High (`HIGH`) / Medium (`MEDIUM`, the default) / Low (`LOW`)

## Last Will and Testament
_Shown only when a will is included in the plan._

### Will Title — Choose the title used for the generated Last Will and Testament.
- **Will title** — choices: "Last Will and Testament of {client first name}" (`last_will`) / "Pour-Over Will of {client first name}" (`pour_over_will`)

## Will Details

_"(required)" marks questions the UI flags as blocking for drafting._

### Personal Representative Powers
- **Allow executor to pay taxes, debts, and expenses** — checkbox: Yes / No (default No)
- **Allow executor to manage digital assets** — checkbox: Yes / No (default No)
- **Include "Distribution in Cash or Kind" Power** — checkbox: Yes / No (default No)

### Will — Common Provisions
- **Bond** — choices: No bond (default) (`no_bond`) / Required (`required`)
- **Supervision** — choices: Unsupervised (default) / Supervised
- **Simultaneous death** — choices: Spouse deemed to survive (`spouse_survives`) / Testator deemed to survive (`testator_survives`) / Omit. _Help text: default "spouse survives" for couples, "omit" for singles._
- **UTMA age** — choices: 18 / 21 (default)
- **No-contest clause** — choices: Omit (default) / Include. _Shared with the trust (one answer drives both documents)._
- **Disclaimer article** — choices: Include (default) / Omit
- **Self-proving affidavit** — choices: Include (default) / Omit

### Testamentary Power of Appointment
- **Exercise a power of appointment** — choices: Yes / No. _Label reads "Client exercises a power" when spouse documents are included._
- **Spouse exercises a power** — choices: Yes / No. _Shown only for a married matter with spouse documents included._

### Pour-Over Will Specifics
_Shown only when plan type is pour-over._
- **Trust Date** — date
- **Alternate disposition if pour-over fails** — choices: Spouse, then descendants (`spouse_then_descendants`) / Descendants only (`descendants_only`) / Named individual (`named`)
- **Named Residuary Beneficiary** — free text. _Shown only when "Named individual" is chosen._

### Outright Will — Residuary Estate
_Shown only when plan type is outright will._
- **Residuary distribution** — choices: Spouse, then descendants (`spouse_then_descendants`) / Descendants, then heirs at law (`descendants_then_heirs`) / Named individual, then alternate, then heirs at law (`named`)
- **Named Residuary Beneficiary** — free text. _Shown only when "Named individual…" is chosen._
- **Alternate Residuary Beneficiary** — free text. _Shown only when "Named individual…" is chosen._

### Testamentary Trust Specifics
_Shown only when plan type is testamentary trust. Trustee structure is set in the Fiduciaries section._
- **Beneficiary structure** — choices: Spouse for life (HEMS), remainder to descendants (`spouse_hems_then_descendants`) / Descendants in separate shares per stirpes (`descendants_per_stirpes`) / Single beneficiary (HEMS) (`single_beneficiary`)
- **Age-based distribution schedule** — choices: Outright at 25 / Outright at 30 / Outright at 35 / Staggered: 1/3 at 25, 1/2 of remainder at 30, balance at 35 (`staggered_25_30_35`). _Hidden when "Single beneficiary" is chosen._
- **Single Beneficiary Full Name** — free text. _Shown only for "Single beneficiary"._
- **Remainder Beneficiary or Description** — free text. _Shown only for "Single beneficiary"._
- **Trust Protector Full Name** — free text. _Shown only when a trust protector is enabled on the sheet (set elsewhere)._

_LP matters also get a Residuary Estate panel under Will Details — see below._

### Residuary Estate (LP matters only)

_Shown under Will Details only for LP matters. Values are stored in `li_design_sheet_data`._

#### If spouse / partner survives
- **If spouse / partner survives** (`residuary_spouse_survives`): choices: All to spouse / partner (`all_to_spouse`, default) / Other (`other_spouse`)

#### If no spouse / partner survives
- **If no spouse / partner survives** (`residuary_no_spouse`): choices: To descendants, per stirpes (`descendants_per_stirpes`, default) / Other (`other_no_spouse`)

#### Specific gifts
- **Specific gifts**: free text (optional)

#### Other instructions
- **Other instructions**: free text (optional)

## Financial Power of Attorney

_These options apply to every power of attorney document in the package._

### Optional Document Modules
- **Entity & Business** (oil/gas/mineral through partnership and LLC powers, §3.J–3.L) — checkbox: Yes / No (default No)
- **Advanced Trust & Gifting** (amend-trust powers, gifting subsections (c)–(g)) — checkbox: Yes / No (default No)
- **Extended Personal Care** (recreation, religious, companionship §4.D–4.F; pet care §5.I) — checkbox: Yes / No (default No)

### Compensation for Agents
- **Agent compensation** (required) — choices: Prevailing Rate for Professional Fiduciaries (`prevailing_professional`) / Reasonable Compensation (`reasonable`, default) / No Compensation (`none`)

### Should co-agents serve jointly, separately, or should the document be silent?
- **Co-agent decision-making** (required) — choices: Co-agents must act jointly (`jointly`) / Co-agents may act separately (`separately`, default) / Do not include (`silent`)

### When the Power of Attorney Takes Effect
- **When should the power of attorney be effective?** — choices: Springing / Immediate (no default)
- **After capacity returns, what happens to the agent's authority?** — choices: Continue until revoked or terminated (`continue`) / Suspend until a later incapacity (`suspend`)
- **Incapacity determination provision** — choices: Default / Custom

### Document Options
- **Include Notice Page** — checkbox: Yes / No (default No)
- **Preserve any existing bank and institutional powers of attorney** — checkbox: Yes / No (default No)
- **Acceptance of Agent Signature Page** — choices: Include Acceptance of Appointment (`include`) / Do Not Include Acceptance of Appointment (`omit`)

### Gifting Powers
- **Allow gifts?** — choices: Allow gifts / Do not allow gifts (default)

### Trust Powers
- **Include trust powers?** — choices: Include / Don't include (default)
- _Shown only when "Include" is chosen. Each is a checkbox: Yes / No (default No):_
  - **Agent may create trusts**
  - **Agent may create trusts for dependents**
  - **Allow agent to be trustee**
  - **Agent may create Medicaid planning trusts**
  - **Agent may modify sole-settlor trusts**
  - **Agent may modify joint trusts**

### Attorney-in-Fact(s) Powers
- **All powers in this list** — checkbox: Yes / No (default No). Ticking any single power below clears it.
- Each basic power is a checkbox: Yes / No (default No):
  - **Real property transactions** (`real_property`)
  - **Tangible personal property transactions** (`tangible_personal_property`)
  - **Stock and bond transactions** (`stocks_bonds`)
  - **Commodity and option transactions** (`commodities_options`)
  - **Banking and other financial institution transactions** (`banking`)
  - **Business operating transactions** (`business_operating`)
  - **Insurance and annuity transactions** (`insurance_annuity`)
  - **Estate, trust, and other beneficiary transactions** (`estate_trust_beneficiary`)
  - **Claims and litigation** (`claims_litigation`)
  - **Personal and family maintenance** (`personal_family_maintenance`)
  - **Benefits from Social Security, Medicare, Medicaid, or other governmental programs, or civil or military service** (`government_benefits`)
  - **Retirement plan transactions** (`retirement_plans`)
  - **Tax matters** (`tax_matters`)
- **Additional Powers** — free text (multi-line)
- **Name Specific Businesses** — free text (named in the "Operate Business" power)
- **Additional Limitations** — free text (multi-line)

### Miscellaneous Special Powers
Each is a checkbox: Yes / No (default No).
- **Allow delegation of authority**
- **Prohibit arbitration**
- **Power to manage §529 educational savings plans**
- **Allow agent to access medical information** (also names the POA in the HIPAA Authorization)
- **Power to control digital assets and devices**
- **Allow self-designation for beneficiary designations**

## Health Care & Directives

_The section renders nothing unless the package includes health care documents. "[Client]" and "[Spouse]" stand for the person's first name ("Client" or "Spouse" when no name is set). Spouse variants appear only for a married matter with spouse documents included._

### [Client]'s Anatomical gifts preference (and [Spouse]'s Anatomical gifts preference)
- **Anatomical gift preference** (required) — choices: Yes, make anatomical gifts (`yes`) / Defer to healthcare agent or donor registry (`defer`) / No, do not make anatomical gifts (`no`)
- **Any restrictions on anatomical gifts?** — checkbox: Yes / No
  - restrictions — free text (multi-line). _Shown only when the box is checked._

### HIPAA Authorization
- **Include the general (financial) durable power of attorney in the HIPAA authorization** — checkbox: Yes / No (default No)
- **Include trustee and successor trustees in the HIPAA authorization** — checkbox: Yes / No (default No)
- **HIPAA fiduciary scope** — choices: List fiduciaries by name (`by_name`) / Use general language only (`general_language`)

### Additional HIPAA Agents
_Single matter: one block titled "Additional HIPAA Agents". Married matter: two blocks, "[Client]'s Additional HIPAA Agents" and "[Spouse]'s Additional HIPAA Agents"._
- **Contacts to include** — multi-select checkbox list of every matter contact, by name

### [Client]'s Advance Health Directive (and [Spouse]'s Advance Health Directive)
- **Life-support preference** (required) — choices: Prolong Life (`prolong_life`) / Do Not Resuscitate (`do_not_resuscitate`) / Do Not Prolong Life (`do_not_prolong_life`) / Other / Custom Instructions (`other`)
- **Custom advance directive instructions** — free text (multi-line). _Shown only for "Other / Custom Instructions"._

### HIPAA Authorization — Psychotherapy Notes
_Client must initial; there is no default._
- **Psychotherapy notes** — choices: Authorize disclosure (`authorize`) / Do NOT authorize disclosure (`do_not_authorize`)

### Health Care Proxy Options
- **Include Notice Page** — checkbox: Yes / No

### [Client] — Wishes (and [Spouse] — Wishes)
- **Leave health care instructions blank** — checkbox: Yes / No
- **Receive hygiene and comfort care** — checkbox: Yes / No
- **Wish to die at home** — checkbox: Yes / No
- **Decline autopsy** — checkbox: Yes / No
- **Other health care wishes** — free text (multi-line)

### [Client] — Agent Authority (and [Spouse] — Agent Authority)
- **Agent's authority is effective immediately** — checkbox: Yes / No (otherwise springing)
- **Include post-death authority and instructions for final disposition** — checkbox: Yes / No
- **Limits while living** — free text
- **Limits after death** — free text
- **How should co-agents resolve disagreements?** — choices: Do not include (`omit`) / Majority rules (`majority`) / Unanimous agreement required (`unanimous`) / First-named agent has final authority (`first_named`)

### [Client] — Post-Death Choices (and [Spouse] — Post-Death Choices)
- **How should the remains be handled?** — choices: Cremation / Chemical cremation (alkaline hydrolysis) (`chemical_cremation`) / Burial / No specific wishes (`no_specific_wishes`) / Leave blank in document (`leave_blank`) / Other
- **Funeral instructions** — free text
- **Pre-need or post-death arrangements** — free text
- **Other disposition instructions** — free text
- **Preference for donations** — checkbox: Yes / No
- **Prohibit AI replicas or digital recreations** — checkbox: Yes / No
- **Make disposition agents the same as health care agents** — checkbox: Yes / No
- **Include disposition agent acceptance** — checkbox: Yes / No

## Transfers & Assignments

_Nav subtitle: "Deed, trustee certificate & realty trust". The documents are chosen in Estate Plan Design. With none chosen, the section shows only "Select asset transfer documents in Estate Plan Design to configure transfer fields here." `DeedDocumentSection` (Deed Work / Deed Notes) is defined in DocumentSections.tsx but is not rendered anywhere, so it is omitted._

### Real Estate Transfer
**Upload deed PDF** — _shown when Deed or Trustee's Certificate is selected_
- **Deed PDF** — file upload (PDF). Extracted values pre-fill the deed fields.

**Realty trust** — _shown when Real Estate Trust or Trustee's Certificate is selected_
- **Client information** — read-only here, pulled from the design sheet: Client name, Spouse name, Property street address, City / town, State, County
- **Trust names** — list of names (add with free text, remove with ×)
- **Realty trust name** — free text (suggested names offered as buttons)
- **Realty trust date** — date
- **Trustee** — contact picker (required)
- **Co-trustee** — contact picker, repeating ("Add a co-trustee")
- **Beneficial owners** — repeating rows, added from Client / Spouse / each trust name / "Add beneficial owner" (custom). Row fields:
  - name: fixed for Client/Spouse, trust select when more than one trust exists, free text for custom
  - **%** — free text (percentage)

**Deed** — _shown when Deed is selected_
- **First grantor** — free text
- **Second grantor (if any)** — free text
- **Grantee(s)** — repeating picks: Client / Spouse / each trust name / Realty trust (_only once a realty trust name is entered_) / Add custom (free-text name)
- **Property address**: **Street address**, **City / town**, **State**, **County** — free text (editable; client address is only a fallback)
- **Recording system** — choices: Registry of Deeds (`registry`, default) / Land Court / registered land (`land_court`)
- **Legal-description type** — choices: Lot / plan (`lot_plan`, default) / Metes and bounds (`metes_and_bounds`)
- **Opening property description** — free text (multi-line)
- **Additional description / easements** — free text (multi-line)
- **Current deed recording date** — date
- **Full Registry of Deeds / Land Court name** — free text
- **Current deed book number** — free text. _Registry only._
- **Current deed page** — free text. _Registry only._
- **Current deed document number** — free text. _Land Court only._
- **Current certificate of title number** — free text. _Land Court only._
- **Grantee mailing address** — free text
- **Parcel / map-lot ID** — free text
- **Consideration** — free text
- **Directional calls and bounds** — repeating rows. _Shown only for Metes and bounds._ Row fields: directional call (free text, e.g. NORTHWESTERLY) and bound description (free text).
- **Certificate execution county** — free text. _Shown only when Trustee's Certificate is selected._

**Trustee's Certificate** — _shown when Trustee's Certificate is selected without Deed_
- **Certificate execution county** — free text

## Attorney Notes

### Client Goals — What the client wants to achieve with their estate plan
- **Client Goals** (`goals_notes`) — long free text (character-limited; prefilled from intake planning goals)

### Client Concerns — Concerns, worries, or special circumstances raised by the client
- **Client Concerns** (`concerns`) — long free text (character-limited)

### Attorney Notes — Internal notes — not shared with client
- **Attorney Notes** (`drafting_notes`) — long free text

### Additional Template Variables
- A list of key/value rows. Each row has:
  - **variable_name** — free text (letters, digits and `_`, starting with a letter; becomes `extras.<name>`)
  - **Value** — free text (the value rendered into the document)

## Signing & Execution

_Rendered on the Review step, above the final review, as a collapsible "Signing mechanics" panel marked "Deferred" ("Completed at the signing meeting"). It is not one of the design-section groups. Signing type never blocks drafting._

### Signing mechanics
- **Signing type** — choices: Undecided / Attorney Supervised (`attorney_supervised`) / Independent Client (`independent_client`)
- **Signing Date** — date (also sets the signing month and year)
- **Signing County** — select: Barnstable / Berkshire / Bristol / Dukes / Essex / Franklin / Hampden / Hampshire / Middlesex / Nantucket / Norfolk / Plymouth / Suffolk / Worcester
- **Signing City or Town** — free text
- **Notary Commission Expiration** — date
- **Notary Name** — free text

### Acknowledgment Method
- **Living trust** — choices: Notary / Witnesses / Both (witnessed and notarised)
- **Power of attorney** — choices: Notary / Witnesses
- **Advance health care directive** — choices: Notary / Witnesses
- **Health care authorization** — choices: Notary / Witnesses
- **Final disposition instructions** — choices: Witnesses only (`witnesses`) / Witnesses and notary (`witnesses_and_notary`)

### Signing Arrangements
- **Combine settlor and trustee signature lines** — checkbox: Yes / No
- **Health care documents signed in a nursing home** — checkbox: Yes / No

### Witnesses
- **Include witness phone numbers on the signature pages** — checkbox: Yes / No
- **Witness 1 Address** — free text
- **Witness 1 Phone** — free text
- **Witness 2 Address** — free text
- **Witness 2 Phone** — free text

## Estate Plan Design (Essential layout)

_This is the short "Essential Estate Plan Design" layout. Each block reuses the full sheet's control._

### Plan Type
- **Plan type**: the same choices as above (Pour-Over Will + Revocable Trust / Will — Outright Distributions / Will — Testamentary Trust)

### Asset Transfer Documents
- **Deed (Registry or Land Court)** / **Trustee's Certificate** / **Real Estate Trust**: Yes / No each

### Children Options, Disinherited Heirs, Additional Beneficiaries
- These are the same fields as in Estate Plan Design above, without the placement note.

### Trust
- _Shown only when the Trust is included and the plan is Pour-Over (or the plan type is unset)._
- Contains the Trust Details "essential" variant: Joint Trust, Trust Name, Trust Protector, Trustee Provisions, Pet Care Provisions and Residuary Distribution, plus Specific Bequests and Remote Beneficiaries. Questions and choices are the same as in the [Trust](#trust) and [Trust provisions](#trust-provisions) sections.

### Power of Attorney
- _Shown only when the DPOA is included._
- **Co-agent decision-making** (`dpoa_provisions.coagent_serving`, blocking): choices: Co-agents must act jointly (`jointly`) / Co-agents may act separately (`separately`) / Do not include (`silent`)

### Health care
- _Shown only when health care documents are included._
- Contains the Health Care design "essential" scope — the same questions as [Health Care & Directives](#health-care--directives), limited to the essentials.

### Real property
- Contains the Transfers & Assignments section, titled "Real property" — the same questions as [Transfers & Assignments](#transfers--assignments).

### Signing Type
- **Signing type** (`signing_type`): choices: Undecided (default) / Attorney Supervised / Independent Client


## College Preparation Plan

_A separate plan track (College Prep). Answers come pre-filled from the student's questionnaire. Any answer left as "Discuss at the meeting" (`discuss`) gets a callout asking for a decision before drafting. Yes/No questions start unanswered._

### School & Records
- **School / program** — free text
- **Move-in / orientation date** — date
- **Campus city** — free text
- **Campus state** — free text
- **Student ID** — free text
- **Studying abroad?** — choices: Yes / No
  - **Country** — free text. _Shown only when Yes._
- **FERPA release** — choices: Yes / No
  - _Shown only when Yes:_ **Records the release covers** — checkboxes: Grades and transcripts (`grades`) / Bursar / tuition account (`billing`) / Financial aid records (`financial_aid`) / Housing and residence life (`housing`) / Student conduct and disciplinary records (`conduct`) / Campus health / counseling center (`health_center`)
  - _Shown only when Yes:_ **Who may receive the records** — repeating contact picker ("Recipient 1…", "Add another recipient")

### Durable Power of Attorney — Scope
- **Takes effect** (required) — choices: Immediately upon signing (`immediately`, marked recommended) / Only upon a documented determination of incapacity (`springing`) / Discuss at the meeting (`discuss`)
- **Powers granted to the financial agent** — "All powers in this list" checkbox, then one checkbox per power: Banking and bank accounts (`banking`) / Paying bills and routine expenses (`bills`) / Tuition, bursar, and student accounts (`tuition`) / Financial aid office and scholarships (`financial_aid`) / Student loans and loan servicers (`student_loans`) / Credit cards and consumer debt (`credit_cards`) / Tax filings and communication with the IRS / DOR (`taxes`) / Leases, housing, and security deposits (`housing`) / Auto — registration, insurance, repairs (`auto`) / Insurance claims of any kind (`insurance_claims`) / Retaining and instructing an attorney (`retain_attorney`) / Responding to citations, summonses, or conduct charges (`citations`) / Investment and brokerage accounts (`investments`) / Digital accounts and online access (`digital`) / Employment paperwork and payroll (`employment`) / Signing contracts on the student's behalf (`contracts`)
- **Withheld or limited** — free text (multi-line)
- **Drafting notes** — free text (multi-line)

### Health Care Proxy
- **Limits on the agent's authority** — free text (multi-line)
- **Religious, cultural, or personal instructions** — free text (multi-line)

### HIPAA Authorization
- **Information released** (required) — choices: All health information, without limitation (`all`) / All health information EXCEPT the categories below (`all_except`) / Discuss at the meeting (`discuss`)
  - **Categories withheld** — checkboxes: Mental health / psychotherapy notes (`mental_health`) / Substance use treatment (`substance_use`) / HIV / AIDS status and testing (`hiv`) / Reproductive and sexual health (`reproductive`) / Genetic testing and results (`genetic`). _Shown only for "EXCEPT the categories below"._
- **Expires** (required) — choices: No expiration — until the student revokes it (`none`) / Expires on a specific date (`date`)
  - **Expiration date** — date. _Shown only for "Expires on a specific date"._
- **People a provider may talk to** — read-only list from the questionnaire (name, relationship, phone, email). Edited in the intake.
- **Different scope for different people** — free text
- **Must NOT receive access** — free text (multi-line)

### Living Will
- **Include a living will** (required) — choices: Yes — include written treatment instructions (`yes`) / No — leave every decision to the health care agent (`no`) / Discuss at the meeting (`discuss`). Only "No" removes the living will from the package.
- _Shown only when "Yes":_
  - **If there is no reasonable hope of recovery** (required) — choices: Use all available measures to prolong life (`all_measures`) / Comfort care only if there is no reasonable hope of recovery (`comfort_only`) / Leave it to my health care agent (`trust_agent`) / Discuss at the meeting (`discuss`)
  - **CPR** — choices: Yes, I would want it (`yes`) / No, I would not want it (`no`) / My agent decides (`agent_decides`) / Discuss at the meeting (`discuss`)
  - **Artificial nutrition and hydration** — same choices as CPR
  - **Mechanical ventilation** — same choices as CPR
  - **Comfort care at all times** — choices: Yes / No
- **Organ donation** — choices: Yes — any needed organs or tissue (`any`) / Yes — only the organs or purposes I name below (`specific`) / No / Discuss at the meeting (`discuss`). Drafted into the health care proxy whether or not there is a living will.
  - **Organs or purposes named** — free text (multi-line). _Shown only for "only the organs or purposes I name"._
- **Other medical notes** — free text (multi-line)

### Last Will & Testament
- **Include a simple will** — choices: Yes / No (also turns the will document on or off)
- _Shown only when Yes:_
  - **Parent taking the residue** — contact picker
  - **Second parent (optional)** — contact picker

## Intake Review
Read-only display of the client's intake answers. It has no editable questions; its only action re-syncs the sheet from intake.

## Appendix: Person / contact fields

**Contact picker** (used wherever a field says "contact picker"): a search box ("Search contacts…") lists the matter's contacts. You can pick one, or choose "Add new contact" / "Add "<query>" as new contact". The chosen contact can be edited (pencil) or cleared (X). The **Add Contact / Edit Contact** dialog asks for:
- **First name** (required), **Middle name**, **Last name** (required), **Suffix**, **Preferred name** — free text
- **Pronouns** — choices: He/Him / She/Her / They/Them / Ze/Zir / Other
- **Relationship** — free text (for example "Brother, Friend")
- **Phone** — phone number
- **Email** — email
- **Address (if HCP agent)** — free text

**Add Person dialog** (AddPersonDialog). There are two modes, fiduciary and beneficiary, and the title and subtitle are supplied by the caller. It asks for:
- **Fiduciary Type** (required) — _fiduciary mode_ — choices: Individual (`individual`, the default) / Independent Professional Fiduciary (`independent_professional`) / Bank or Institutional Fiduciary (`bank_institutional`) / Other Professional, Entity, or Firm (`other_entity`)
- **Beneficiary Type** (required) — _beneficiary mode_ — choices: Individual Person (`individual`, the default) / Charity / Group of Individuals (`group`)
- **Fiduciary's Name / Beneficiary Name** (required) — free text, a single full-name box that is split into first / middle / last
- **Gender (Optional)** — choices: he/him / she/her / they/them — _only for an Individual or Independent Professional fiduciary, or an Individual Person beneficiary_
- **Date of Birth (Optional)** — date — _same condition_
- **Phone Number** — phone number
- **Email Address** — email
- **Address** — free text
- **Relationship** — _same condition_ — a grouped dropdown:
  - **{Client} group**: {Client}'s Mother / Father / Sister / Brother / Son / Daughter / Grandparent / Grandchild / Aunt / Uncle / Niece / Nephew / Cousin
  - **{Spouse} group**: the same list for the spouse — _only when there is a spouse_
  - **Other group**: Friend / Attorney / CPA / Other (specify)
- **Relationship detail** — free text — _only when "Other (specify)" is chosen_
- **Also add as a beneficiary** — checkbox, _fiduciary mode_ / **Also add as a fiduciary** — checkbox, _beneficiary mode_ (Yes / No)
