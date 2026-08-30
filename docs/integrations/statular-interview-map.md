# Statular Interview — Complete Question & Decision Map

> Captured from Statular's 25-page interview by the firm, with every conditional
> branch opened in the live interview. Source of the verbatim question and option
> wording in `lib/designSheet/statularInterviewMap.ts`; the design sheet exports
> to Statular's file import in this vocabulary — see "Exporting to Statular" in
> `docs/design-sheet-sections/trust-details.md`.
>
> A question here that the map module does not cover is not a bug: many of the
> branches below (the per-child distribution builders, the Dementia Directive,
> Visitation Authorization, POA gifting sub-options) have no design-sheet field
> behind them at all, so there is nothing to export. Unmapped answers that *do*
> have a field still export, under "Additional answers" with our own labels.
>
> **The "Changes Made to Matter 8312" section at the end is an operational
> warning, not documentation.** It records live-matter toggles left switched on
> during capture. Read it before generating documents on that matter.

**Legend**
- `( )` single-select (radio) · `[ ]` toggle/checkbox · `___` free text · `▤` repeating list (add rows) · `👤` contact picker
- `*` required
- **⟶ unlocks:** selecting/checking this reveals additional questions
- Every conditional branch below was opened in the live interview and its revealed fields recorded. Nothing is inferred.

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
- `[ ]` **Include a Standby Guardian Designation** — separate document; authority activates on incapacity, debilitation, or death

**⟶ Either checkbox opens one shared GUARDIAN DESIGNATIONS block** (there is no separate standby nominee set — the same nominees serve both):
> "The clients are each the guardian. Please select the option(s) to serve as first backup guardian and additional backup guardians."

- 👤* **First Guardian** — multi-select (co-guardians allowed)
- 👤 **Backup Guardian(s)** — *appears only once a First Guardian is selected*; multi-select; blank = none
- `___` Additional Guardian Instructions (optional custom paragraph after the standard nomination language) — Clause Library / Draft with AI

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
  - `[ ]` **Include summary of trust protector provisions for client** — plain-language client-facing summary
  - `[ ]` **Include a Trust Protector Appointer** — names a separate person who may appoint, remove, replace, and designate Trust Protectors
    > The Appointer may act only after the settlor(s) are deceased or incapacitated, and is not the same person as the Trust Protector. **The attorney is commonly the Trust Protector Appointer.**
    - 👤* **Trust Protector Appointer** — incl. **"Designate my law firm as the Trust Protector Appointer"**
    - 👤 **Successor Trust Protector Appointer** — backup
    - `( )*` **May the Appointer appoint themselves as Trust Protector?** — Yes / No / Omit (silent)
  - 👤 **Initial Trust Protector** — incl. **"Designate my law firm as the Trust Protector"**; leave blank and the office starts vacant, with the settlor(s) able to appoint later

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
  - **Named Beneficiaries** ⟶ **Select Beneficiaries for Retirement Accounts*** — multi-select. Groups and organizations are deliberately excluded, since only individuals qualify for see-through trust treatment. A validation warning appears if the option is selected with nobody picked: the generated documents leave the selection blank.

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
  - `[ ]` **Name specific people in Settlor 1's no-contest clause** ⟶ 👤 **People who will be specifically named** — multi-select from all beneficiaries and children; "These individuals will be named in the no-contest clause and disinherited if they contest the trust."
  - `[ ]` **Name specific people in Settlor 2's no-contest clause** ⟶ same picker, scoped to Settlor 2
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
  - `[ ]` **Import trust details from original trust**
  - `___*` **Original Trust Name**
  - `___*` **Original Trust Date** (date the original trust was established; "Today" shortcut)
  - `( )*` **Restatement Recitals** — how the document describes the trust's history and the authority for the restatement
    - Use Statular's standard recitals (built from the structured answers above)
    - Draft custom trust-history and authority recitals (for more complicated histories)
  - `___` **Original Amendment Clause** (optional) — clause/section number granting authority to restate or amend. *Supplying it makes the next field required.*
  - `___*` **Original Amendment Text** — the actual text of that clause; **Extract from File** available

