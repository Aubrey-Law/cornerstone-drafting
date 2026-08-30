# Statular Interview — Complete Question & Decision Map

> Captured from Statular's 25-page interview by the firm, and the source of the
> verbatim question and option wording in `lib/designSheet/statularInterviewMap.ts`.
> The design sheet exports to Statular's file import in this vocabulary — see
> "Exporting to Statular" in `docs/design-sheet-sections/trust-details.md`.
>
> **Still being extracted, and expected to grow.** A question here that the map
> module does not yet cover is not a bug: unmapped answers still export, under
> "Additional answers" with our own labels, and move up to verbatim as entries
> are added. Nothing is lost by a gap here.



**Legend**
- `( )` single-select (radio) · `[ ]` toggle/checkbox · `___` free text · `▤` repeating list (add rows) · `👤` contact picker
- `*` required
- **⟶ unlocks:** selecting/checking this reveals additional questions
- **⚠ hidden branch** — sub-questions exist but are collapsed in the current matter because the parent option is off. Noted so nothing is missed.

---

## Page 1 — Document Selection

### Core Documents
- `[ ]` **Trust** — always included (not optional; the centerpiece of the package)
- `[ ]` Table of Contents — requires manual field update in Word after generation
- `[ ]` **Power of Attorney** — financial decisions on incapacity
  - `( )*` **Form of Power of Attorney**
    - Short-Form POA
    - Long-Form POA (powers explicitly enumerated + extra options)
    - Include both forms
  - `( )*` **Long-Form POA Title** — appears in the POA, cover letter, signing guide, summary
    - Power of Attorney
    - Durable Power of Attorney
- `[ ]` **Healthcare Directive**
  - `( )*` **Healthcare Directive Title**
    - State Default (Health Care Proxy)
    - Advance Directive
    - Advance Health Care Directive
    - Health Care Directive
    - Health Care Power of Attorney
    - Other (Specify) ⟶ `___`
- `[ ]` **Dementia Directive** — only where the selected healthcare format supports a separate dementia directive
- `[ ]` **Visitation Authorization** — permitted visitors in healthcare facilities
- `[ ]` **HIPAA Authorization**
- `[ ]` **Final Disposition** — burial / cremation / funeral instructions
- `[ ]` **Pour-Over Will**
  - `( )*` **Will Title**
    - Last Will and Testament of [Name]
    - Pour-Over Will of [Name]
- `[ ]` **Certification of Trust**

### Ancillary Documents
- `[ ]` **Comprehensive Transfer Document** (general assignment for funding)
  - `( )*` **Title**
    - Declaration of Trust
    - Comprehensive Transfer of Assets
    - General Assignment
- `[ ]` **Assignment of Personal Property**
- `[ ]` **Client Self-Declaration of Capacity** — sworn declaration re: capacity, understanding, independent intent, freedom from undue influence

### Letters
- `[ ]` Client Acknowledgment (next-steps letter)
- `[ ]` Consent to Dual Representation (joint representation of spouses/partners)
- `[ ]` Invoice (firm-branded)
- `[ ]` Letter to Clinician for Capacity Evaluation

### Informational & Presentation
> The Cover Letter and Summary overlap — pick one or the other.

- `[ ]` **Cover Page**
  - `[ ]` Include firm phone number and email on cover page
- `[ ]` **Cover Letter**
  - `( )*` **Summary of Distribution in Cover Letter**
    - Short general summary
    - AI-generated distribution summary
- `[ ]` **Summary**
  - `( )*` **How should the trust be summarized?**
    - Short general summary
    - Article-by-article general summary
    - AI-generated distribution summary