### Care of Pets
- `[ ]` **Include a pet trust** — pet care as part of HEMS during life, plus a pet trust on death or incapacity
  - `▤*` **Pets Covered by the Pet Trust** — add specific pets, classes of pets, and optionally all other pets owned at the relevant death or incapacity
  - `( )` **Include offspring in gestation** — Pets alive during the settlor's lifetime *and* offspring in gestation / Only pets alive during the settlor's lifetime
    > **Disabled in Massachusetts** — the matter state's animal-trust law expressly limits coverage to animals alive during the settlor's lifetime.
  - `( )*` **Pet Trust Funding** — Dollar amount / Percentage / Custom
  - `___*` **Pet Trust Amount** ($ total placed in the Pet Trust)
  - `___*` **Pet Trust Stipend** ($ the trustee may pay the caretaker monthly)
  - `[ ]` Request that pets be kept together in the same home
  - `[ ]` Require pets to live in the same home as the caretaker
  - `[ ]` Require that pets not be euthanized unless necessary for their health and well-being
  - 👤* **First Caretaker**
  - 👤 **Second Caretaker**
  - `___*` **Contingent Placement** — person, shelter, rescue, or adoption organization if no named caretaker is available
  - 👤* **Contingent Beneficiary** — receives any assets remaining when the Pet Trust terminates

### Gifts, Debts & Advancements
- `[ ]` **Does the client wish to make a gift upon their death?**
  - `▤` **Gifts on Settlor's Death** — **+ New Gift** opens an **Add Gift** dialog:
    - `( )*` **Gift Type** — Tangible Property / Cash / Real Property / Business Interest / Other
    - 👤* **Beneficiary** — multi-select from all beneficiaries
    - `( )` **If gift cannot be made** — Gift lapses (no fallback, default) / Beneficiary's issue (per stirpes) / Beneficiary's heirs at law / Specific beneficiary / Settlor's heirs at law / Trustee discretion among trust beneficiaries / Trustee full discretion / Custom fallback clause
    > A gift that can't reach the primary beneficiary or the fallback lapses and is added back to the residue.
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
  - `___*` **Family Pot Termination Age** — the age of the *youngest* child at which the pot terminates (defaults to 18)
  - `[ ]` **Allow advancements from the Family Pot Trust?** — trustee may advance principal for weddings, a house, starting a business; advancements are deducted from that child's share when the pot splits
- `( )*` **How should the estate be distributed on the settlor's death?** — the four options open very different builders:

#### ⟶ A. Children Only – Outright in Equal Shares
No trust settings. A deceased child's share passes to their issue per the **Distribution to Children's Issue** section below.

#### ⟶ B. Children Only – Equal Division into Separate Share Trusts
Opens **CHILDREN TRUST SETTINGS**, applied uniformly to every child:
- **QUICK FILL:** one-click **Divorce Protection Trust** preset
- `( )*` **Share Trust Trustee** — Then-Serving Trustee / Beneficiary / **Bifurcated Trusteeship** (independent trustee holds sole distribution authority; the beneficiary becomes Administrative Co-Trustee for investments at the trustee age) / Other Fiduciary / Custom Trustee Provisions
- `( )*` **Trust Income** — Mandatory / Unitrust / HEMS (Support Trust) / Discretionary Trust / Discretionary Support (Hybrid) / Discretionary if Independent Trustee
- `( )*` **Trust Principal Option** — Specified Ages / Lifetime
- `( )*` **Distribution Timing** — By Age / Years After Death
- `[ ]` **Allow Trust to Continue** — trust may continue after fully vesting (retains spendthrift protection); otherwise it terminates and distributes outright
- `▤` **Tiered Distributions** — ages and fractions, must total 1. Quick fill: 100% at 25 · 100% at 21 · 100% at 18 · ½ at 25, ½ at 30 · ⅓ at 25/30/35 · ⅓ at 21/25/30 · ⅓ at 18/25/30
- `( )*` **Contingent Distribution on Child's Death** (child dies with no living issue) — Other Children / Settlor's Issue / Child's Estate / Child's Spouse / Residue / Heirs at Law / Charity / Specific Individual/Group / Other-Terms Specified
- `( )*` **Power of Appointment** — No appointment power / Limited testamentary power ⟶ select permitted appointees
- `___` Additional Distribution Instructions — Clause Library / Draft with AI

#### ⟶ C. Children Only – Custom Distributions per Child
Opens a **Custom Distributions** list; **+ New Distribution** opens an **Add Distribution** dialog *per child*:
- 👤* **Select Child**
- `___*` **Share Percentage** (%)
- `( )*` **Distribution Type** — Outright / Separate Share Trust / **Special Needs Trust** / Custom Provisions / **Existing Trust**
- **QUICK FILL:** Divorce Protection Trust
- `( )*` **Share Trust Trustee** — same five options as B
- `( )*` **Income Distribution** — same six options as B
- `( )*` **Trust Principal Option** — Specified Ages / Lifetime
- `[ ]` **Allow Trust to Continue?**
- `▤` **Trust Distributions** — tiered ages/fractions with the same seven quick fills
- `( )*` **Power of Appointment** — No appointment power / Limited testamentary power
- `( )*` **Contingent Distribution** (on the beneficiary's death) — Other Shares (Pro Rata) / Beneficiary's Issue / Beneficiary's Issue (Trust) / Beneficiary's Issue, Fallback to Settlor's Issue or Heirs / Beneficiary's Estate / Beneficiary's Spouse / Settlor's Issue / Heirs at Law / Residue *(flagged **NOT RECOMMENDED**)* / Other-Terms Specified
- `( )` **If the Beneficiary Has No Living Issue** — optional second-order fallback: Other Shares (Pro Rata) / Settlor's Issue / Settlor's Children / Heirs at Law / Beneficiary's Estate / Beneficiary's Spouse / Residue / Other-Terms Specified
  > Without a selection here, the share passes to the beneficiary's issue with no further direction.

#### ⟶ D. Children and/or Other Beneficiaries – Custom Distributions per Beneficiary
Suppresses the children-only trust settings entirely and routes all drafting into the **Distribution to Specific Beneficiaries** section below, so children, grandchildren, siblings, nieces/nephews, and friends are all built the same way.

### Distribution to Children's Issue
*(present with options A, B, and C)*
- `( )*` **If a child is deceased, how should that child's issue receive their share?**
  - Distribute Outright
  - **Distribute in Trust** ⟶ opens **TRUST SETTINGS FOR ISSUE OF DECEASED CHILDREN** (below)
  - Use the Same Trust Terms as Living Children
  - Do Not Distribute to Children's Issue

#### ⟶ Trust Settings for Issue of Deceased Children
- `( )*` **Share Trust Trustee** — Then-Serving Trustee / Beneficiary / Bifurcated Trusteeship / Other Fiduciary / Custom Trustee Provisions
- `( )*` **Trust Income** — Mandatory / Unitrust / HEMS / Discretionary / Discretionary Support (Hybrid) / Discretionary if Independent Trustee
- `( )*` **Trust Principal Option** — Lifetime / Tiered
- `( )*` **Distribution Timing** — By Age / Years After Death
- `[ ]` **Allow Trust to Continue?** — continues after all principal vests, until the beneficiary requests distribution
- `▤` **Tiered Distributions** — same seven quick fills
- `( )*` **Contingent Distribution on Beneficiary Death** — Settlor's Children / Settlor's Issue / Beneficiary's Estate / Beneficiary's Spouse / Residue
- `( )*` **Power of Appointment** — No appointment power / Limited testamentary power

### Distribution to Specific Beneficiaries
- `[ ]` **Distribute to Specific Beneficiaries** (residue to named individuals if no spouse/children provisions or none survive)
  - `▤` **Custom Distribution** — **+ New Distribution** per beneficiary; percentages must total 100
  - `___` Additional Beneficiary Distribution Instructions — Clause Library / Draft with AI

### Secondary Named Beneficiaries
- `[ ]` **Add Secondary Beneficiaries** — a second fallback layer before the default provision
  - `▤` **Secondary Beneficiary Distributions** — percentages must total 100; these beneficiaries take only if **all** primary named beneficiaries predecease the settlor
  - `___` Additional Secondary Beneficiary Distribution Instructions

### Tertiary Named Beneficiaries
> This entire section is itself hidden until **Add Secondary Beneficiaries** is checked — a third fallback layer that is easy to miss.

- `[ ]` **Add Tertiary Beneficiaries** — takes only if all primary *and* secondary beneficiaries predecease the settlor
  - `▤` **Tertiary Beneficiary Distributions** — percentages must total 100
  - `___` Additional Tertiary Beneficiary Distribution Instructions

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
  - `[ ]` **Include explanation of schedule of non-trust assets in the trust** — the non-trust schedule (typically Schedule "B" or "D") is *not* referenced in the trust body by default; this adds a brief reference
  - Adds three further tables: **Joint Non-Trust Property**, **Settlor 1's Non-Trust Property**, **Settlor 2's Non-Trust Property**
  > Reciprocal trusts get two separate Schedule Bs. Assets under Joint Non-Trust Property appear on **both** settlors' Schedule B.
- `( )` **Format for asset schedules**
  - Assets in table format (compact, scannable)
  - Assets in paragraph format (narrative, grouped by asset type)
  - Clear selection
- **Import assets from files** (max 50)
- `▤` **Schedule of Assets** — three tables, each with Add Asset and drag-to-reorder:
  - **Jointly-Owned Property**
  - **Settlor 1's Property**
  - **Settlor 2's Property**
  - **Add Asset** dialog: **Import asset from file**; `( )*` **Asset Type** — Real Property / Bank Account / Life Insurance / Retirement Account / Investment Account / Personal Property / Business Interest / Annuity / Vehicle / Digital Asset / Mineral Interest / Firearms / Other; then Name/description, Additional Info (e.g. county), Value
  - `( )*` **Schedule** — which table the asset lands in: Jointly-Owned / Settlor 1's / Settlor 2's / Joint Non-Trust / Settlor 1's Non-Trust / Settlor 2's Non-Trust
  - *Value is captured for internal reference only and is never printed on the Schedule.*
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
  > Warning shown if enabled with no recipient category selected: the generated POA prints a `[PERMITTED RECIPIENTS]` placeholder.
  - `[ ]` Allow gifts to dependents
  - `[ ]` Allow gifts to charity
  - `[ ]` **Allow gifts to other specific individuals** ⟶ adds a **Permitted Beneficiaries for Gifts from Attorney-in-Fact** picker on each principal's own POA page
  - `[ ]` Limit gifts to annual exclusion amount (annual federal gift tax exclusion, as adjusted by the IRS)
  - `( )` **Allow Self-Gifting** — None / Only with an ascertainable standard (HEMS) / Other ⟶ `___` completes the sentence "My agent may make gifts in favor of themselves only…"
  - `( )` **Additional Limitations on Gifting** — Full Discretion / **Equal Gifts to Same Generation** (a gift to one person requires equal-value gifts to all other permissible donees in that generation) / **Established Pattern** (only per the principal's pattern of giving over the prior 5 years, or the 5 years before incapacity)

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
- 👤 **Permitted Beneficiaries for Gifts from Attorney-in-Fact** — *appears only when "Allow gifts to other specific individuals" is enabled on the PoA Provisions page*

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
> Collapses to a one-line skip notice unless **Dementia Directive** is selected on Page 1. Enabled, it asks the same two questions at each of three stages, each with a plain-language description of that stage.

### Mild Dementia
> Frequent memory lapses, especially recent events. Cooking gets harder; driving may be unsafe. Can still communicate, recognize loved ones, and enjoy activities.

- `( )` **Medical treatment at this stage** — Prolong Life / Prolong life, but no CPR or mechanical ventilation / Comfort Care Only / Clear selection
- `( )` **Assisted feeding preference** — Receive assisted feeding *(only while the client appears receptive; withheld if they are unwilling, spit out food, or choke)* / Do not receive assisted feeding *(even if they appear receptive)* / Clear selection

### Moderate Dementia
> Struggles to communicate and understand surroundings. Needs daily help dressing and using the bathroom. May be confused, upset, or paranoid; may also seem calm and content.

- `( )` **Medical treatment at this stage** — same three options
- `( )` **Assisted feeding preference** — same two options

### Severe Dementia
> No longer recognizes family. May be agitated, disruptive, or awake at night. Needs 24/7 care for all daily activities.

- `( )` **Medical treatment at this stage** — same three options
- `( )` **Assisted feeding preference** — same two options

### Additional Instructions
- `___` Any further wishes regarding medical care in dementia — Clause Library / Draft with AI

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
> Hidden unless **Visitation Authorization** is selected on Page 1.
> Purpose, per the form: gives people not traditionally recognized as family priority visitation rights — "especially important for same-sex, polyamorous, or other non-traditional couples, whose wishes about visitation rights may not always be respected by family members or hospital staff."

- 👤 **Priority Visitors** — multi-select. *Include the form without selecting anyone and the visitor list prints blank.*
- `___` **Prohibited Visitors** — anyone who should NOT be allowed to visit; the form asks for names in uppercase for consistency

---

## Pages 19 & 20 — Post-Death Choices (Settlor 1) / (Settlor 2)
> Collapses to a skip notice unless **Final Disposition** is selected on Page 1.

### Disposition of Remains
- `( )` **How should the remains be handled?**
  - Cremation
  - **Chemical Cremation (alkaline hydrolysis)**
  - Burial
  - No specific wishes *(lets the designated agent decide)*
  - Leave blank in document *(prints a blank to fill in later)*
  - Other ⟶ `___` custom disposition instructions (Clause Library / Draft with AI)
- `___` **Funeral Instructions** — funeral or burial arrangements
- `___` **Pre-Need/Post-Death Arrangements** — arrangements already made (burial plot, funeral home contract)
- `___` **Other Disposition Instructions** — ashes, soil, other remains, family or cultural traditions
- `[ ]` **Special Wishes** (multi-select)
  - Preference for donations — charitable donations in lieu of flowers
  - **Prohibit AI replicas or digital recreations** — expressly bars AI replicas, digital recreations, or virtual representations of the deceased

### Disposition Agent Designations
- `[ ]` **Make disposition agents the same as healthcare agents** — same people, same order
  - **⟶ unchecking reveals** 👤 **First Agent** and 👤 **Second Agent** pickers
- `[ ]` **Include disposition agent acceptance** — adds a written acceptance section for the agents to sign

---

## Pages 21 & 22 — Will & Executors (Settlor 1) / (Settlor 2)
> Asked per testator, with one difference: the **Executor Powers** block appears only on Settlor 1's page and applies to both wills.

### Executor Information
- `[ ]` **Name spouse/partner as first executor** — spouse is first nominee; other selections serve if unavailable
- `[ ]` **Make executors the same as the trustees** (same people, same order)
  - **⟶ unchecking reveals:**
    - 👤* **First Executor** — multi-select for co-executors
    - 👤 **Backup Executor(s)** — multi-select; blank = none

### Executor Powers *(Settlor 1's page only — governs both wills)*
- `[ ]` Allow executor to pay taxes, debts, and expenses from the probate estate if not paid by the trust
- `[ ]` Allow executor to manage digital assets (RUFADAA)
- `[ ]` Include "Distribution in Cash or Kind" power (sell or lease estate property; distribute in cash or in kind)

### Testamentary Power of Appointment
- `[ ]` **Exercise a testamentary power of appointment** — replaces the will's standard non-exercise provision
  - `___*` **Exercise Provision** — the complete operative language to appear under the will's "Testamentary Power of Appointment" heading (Clause Library / Draft with AI). *Free text only — the form does not ask separately for the creating instrument or its date.*

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

## Coverage Note

Complete. Every page was walked and every conditional branch was opened in the live interview, so the options above are recorded as the software actually renders them — nothing is inferred from labels.

### Branches opened during this pass

Guardian nominations · standby guardian · Trust Protector (plus Appointer and self-appointment) · retirement Named Beneficiaries · no-contest naming · trust restatement · pet trust · gifts on death (with the Add Gift dialog) · Family Pot Trust · all four distribution modes (with the per-child Add Distribution dialog) · Distribution to Children's Issue and its trust settings · specific / secondary / **tertiary** beneficiaries · non-trust asset schedules (with the Add Asset dialog) · POA gifting powers · Dementia Directive · Visitation Authorization · Final Disposition · executor selection · testamentary power of appointment · disposition agents.

### Things worth knowing that only surfaced by opening the branches

- **A third fallback layer exists.** Tertiary Named Beneficiaries is invisible until Secondary is checked. A plan drafted without checking Secondary never reveals that a third layer was available.
- **Massachusetts disables the pet-trust gestation option.** The control renders but is locked, with an explanation — state law limits coverage to animals alive during the settlor's lifetime.
- **Two silent-placeholder traps.** Enabling POA gifting without picking a recipient category prints a literal `[PERMITTED RECIPIENTS]` placeholder into the document. Selecting Named Beneficiaries for retirement accounts without picking anyone leaves the selection blank. Both warn on screen; neither blocks generation.
- **"Residue" is flagged NOT RECOMMENDED** as a contingent distribution inside the per-child Add Distribution dialog — the only place in the interview where an option carries an explicit recommendation against it.
- **The firm can be named as its own fiduciary.** "Designate my law firm as the Trust Protector" and "…as the Trust Protector Appointer" are built-in options, and the form notes the attorney is commonly the Appointer.
- **The custom per-child dialog has a two-level fallback** — Contingent Distribution, then a separate "If the Beneficiary Has No Living Issue" question. Skip the second and the share passes to the beneficiary's issue with no further direction.
- **Final Disposition includes an AI-replica prohibition** — an option to expressly bar AI replicas, digital recreations, or virtual representations of the deceased.
- **Executor Powers is a package-level block**, appearing only on Settlor 1's page and governing both wills, unlike every other per-settlor section.

---

## Changes Made to Matter 8312 During Capture

Reaching the branches required turning options on in the live interview. **These were left ON, not reverted.** Review and reset before generating documents.

**Page 1 — Document Selection:** enabled Dementia Directive, Visitation Authorization, Final Disposition.

**Page 4 — Guardians:** enabled Nominate guardians in will, Standby Guardian Designation; selected Settlor 1 as First Guardian.

**Page 5 — Living Trust Details:** enabled Trust Protector, client summary, Trust Protector Appointer; set retirement Default Beneficiary to Named Beneficiaries; enabled naming specific people in Settlor 1's no-contest clause.

**Page 7 — Trust for Settlor 1:** enabled restatement, pet trust, gifts on death, Family Pot Trust, Distribute to Specific Beneficiaries, Secondary Beneficiaries, Tertiary Beneficiaries; changed the distribution mode to *Children and/or Other Beneficiaries – Custom Distributions per Beneficiary*.

**Page 9 — Asset Schedules:** enabled the non-trust asset schedule.

**Page 10 — PoA Provisions:** enabled Allow gifts and Allow gifts to other specific individuals.

**Page 19 — Post-Death Choices (Settlor 1):** unchecked "Make disposition agents the same as healthcare agents."

**Page 21 — Will & Executors (Settlor 1):** unchecked "Make executors the same as the trustees"; enabled testamentary power of appointment.

No dialog was saved — the Add Gift, Add Distribution, and Add Asset dialogs were all cancelled, so no gifts, distributions, or assets were added. Nothing on Settlor 2's pages was touched, and no existing data was deleted or overwritten.

**The distribution mode change on Page 7 is the one to look at first** — it moved Settlor 1's trust off its original setting, and that drives how the whole estate is divided.