- `[ ]` **Estate Plan Signing Guide**
  - `___` Signing Instructions — editable opening block (default text covers: don't sign before witnesses/notary present; photo ID; find a notary; find two disinterested witnesses; schedule a signing date; sign in blue ink; copy and store originals)
- `[ ]` Funding Instructions
- `[ ]` Successor Trustee Checklist
- `[ ]` Fiduciary Role Guide
- `[ ]` Flowchart (visual asset flow)
- `[ ]` Asset Spreadsheet (Excel asset report)
- `[ ]` Summary of Client Information
- `[ ]` Summary of Fiduciary Designations

---

## Page 2 — Family Information

### Settlor 1
- **Swap Settlors** (action button — re-maps fiduciary relationships and asset ownership)
- `___*` First Settlor Legal Name (as on government-issued ID)
- `▤` Aliases (appear as "also known as")
- `( )*` Citizenship — U.S. Citizen / Non-U.S. Citizen
- `( )*` Marital Status — Married / Civil union / Registered domestic partnership / Unmarried partnership
- `( )` Gender — Male / Female / Nonbinary / Other / Clear selection
- `___*` Address — Line 1, Line 2, City, State, ZIP, County
- `___` Phone Number (either/both clients)
- `___` Email Address (either/both clients)

### Settlor 2
- `___*` Second Settlor Legal Name
- `▤` Aliases
- `( )*` Citizenship — U.S. Citizen / Non-U.S. Citizen
- `( )` Gender — Male / Female / Nonbinary / Other / Clear selection
- `[ ]` Do the settlors live together? — **unchecking ⟶ a separate address block for Settlor 2**
- `___` Settlor 2 Phone Number
- `___` Settlor 2 Email Address

### Information About Settlors
- `___` Date of Marriage or Registration
- `___` Place of Marriage or Registration
- `( )*` **Survivor Designation** (simultaneous death / order of death unascertainable) — Settlor 1 / Settlor 2 / Both
- `( )*` **Disabled Veteran?** — is either settlor 100%-rated and compensated at 100% by the VA — Yes / No

### Children
- `▤` **Children list** (include deceased children from prior relationships)
  - Per child: name, parentage (joint / Settlor 1 only / Settlor 2 only), deceased Y/N, date of birth
- `[ ]` Include child gender markers
- `[ ]` Include afterborn children
- `[ ]` Include posthumous children (in gestation at first settlor's death)
- `[ ]` Omissions intentional (safety-net clause)
- `( )*` **How should parent-child relationships be defined?**
  - State Probate Code
  - Custom Definition ⟶ language including/excluding specific classes of children
- `( )*` **Whose children count as each settlor's children?**
  - Joint children only
  - Each settlor's separate children only
  - Each settlor's own children (joint + that settlor's prior-relationship children)
  - All children in both trusts
  - All named children (no categorization by parent)

### Disinherited Heirs — *asked separately for each settlor*
- `( )*` **Disinherited Children** — multi-select from the children list / Clear selection
- `▤` **Disinherited Heirs** — add non-child persons or a *Group of People* (e.g. all descendants of X), with name + relationship
- `[ ]` Disinherit issue of every disinherited person
- `___` Additional Disinheritance Language (Clause Library / Draft with AI)

---

## Page 3 — Contacts

### All Fiduciaries and Decisionmakers
> Adult children and spouses are added automatically. Everyone added here becomes selectable for roles on later pages.

- `[ ]` Show fiduciary phone numbers in documents
- `[ ]` Show fiduciary addresses in documents
- `[ ]` Show fiduciary email addresses in documents
- `[ ]` Show fiduciary dates of birth in documents
- `[ ]` Show fiduciary relationships in documents
- `▤` **Fiduciaries** — add each trustee, guardian, POA agent, executor, healthcare agent, disposition agent (name, relationship, address, phone, email, DOB)

### All Beneficiaries
- `[ ]` Show beneficiary phone numbers in documents
- `[ ]` Show beneficiary addresses in documents
- `[ ]` Show beneficiary email addresses in documents
- `[ ]` Show beneficiary dates of birth in documents
- `[ ]` Show beneficiary relationships in documents
- `▤` **Beneficiaries** — individuals, groups of individuals, and charities
  - Per beneficiary: **Type** — Individual Person / Group of People / Charity — plus name, relationship, contact details

---

## Page 4 — Guardian Designations
> Shown because the clients have one or more minor children.

- `[ ]` **Nominate guardians in will**
  - ⚠ **hidden branch:** checking this reveals guardian nomination pickers (guardian of the person / of the estate, first nominee, alternates, co-guardian handling, and any special instructions)
- `[ ]` **Include a Standby Guardian Designation** — separate document; authority activates on incapacity, debilitation, or death
  - ⚠ **hidden branch:** checking this reveals standby guardian nominees and effective-event options

---

## Page 5 — Living Trust Details (applies to both trusts)

### Children Drafting
- `( )` **How should children be identified in the Distribution to Children section?**
  - List children by name (clearer, longer)
  - Use generic child language (more concise)

### Trustee Provisions
- `( )*` **Trustee Compensation**
  - Prevailing rate for corporate trustees
  - Prevailing rate for professional fiduciaries
  - Reasonable compensation (time and effort)
  - Based on trustee type (corporate → corporate rates; professional → fiduciary rates; otherwise reasonable)
  - No compensation
- `[ ]` **Require bond for trustee and executor** — when off, the pour-over will also waives executor's bond and (where allowed) court inventory/accountings
- `[ ]` Limit trustee's duty to account (waive all non-mandatory accounting)
- `[ ]` **Protect U.S. trust status** (Foreign Trust Savings Clause; bars non-U.S. persons from controlling substantial decisions)
- `[ ]` **Allow Special Trustee** — always included if U.S. trust status protection is on
  - `___` Special Trustee Instructions (optional; e.g. pre-appoint someone over a specific asset) — Clause Library / Draft with AI
- `[ ]` Include reverse mortgage clause
- `[ ]` Include firearms administration provisions
- `[ ]` Power to manage §529 educational savings plans
- `[ ]` Power to manage farms and ranches
- `[ ]` Power to manage closely held businesses
- `[ ]` Power to manage professional corporations (license-gated distribution, else sell and distribute proceeds)
- `[ ]` Subchapter S stock provisions
- `[ ]` Allow trustee to change situs

### Trust Protector
- `[ ]` **Include provisions for a Trust Protector** — appointment, vacancy, powers, compensation, liability
  - ⚠ **hidden branch:** checking this may reveal Trust Protector identity/appointment and power-scope selections

### Retirement Accounts
- `[ ]` **Include provisions for distributing retirement accounts**
- `( )*` **Retirement Account Approach**
  - Pooled Retirement Assets (same terms as rest of trust; often preferred post-SECURE 2.0)
  - Separate Retirement Benefits Trusts (basic distribution patterns only)
- `( )*` **Trust Type for Retirement Accounts**
  - Automatic (conduit + accumulation; applied based on Eligible Designated Beneficiary status at death)
  - Conduit Trust
  - Accumulation Trust
- `( )*` **Funding Pecuniary Gifts**
  - Do not use retirement assets (shortfall lapses)
  - Use retirement assets only as a backup
- `[ ]` **Allow Trust Protector to convert conduit retirement trusts** — one-time power by Sept 30 of the year after death; requires Trust Protector + retirement provisions + conduit/automatic type
- `[ ]` **Enable BDOT withdrawal rights** — greater of taxable or accounting income, shifting tax to beneficiary under IRC §678; typically not used with a conduit trust
- `( )*` **Default Beneficiary for Retirement Accounts** (when the IRA designation is silent)
  - Spouse or Partner → issue → heirs at law
  - Issue (by right of representation) → heirs at law
  - Heirs at Law
  - Named Beneficiaries ⟶ 👤 select individuals

### Special Distributions
- `___*` **Special Distributions Age** (years) — under this age, inheritance may be applied for benefit rather than paid directly
- `[ ]` Allow trustee to hold distributions to young beneficiaries in a separate trust
- `[ ]` Allow direct distributions to young or incapacitated beneficiaries
- `[ ]` Include substance abuse provisions (examination, suspension, treatment payment)
- `[ ]` Include creditor claims and divorce provisions (auto-suspend distributions and withdrawal rights)
- `[ ]` Include slayer provision (wrongful killing disqualification; treated as predeceased without issue)
- `[ ]` Include marital deduction savings language in spendthrift clause — *forced on for this trust structure*
- `[ ]` Include contingent special needs trust provisions (for any beneficiary on public benefits at distribution)
- `[ ]` **Allow trustee to make distributions to dependents during settlor incapacity**
  - `[ ]` **Deduct these distributions?** — treat as advance on the dependent's inheritance
- `[ ]` Allow trustee to continue customary charitable giving during incapacity

### Administrative Provisions
- `[ ]` **Include a no-contest clause in the trust and pour-over will**
  - `[ ]` Name specific people in Settlor 1's no-contest clause ⟶ 👤 select people
  - `[ ]` Name specific people in Settlor 2's no-contest clause ⟶ 👤 select people
- `[ ]` Require mandatory arbitration for trust disputes — *unavailable in Massachusetts*
- `( )*` **Estate tax payment**
  - Apportion among beneficiaries
  - Pay from the trust before distribution (non-trust recipients still bear their own share)
- `( )*` **Representation Type**
  - By right of representation
  - Per stirpes
  - Per capita at each generation
- `___*` **Survivorship Requirement** (number of days a beneficiary must survive the settlor)

### Definitions
- `[ ]` Include detailed definition of discretionary distributions
- `[ ]` **Include detailed definition of education expenses**
  - `[ ]` Include arts education
  - `[ ]` Include vocational training
  - `[ ]` Include homeschooling (as part of a regular course of study)
- `[ ]` Include definition of disappearance

### Incapacity
- `[ ]` Include definition of incapacity
- `[ ]` Allow clinical psychologist to substitute for physician (global)
- `[ ]` Allow physician assistant or nurse practitioner to substitute for physician (global)
- `( )` **Incapacity of a settlor determined by:**
  - Attending and second physician
  - Single licensed physician (two if disputed)
  - Attending or any two physicians
  - Single physician or clinical psychologist (two if disputed)
  - Two licensed physicians
  - Two physicians or psychologists
  - One physician and one psychologist
  - Attorney-at-law
  - Governmental official
  - Trust protector
  - Successor trustee (sworn affidavit, if no dispute)
  - Majority of adult children
  - Incapacity panel (physician + attorney + third chosen by the first two)
  - Court of competent jurisdiction
  - Other settlor and successor trustee (agreement)
  - Custom ⟶ `___` custom language
- `( )` **Incapacity of a currently-acting trustee determined by:**
  - Attending and second physician
  - Single licensed physician (two if disputed)
  - Attending or any two physicians
  - Single physician or clinical psychologist (two if disputed)
  - Two licensed physicians
  - Two physicians or psychologists
  - One physician and one psychologist
  - Attorney-at-law
  - Governmental official
  - Trust protector
  - Court of competent jurisdiction
  - Custom ⟶ `___` custom language

---

## Page 6 — Successor Trustees

### Co-Trustee Decisionmaking
- `( )*` **If either trust ever has co-trustees, how should they decide?**
  - Co-trustees must act jointly (majority controls)
  - Co-trustees may act separately (single signature sufficient)
  - Do not include (silent)

### Successor Trustees — *asked separately for each settlor's trust*
- 👤 **Initial Co-Trustee** (optional; serves alongside the settlor)
- 👤* **First Successor Trustee(s)** — multi-select for co-trustees
- 👤 **Second Successor Trustee(s)** — backup layer; blank = none
- `___` Additional Successor Trustee Instructions (custom paragraph after the nominations) — Clause Library / Draft with AI

### Trustee Appointment Powers
- `[ ]` Allow a sole acting trustee to appoint co-trustees (service ends with the appointing trustee's)
- `[ ]` Allow an acting trustee to designate alternate successor trustees (serve only after all settlor-named successors are unavailable)

### Filling a Vacancy
- `( )*` **Successor Trustee Vacancy** — when all named successors are unable/unwilling, who appoints?
  - Majority of income beneficiaries may appoint any successor trustee
  - All income beneficiaries (unanimous) may appoint any successor trustee
  - Majority of income beneficiaries may appoint a professional fiduciary or corporate trustee only
  - Resigning trustee may appoint any neutral and disinterested party
  - Resigning trustee may appoint a professional fiduciary or corporate trustee only
  - Only the settlor(s) may appoint; if unable, court petition

---

## Pages 7 & 8 — Trust for Settlor 1 / Trust for Settlor 2
> Identical question sets, answered independently for each trust.

### Revocable Living Trust Information
- `___*` **Trust Name**
- `[ ]` **Is this a restatement of an existing trust?**
  - ⚠ **hidden branch:** checking this reveals original trust name, original execution date, prior amendment history, and original settlor/trustee fields

### Care of Pets
- `[ ]` **Include a pet trust** — pet care as part of HEMS during life, plus a pet trust on death or incapacity
  - ⚠ **hidden branch:** checking this reveals caretaker designation, funding amount, remainder on the pet's death, and care instructions

### Gifts, Debts & Advancements
- `[ ]` **Does the client wish to make a gift upon their death?**
  - ⚠ **hidden branch:** checking this reveals the specific-gift builder (recipient, gift type — cash / percentage / specific asset / real property, survivorship and lapse handling, contingent recipient)
- `[ ]` Forgive all debts owed by any beneficiary (blanket clause)
- `▤` **Individual Debts & Advancements** — add specific debts to forgive or lifetime advancements to account for (debtor, amount, treatment)

### Tangible Personal Property
- `[ ]` **Include a Personal Property Memorandum**
  - `[ ]` Limit memorandum to items under $10,000 individual FMV
  - `[ ]` Generate memorandum as a separate standalone document
  - `[ ]` Include memorandum instructions (how to complete, sign, store)
- `( )*` **Remainder of Tangible Personal Property**
  - Settlor Children → issue → residue
  - Settlor Issue → residue
  - Charity (trustee may distribute to local charities; rest to residue)
  - Trustee Discretion (distribute, sell, or dispose without equalizing)
  - Residue
  - Other ⟶ `___` custom language (Clause Library / Draft with AI)

### Distribution to Spouse/Partner
- `( )*` **Distribution to Spouse/Partner**
  - **Distribute outright** — spouse receives the entire remainder outright
  - **Distribute in trust** ⟶ unlocks the marital/bypass trust block below
  - **Do not distribute to spouse/partner** — estate goes to children or named individuals

#### ⟶ If "Distribute in trust": Trust(s) for Spouse
- `( )*` **Type of Marital Trust**
  - **QTIP** (Qualified Terminable Interest Property Trust) — defers tax while retaining control over final distribution
  - **General Power of Appointment Trust** — lifetime benefit with creditor protection; spouse may appoint at death
  - **No Marital Trust** — select if creating only a bypass/credit-shelter trust
- `( )*` **Marital Trust Invasion Powers**
  - No Invasion (trustee may still distribute principal for HEMS)
  - Invasion for HEMS
  - "5 by 5" Invasion Power (greater of $5,000 or 5% annually, plus HEMS)
  - Complete Invasion Power (any amount, any reason)
- `( )*` **QTIP Remainder Power of Appointment**
  - No appointment power
  - Limited testamentary power ⟶ select permitted appointees
- `[ ]` **Include QDOT language** (defer estate tax for a non-citizen spouse)
- `( )*` **Type of Bypass Trust** — *if no marital trust is created, a credit-shelter trust is mandatory*
  - **Bypass/Credit-Shelter Trust** — uses the estate tax exclusion; can benefit people beyond the surviving spouse
  - **Disclaimer Trust** — funded only if the surviving spouse disclaims
  - **No Bypass Trust**
- `[ ]` Should the Bypass Trust sprinkle to children/grandchildren?

### Distributions
> If the spouse receives outright, distribution to children only occurs if the spouse fails to survive. If the spouse's share is in trust, these provisions run on the surviving spouse's death.

- `[ ]` **Use Family Pot Trust** — shared pot until the youngest child reaches a specified age
  - ⚠ **hidden branch:** checking this reveals the pot-trust termination age and distribution standard
- `( )*` **How should the estate be distributed on the settlor's death?**
  - **Children Only – Outright in Equal Shares** (deceased child's share → their issue)
  - **Children Only – Equal Division into Separate Share Trusts** ⟶ unlocks **Children Trust Settings** (income/principal standards, staggered distribution ages, withdrawal rights, termination) ⚠ hidden until selected
  - **Children Only – Custom Distributions per Child** ⟶ unlocks per-child builder: unequal shares, outright vs. in trust, SNT, per-child contingent options, custom provisions for a deceased child's issue ⚠ hidden until selected
  - **Children and/or Other Beneficiaries – Custom Distributions per Beneficiary** ⟶ unlocks the full beneficiary builder (grandchildren, siblings, nieces/nephews, friends; unequal shares, distinct provisions, SNTs) ⚠ hidden until selected
- ⚠ **Distribution to Children's Issue** — a sub-section referenced by the options above; appears with the selected distribution mode
- ⚠ **Contingent Distribution** option — appears with separate-share trusts, for a child who dies with no living issue

### Distribution to Specific Beneficiaries
- `[ ]` **Distribute to Specific Beneficiaries** (residue to named individuals if no spouse/children provisions or none survive)
  - ⚠ **hidden branch:** checking this reveals the per-beneficiary share builder (drawn from the Contacts page)

### Secondary Named Beneficiaries
- `[ ]` **Add Secondary Beneficiaries** — a second fallback layer before the default provision
  - ⚠ **hidden branch:** checking this reveals the secondary beneficiary selection and shares

### Default Provision
- `( )*` **Default Provision** (residue not disposed of by any preceding provision)
  - Settlor's Children → issue → heirs at law
  - Settlor's Issue → heirs at law
  - Charity ⟶ select charity
  - Specific Individual/Group ⟶ select person or group; then their issue; then heirs at law
  - Trustee's Discretion
  - Heirs at Law
  - Other ⟶ `___` custom language (Clause Library / Draft with AI)

---

## Page 9 — Asset Schedules

- `[ ]` **Use asset schedules** (off = omit all asset schedule documents)
- `[ ]` Include signature block on each settlor's Schedule A
- `[ ]` Include general catchall language on each settlor's Schedule A ("All real property owned by me…")
- `[ ]` **Include a schedule of non-trust assets for each settlor**
  - ⚠ **hidden branch:** checking this reveals a non-trust asset table per settlor
- `( )` **Format for asset schedules**
  - Assets in table format (compact, scannable)
  - Assets in paragraph format (narrative, grouped by asset type)
  - Clear selection
- **Import assets from files** (max 50)
- `▤` **Schedule of Assets** — three tables, each with Add Asset and drag-to-reorder:
  - **Jointly-Owned Property**
  - **Settlor 1's Property**
  - **Settlor 2's Property**
  - Per asset: **Type**, Name/description, Additional Info (e.g. county for real property), Value *(value is for internal reference only — never printed on the Schedule)*
- ⚠ Reciprocal-trust warning: jointly-owned assets appear on **both** settlors' individual trust schedules — confirm this is intended and describe assets precisely

---

## Page 10 — PoA Provisions (applies to all POA documents in the package)

- `[ ]` Include Notice Page (statutory notice of rights and responsibilities)
- `[ ]` Preserve any existing bank and institutional powers of attorney (long-form revocation won't revoke them)
- `( )*` **Compensation for Agents**
  - Prevailing rate for professional fiduciaries
  - Reasonable compensation
  - No compensation
- `( )*` **Should co-agents serve jointly, separately, or should the document be silent?**
  - Co-agents must act jointly (unanimous)
  - Co-agents may act separately
  - Do not include (silent)
  - *Note: banks may refuse co-agents as a matter of policy*
- `( )` **Acceptance of Agent Signature Page**
  - Include Acceptance of Appointment (signature page + notary block)
  - Do Not Include Acceptance of Appointment

### Long-Form POA Provisions
**Gifting Powers**
- `[ ]` **Allow gifts**
  - ⚠ **hidden branch:** checking this reveals gift limits (annual exclusion vs. unlimited), permitted donees, and self-gifting restrictions

**Trust Powers** *(unusual; typically granted for a specific purpose such as Medicaid planning)*
- `[ ]` Agent may create trusts (revocable and/or irrevocable) for the principal's benefit
- `[ ]` Agent may create trusts for dependents
- `[ ]` Allow agent to be trustee of a trust they create
- `[ ]` Agent may create Medicaid planning trusts
- `[ ]` Agent may modify sole-settlor trusts
- `[ ]` Agent may modify joint trusts (lets a spouse/partner modify the joint trust during incapacity)

**Miscellaneous Special Powers**
- `[ ]` Allow delegation of authority to professionals (banks may not allow)
- `[ ]` Prohibit arbitration
- `[ ]` Power to manage §529 educational savings plans
- `[ ]` Allow agent to access medical information (also adds the POA to the HIPAA Authorization)
- `[ ]` Power to control digital assets and devices
- `[ ]` Allow self-designation for beneficiary designations *(use with caution — abuse risk)*

---

## Pages 11 & 12 — Power of Attorney (Settlor 1) / (Settlor 2)
> Identical question sets, answered independently for each principal.

- `( )` **When should the power of attorney be effective?**
  - **Springing** (authority begins on incapacity)
  - **Immediate**
  - Clear selection
  - *A third pattern is described: immediate for the initial agent, springing for successors*
- 👤* **First Attorney-in-Fact(s)** — multi-select for co-agents
- 👤 **Backup Attorney-in-Fact(s)** — blank = none
- 👤 **(Alternate) Conservator of the Estate** — the first nominee is always the then-acting attorney-in-fact; this is the alternate

### Attorney-in-Fact(s) Powers
- `[ ]*` **Basic Powers** — multi-select, or "All powers in this list":
  - Real property transactions
  - Tangible personal property transactions
  - Stock and bond transactions
  - Commodity and option transactions
  - Banking and other financial institution transactions
  - Business operating transactions
  - Insurance and annuity transactions
  - Estate, trust, and other beneficiary transactions
  - Claims and litigation
  - Personal and family maintenance
  - Benefits from Social Security, Medicare, Medicaid, other governmental programs, or civil/military service
  - Retirement plan transactions
  - Tax matters
- `___` **Additional Powers** (Clause Library / Draft with AI)
- `▤` **Name Specific Businesses** the agent may manage (named in the "Operate Business" section)
- `___` **Additional Limitations** (Clause Library / Draft with AI)

---

## Pages 13 & 14 — Health Care Proxy (Settlor 1) / (Settlor 2)
> Identical question sets, answered independently for each principal.

- `[ ]` Include Notice Page (explains structure, agent authority, principal's rights)
- `[ ]` **Leave health care instructions blank** — skips the instruction and organ-donation questions so the client completes them at execution; agent selection is still required

### Health Care Instructions
- `( )*` **Medical Treatment for Advanced Illness**
  - Prolong life (within generally accepted health care standards)
  - Prolong life, but no CPR or mechanical ventilation
  - Do Not Prolong Life (comfort care only — pain, anxiety, comfort)
  - Other / Custom Instructions ⟶ `___`
- `[ ]` Receive hygiene and comfort care (including pain medication that may shorten life)
- `[ ]` Wish to die at home rather than in a hospital or nursing home
- `[ ]` Decline autopsy if not legally required
- `( )` **Anatomical gifts preference**
  - Yes, make anatomical gifts
  - Defer to healthcare agent or donor registry
  - No, do not make anatomical gifts
  - Clear selection
- `___` Restrictions on anatomical gifts (Clause Library / Draft with AI)
- `___` Other Healthcare Wishes (Clause Library / Draft with AI)

### Healthcare Agents
- `[ ]` **Should the agent's authority be effective immediately?** — if not, authority begins when the primary physician determines the client can no longer make healthcare decisions
- `[ ]` **Include post-death authority and instructions for final disposition** ⟶ optional specific disposition instructions
- `___` Limitations on agent's authority while living (Clause Library / Draft with AI)
- `___` Limitations on agent's authority after death (e.g. organ donation, autopsy) (Clause Library / Draft with AI)
- 👤* **First Agent**
- 👤 **Backup Agent(s)** — blank = none
- `( )*` **How should co-agents resolve disagreements?**
  - Do not include (silent)
  - Majority rules (unanimity preferred)
  - Unanimous agreement required (deadlock → first-named agent decides)
  - First-named agent has final authority

### Physician Designations
- `▤` **Primary Physician** — add primary physician (name and contact)

---

## Pages 15 & 16 — Dementia Directive (Settlor 1) / (Settlor 2)
> **Currently skipped** — the Dementia Directive is not selected on Page 1. The page reads: "If you are not including the dementia directive, proceed to the next page."

⚠ **hidden branch:** enabling the Dementia Directive on Page 1 opens a full stage-based questionnaire — typically care and treatment preferences at mild, moderate, and severe stages of dementia (hospitalization, antibiotics, artificial nutrition and hydration, CPR, comfort-focused care), plus living-situation and caregiving wishes.

---

## Pages 17 & 18 — Healthcare Forms (Settlor 1) / (Settlor 2)

### HIPAA Authorization
> Automatically includes all agents designated in the Advance Health Care Directive.

- `[ ]` Include the general (financial) durable power of attorney in the HIPAA authorization — also adds medical-information access provisions to the POA document
- `[ ]` Include trustee and successor trustees in the HIPAA authorization (available whether or not a trust is being prepared concurrently)
- `( )` **List fiduciaries by name in the HIPAA authorization?**
  - List fiduciaries by name
  - Use general language only (e.g. "any agent under a general power of attorney created by me")
- 👤 **Additional HIPAA Agents** — extra people who may access medical information (trustees, healthcare agents, and attorneys-in-fact are already covered if checked above)

### Visitation Authorization
> **Currently excluded** — not selected on Page 1.

⚠ **hidden branch:** enabling Visitation Authorization opens designation of permitted visitors, optionally excluded visitors, and any visitation instructions.

---

## Pages 19 & 20 — Post-Death Choices (Settlor 1) / (Settlor 2)

### Disposition of Remains
> **Currently excluded** — Final Disposition is not selected on Page 1.

⚠ **hidden branch:** enabling Final Disposition opens the disposition questionnaire — typically: disposition agent designation and alternates; burial vs. cremation vs. donation; cemetery/plot or disposition of ashes; funeral, memorial, or religious service preferences; casket/urn and marker instructions; prepaid arrangements; and any custom instructions.

---

## Pages 21 & 22 — Will & Executors (Settlor 1) / (Settlor 2)
> Asked per testator, with one difference: the **Executor Powers** block appears only on Settlor 1's page and applies to both wills.

### Executor Information
- `[ ]` **Name spouse/partner as first executor** — spouse is first nominee; other selections serve if unavailable
- `[ ]` **Make executors the same as the trustees** (same people, same order)
  - ⚠ **unchecking this ⟶ executor selection pickers** for the Pour-Over Will (first executor, alternates, co-executor handling)

### Executor Powers *(Settlor 1's page only — governs both wills)*
- `[ ]` Allow executor to pay taxes, debts, and expenses from the probate estate if not paid by the trust
- `[ ]` Allow executor to manage digital assets (RUFADAA)
- `[ ]` Include "Distribution in Cash or Kind" power (sell or lease estate property; distribute in cash or in kind)

### Testamentary Power of Appointment
- `[ ]` **Exercise a testamentary power of appointment** — replaces the will's standard non-exercise provision
  - ⚠ **hidden branch:** checking this reveals the source power (creating instrument and date) and the custom exercise language

---

## Page 23 — Deeds

- `▤` **Transfer Deeds** — Add Transfer Deed
  - Per deed:
    - Property address (street, city, state, ZIP) and **County**
    - `___` Map-Block-Lot
    - `( )` **Deed Type** — e.g. Quitclaim Deed *(state-dependent list: quitclaim, warranty, grant, special warranty, etc.)*
    - `___` **Grantor** — current vesting language (e.g. "…husband and wife, as TENANTS BY THE ENTIRETY")
    - `___` **Grantee** — trustee vesting language (e.g. "[Name], as Trustee of THE [TRUST NAME], U/A dated ______, and any amendments thereto")
    - `___` **Legal Description** — full metes-and-bounds / parcel text (multiple parcels supported)
  - Edit / Delete per deed

---

## Page 24 — Transfers & Assignments

> Warns when an asset on the Asset Schedules page has no transfer entry, and offers **Create Missing Transfer**.

- `▤` **Transfer bank accounts to trust** — institution, account type, last digits, owner
- `▤` **Transfer securities and investment accounts to trust** (non-retirement)
- `▤` **Transfer retirement accounts to trust** (tax-deferred accounts)
- `▤` **Update life insurance & annuity beneficiaries** — policies naming the trust as beneficiary
- `▤` **Transfer business entities to trust** — business interests

### Affidavits
- `▤` **Properties for Affidavits** — Add Affidavit Property *(do not re-enter a property already added for a deed)*
- `▤` **Affidavits** — Add Affidavit, selecting the property from the dropdown

---

## Page 25 — Signing Information

### Acknowledgments
- `( )*` **Acknowledgment of Trust** — Notary / Two witnesses / Both
- `[ ]` **Combine settlor and trustee signatures** — one "Settlor and Trustee" line each, instead of signing twice
- `( )*` **Acknowledgment of Power of Attorney** — Notary / Two witnesses
- `( )*` **Acknowledgment of Advance Health Care Directive** — Notary / Two witnesses
- `( )*` **Acknowledgment of Healthcare Authorizations** — Notary / Two witnesses
- `( )*` **Will the healthcare directive be signed in a nursing home?** — Yes / No
- `[ ]` **Include a Self-Proving Affidavit with the Will**

### Signing Information
- `___*` **Signing State**
- `___*` **Signing County** (full name, e.g. "Norfolk County" — appears in the notary acknowledgment)
- `___` Signing City
- `___` Full Name of Notary
- `[ ]` **Include Witness Phones** — adds phone fields here and phone lines in all witness blocks
- `___` First Witness Name / Address / Phone
- `___` Second Witness Name / Address / Phone
- `___` **Signing Date** — Today / Select a date

---

## Cross-Cutting Mechanics

- **Save / Create Docs** are available on every page; the interview autosaves (timestamp shown in the sidebar).
- **Clause Library** and **Draft with AI** appear on every long-text field, so any narrative provision can be pulled from a saved clause or generated.
- **Reciprocal-trust structure:** every settlor-specific page (Trust, POA, Health Care Proxy, Dementia Directive, Healthcare Forms, Post-Death Choices, Will & Executors) is asked twice — once per settlor — and the answers are independent.
- **Contacts drive everything:** a person must exist on Page 3 (or be an auto-added spouse/adult child) before they can be picked as a trustee, agent, guardian, executor, or beneficiary. Every picker offers "Add a new contact" inline.
- **Page 1 gates later pages:** unselected documents collapse their pages to a one-line skip notice (currently true for the Dementia Directive, Visitation Authorization, and Final Disposition).

---

