/**
 * AUBREY LAW — CLAUSE LIBRARY
 * lib/drafting/clauses.ts
 *
 * Placeholders use the EXISTING [SQUARE BRACKET] format from buildClientVariables().
 * This integrates directly with app/api/admin/draft/[sheetId]/generate/route.ts.
 *
 * Conditional clauses have an `include` function — returns true to include.
 * Clause order determines section sequence within each document.
 */

export interface Clause {
  id: string
  document: string[]
  section: string
  order: number
  always: boolean
  include?: (ctx: DraftContext) => boolean
  text: string
}

export interface DraftContext {
  is_married: boolean
  has_children: boolean
  has_minor_children: boolean
  client_aka?: string
  spouse_aka?: string
  excluded_person?: string
  excluded_persons?: string[]
  disinherit_issue?: boolean
  additional_disinheritance_language?: string
  include_child_gender_markers?: boolean
  include_afterborn_children?: boolean
  include_expectant_children?: boolean
  omissions_intentional?: boolean
  include_general_disinheritance?: boolean
  excluded_guardian?: string
  excluded_guardian_2?: string
  provisions: string[]
  distribution_method: 'per_stirpes' | 'per_capita'
  staggered_ages?: string
  plan_type: string
  has_alt1_hcp: boolean
  has_alt2_hcp: boolean
  has_alt3_hcp: boolean
  has_co_trustee: boolean
  has_co_poa: boolean
  has_co_pr: boolean
  has_co_guardian: boolean
  has_alt_guardian: boolean
  has_successor_trustee: boolean
  // Will provisions (from design sheet)
  bond?: 'no_bond' | 'required'
  no_contest_clause?: 'omit' | 'include'
  simultaneous_death?: 'spouse_survives' | 'testator_survives' | 'omit' | null
  utma_age?: 18 | 21
  tangible_property_distribution?: 'spouse_then_children' | 'children_then_descendants' | 'named_then_children' | null
  tangible_property_named_individual?: string | null
  specific_bequests?: unknown[]
  pr_structure?: 'single' | 'spouse_first' | 'co_pr' | null
  // DPOA / HCP provisions (from design sheet)
  coagent_manner?: 'independently' | 'jointly' | 'majority'
  anatomical_gift?: 'all' | 'specified' | 'none' | null
  anatomical_specified?: string | null
  // Engagement agreement fields (optional — only populated for engagement drafting)
  fee_type?: 'flat_fee' | 'hourly' | 'contingency'
  includes_court_filing?: boolean
  includes_tax_planning?: boolean
  payment_plan?: boolean
  practice_area_category?: string
}

// ─── JOINT REVOCABLE LIVING TRUST ─────────────────────────────────────────

export const JOINT_TRUST_CLAUSES: Clause[] = [

  {
    id: 'jt_recitals',
    document: ['joint_revocable_trust'],
    section: 'Recitals',
    order: 10,
    always: true,
    text: `THIS IS A TRUST AGREEMENT dated [DocDate], between [CLIENT FULL NAME] (referred to herein as "[CLIENT FIRST NAME]") and [SPOUSE FULL NAME] (referred to herein as "[SPOUSE FIRST NAME]"), a married couple (collectively described herein as the "Grantors"), residing at [Address], and [TRUSTEE] and [CO TRUSTEE], as Trustees (the "Trustee").

WHEREAS, the Grantors desire to create a Trust; and

WHEREAS, the Trustee is willing to accept the trust hereby created and covenants to discharge faithfully the duties of a Trustee hereunder;

NOW, THEREFORE, the Grantors intend to transfer property to the Trustee, IN TRUST, and the Trustee agrees to accept the property and to hold, manage and distribute the property under the terms of this Trust Agreement.`,
  },

  {
    id: 'jt_trust_name',
    document: ['joint_revocable_trust'],
    section: 'Trust Name',
    order: 20,
    always: true,
    text: `1. TRUST NAME

This Trust Agreement and the trusts hereunder shall be known as the [TRUSTEE] and [CO TRUSTEE] as Trustees, or their successor in interest, of the [TRUST NAME] dated [DocDate], and any amendments thereto.`,
  },

  {
    id: 'jt_family_no_children',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 30,
    always: false,
    include: (ctx) => !ctx.has_children,
    text: `2. FAMILY INFORMATION

The Grantors are married. [CLIENT FIRST NAME] and [SPOUSE FIRST NAME] have no children born before the date of this Trust Agreement. All references in this document to the Grantors' children are references to the Grantors' children. References to Grantor's descendants are to the Grantors' children and their descendants, including any deceased child's descendants.`,
  },

  {
    id: 'jt_afterborn_no_children',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 29,
    always: false,
    include: (ctx) => !ctx.has_children && ctx.include_afterborn_children !== false,
    text: `Any children subsequently born to the Grantors or adopted by the Grantors by legal proceeding shall be treated as if they were listed explicitly in this Trust Agreement.`,
  },

  {
    id: 'jt_family_with_children',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 30,
    always: false,
    include: (ctx) => ctx.has_children,
    text: `2. FAMILY INFORMATION

The Grantors are married. [CLIENT FIRST NAME] and [SPOUSE FIRST NAME] have the following children born before the date of this Trust Agreement: [CHILD FULL NAME]. All references in this document to the Grantors' children are references to these children. References to Grantor's descendants are to the Grantors' children and their descendants, including any deceased child's descendants.`,
  },

  {
    id: 'jt_afterborn_children',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 31,
    always: false,
    include: (ctx) => ctx.include_afterborn_children !== false,
    text: `Any children subsequently born to the Grantors or adopted by the Grantors by legal proceeding shall be treated as if they were listed explicitly in this Trust Agreement.`,
  },

  {
    id: 'jt_posthumous_children',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 32,
    always: false,
    include: (ctx) => ctx.include_expectant_children !== false,
    text: `Any posthumous children (in gestation at the time of the first Grantor's death) shall be treated as if they were explicitly named in this Trust Agreement.`,
  },

  {
    id: 'jt_omissions_intentional',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 33,
    always: false,
    include: (ctx) => Boolean(ctx.omissions_intentional),
    text: `Any omitted children were intentionally left out of this Trust Agreement, except for afterborn children if afterborn-child language is included herein.`,
  },

  {
    id: 'jt_excluded_person',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 35,
    always: false,
    include: (ctx) => !!ctx.excluded_person && Boolean(ctx.disinherit_issue),
    text: `The Grantors wish to leave no assets passing pursuant to this Trust Instrument to [EXCLUDED PERSON] and [EXCLUDED PERSON]'s descendants for reasons known to them. As such, for all purposes under this Trust Instrument, [EXCLUDED PERSON] shall be deemed to have predeceased both of the Grantors without any surviving descendants. The Trustees shall strongly defend the Grantors' wishes as stated herein.`,
  },

  {
    id: 'jt_excluded_person_no_issue',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 36,
    always: false,
    include: (ctx) => !!ctx.excluded_person && !ctx.disinherit_issue,
    text: `The Grantors wish to leave no assets passing pursuant to this Trust Instrument to [EXCLUDED PERSON] for reasons known to them. As such, for all purposes under this Trust Instrument, [EXCLUDED PERSON] shall be deemed to have predeceased both of the Grantors. The Trustees shall strongly defend the Grantors' wishes as stated herein.`,
  },

  {
    id: 'jt_additional_disinheritance',
    document: ['joint_revocable_trust'],
    section: 'Family Information',
    order: 37,
    always: false,
    include: (ctx) => Boolean(ctx.additional_disinheritance_language),
    text: `[ADDITIONAL DISINHERITANCE LANGUAGE]`,
  },

  {
    id: 'jt_trust_property',
    document: ['joint_revocable_trust'],
    section: 'Trust Property',
    order: 40,
    always: true,
    text: `3. TRUST PROPERTY

Property transferred to the Trustee by either or both of [CLIENT FIRST NAME] and [SPOUSE FIRST NAME] (including property transferred at death by Last Will and Testament or other instrument) shall be held under this Trust Agreement in a common trust fund during the Grantors' lives. All property transferred to the trust shall be treated hereunder as property of which each Grantor owns an undivided one-half interest, regardless of the form of ownership or the ownership status of the property prior to its transfer. The property transferred by the Grantors to the trust is listed on Schedule A. Additional property may be transferred by either or both of the Grantors at any time after the execution of this Trust Agreement.`,
  },

  {
    id: 'jt_trustees',
    document: ['joint_revocable_trust'],
    section: 'Trustees',
    order: 50,
    always: true,
    text: `4. TRUSTEES

4.1 Appointment of Initial Trustee. The Grantors appoint [TRUSTEE] and [CO TRUSTEE] to serve as the initial Trustees hereunder (collectively referred to in this instrument as the Trustee).

4.2 Appointment of First Successor Trustee. If the other Grantor is unable or unwilling to serve for any reason, then we name [SUCCESSOR TRUSTEE] and [CO SUCCESSOR TRUSTEE] to serve jointly or the survivor of them, as successor Trustee when all other Trustees previously appointed have failed to qualify or ceased to serve as Trustee.

4.3 Co-Trustees. A Co-Trustee may be appointed by a then serving Trustee (the "appointing Trustee") at any time, regardless of how many trustees are serving. A Co-Trustee so appointed hereunder shall serve while the appointing Trustee serves, and shall continue to serve if the appointing Trustee fails or ceases to serve only if no successor has been named or identified by the Grantors or all successors named or identified by the Grantors are unable or unwilling to serve. Any appointment of a Co-Trustee hereunder shall be made by an acknowledged instrument delivered to any and all other Trustees who may then be serving.

4.4 Successor Trustees. If a specific successor Trustee is named to succeed a particular Trustee named in this Article, such specific successor Trustee shall serve as successor as appointed above. In all other cases, a Trustee (the "appointing Trustee") may appoint successor Trustees in accordance with this paragraph.

4.5 Trustee Exclusions. No successor Trustee or Co-Trustee appointed by a beneficiary shall be a person or entity that is related or subordinate to such beneficiary within the meaning of Code Sec. 672(c) and the Regulations thereunder.

4.6 Filling Trustee Vacancies. If there is neither an effectual appointment of a successor Trustee nor any effectual provision otherwise hereunder for the appointment of a successor Trustee, a majority of the members of the class composed of (a) the then living descendants of the Grantors who are capable of making the appointment, (b) the guardian or similar fiduciary appointed to manage the property or estate of any living descendant of the Grantors who is not so capable, and (c) the parent or natural guardian of each living descendant of the Grantors who is a minor and for whom no such fiduciary has been appointed, shall have the right to appoint an individual, corporation or other entity with fiduciary powers to replace the removed Trustee or whenever the office of Trustee becomes vacant.

4.7 Compensation of Trustees. Individual Trustees shall receive reasonable compensation in accordance with the law of the Commonwealth of Massachusetts in effect at the time of payment, unless the Trustee waives compensation. A corporate Trustee shall be compensated by agreement with the individual Trustee or, in the absence of such agreement, in accordance with its fee schedule as in effect at the time of payment.`,
  },

  {
    id: 'jt_during_lifetime',
    document: ['joint_revocable_trust'],
    section: 'During Grantors Lives',
    order: 60,
    always: true,
    text: `5. DURING GRANTORS' LIVES

Property held during the lifetime of the survivor of the Grantors, sometimes referred to herein as the "Surviving Spouse," shall be disposed of as follows:

5.1 The Grantors' Property. The Trustee shall distribute to [CLIENT FIRST NAME] and [SPOUSE FIRST NAME] (1) as much of the net income and principal of the trust as [CLIENT FIRST NAME] or [SPOUSE FIRST NAME] may from time to time direct (referred to herein as each Grantors' "power of withdrawal"), and (2) such additional amounts of such net income or principal as the Trustee may at any time and from time to time determine. All property distributed from the trust shall be (1) divided into two equal shares if both of the Grantors are then living, and one share shall be distributed to each Grantor, and (2) following the death of the first of the Grantors to die (the "Predeceased Spouse"), distributed in its entirety to the surviving Grantor.

5.2 Intention. The Trust is established to ensure that the best available care and support are provided to each of the Grantors to meet all the Grantors' lifetime needs during the lifetime of the survivor of the Grantors. All assets of the Trust are to be considered available for that purpose, and the Trustee shall at all times be guided by that purpose and intent. The Trustee shall liberally distribute income and principal of the Trust for the Grantors' benefit as indicated and the rights of the successor beneficiaries hereunder shall be considered secondary.

5.3 General Directions to Trustee. The Trustee shall make every effort to involve the Grantors in decision-making regarding the Grantors' personal care and regarding financial matters attributable to the Grantors' property. The Trustee shall make every effort to determine the Grantors' respective wishes and make decisions that conform to them. The Trustee shall make every effort to make decisions that the Trustee believes the Grantors would make, if the Grantors were able to make such decisions known, and to bear in mind that the least restrictive alternatives for living arrangements are desirable so that the Grantors may live with the greatest degree of dignity possible.

5.4 The Grantors' Residence. The Trustee is specifically authorized to hold and maintain any real property used by the Grantors as a personal residence and transferred to the trust for the Grantors' use and benefit during the Grantors' lifetimes. If the Trustee determines that it would be in the Grantors' best interest to maintain a residence for the Grantors' use but that the residence or residences then held in any trust hereunder should not be used for such purpose, the Trustee is authorized to sell said real property and to purchase such other residence, or to make such other arrangements as the Trustee deems suitable for the purpose.

5.5 Undistributed Income. Any net income not so distributed shall be accumulated and annually added to principal.

5.6 Death of Predeceased Spouse. Upon the Predeceased Spouse's death, all assets remaining in the trust fund after payment of debts, taxes and the specific provisions set forth above shall continue to be held in this trust and administered in accordance with the provisions of this Article until the death of the Surviving Spouse.`,
  },

  {
    id: 'jt_death_taxes',
    document: ['joint_revocable_trust'],
    section: 'Payment of Death Taxes',
    order: 65,
    always: true,
    text: `6. PAYMENT OF THE PREDECEASED SPOUSE'S DEATH TAXES

All estate, inheritance, legacy, succession, generation-skipping or other wealth transfer taxes imposed by reason of the Predeceased Spouse's death (other than any additional estate tax imposed by Code Sec. 2031(c)(5)(C) or 2032A(c), or any generation-skipping transfer tax on any generation-skipping transfer other than a direct skip) shall be paid from the trust fund as an expense of administration, without apportionment.`,
  },

  {
    id: 'jt_distribution_heading',
    document: ['joint_revocable_trust'],
    section: 'Distribution on Death of Surviving Spouse',
    order: 70,
    always: true,
    text: `7. DISTRIBUTION ON DEATH OF SURVIVING SPOUSE

Upon the death of the Surviving Spouse, after payment of any applicable death taxes and expenses as provided herein, all trust property shall be held and distributed as follows:`,
  },

  {
    id: 'jt_distribution_per_stirpes',
    document: ['joint_revocable_trust'],
    section: 'Distribution on Death of Surviving Spouse',
    order: 72,
    always: false,
    include: (ctx) => ctx.distribution_method === 'per_stirpes',
    text: `The Trustee shall divide the trust property into as many equal shares as there shall be children of the Grantors then living and deceased children of the Grantors leaving descendants then living. The Trustee shall allot one share to each child then living and one share to each deceased child leaving descendants then living, such shares to be held and distributed per stirpes.`,
  },

  {
    id: 'jt_distribution_per_capita',
    document: ['joint_revocable_trust'],
    section: 'Distribution on Death of Surviving Spouse',
    order: 72,
    always: false,
    include: (ctx) => ctx.distribution_method === 'per_capita',
    text: `The Trustee shall divide the trust property equally among all then living descendants of the Grantors, per capita at each generation.`,
  },

  {
    id: 'jt_staggered_distribution',
    document: ['joint_revocable_trust'],
    section: 'Distribution on Death of Surviving Spouse',
    order: 75,
    always: false,
    include: (ctx) => ctx.provisions.includes('staggered_distribution'),
    text: `Each share allocated to a then living child shall be held and distributed upon the following terms and conditions:

The Trustee shall pay such part or all of the income and principal of the share as the Trustee deems proper in the Trustee's absolute discretion to or for the benefit of the child for the child's comfort, support, health, education and happiness. When the child attains the age of twenty-five (25), the Trustee shall pay to him or her one-third (1/3) of the then remaining balance of the share. When the child attains the age of thirty (30), the Trustee shall pay to him or her one-half (1/2) of the then remaining balance of the share and, when the child attains the age of thirty-five (35), the Trustee shall pay to him or her the entire remaining balance of the share. If the child had attained one or more of such ages at the time such child's share is established, the portion or portions of his or her share which were to be paid to him or her at such ages as provided herein shall be paid to such child at the time such share is established.

Should the child die before receiving full distribution of the share, the balance of the share shall be paid over to the child's then living descendants by right of representation or, if the child has no then living descendants, to the Grantors' then living descendants by right of representation.`,
  },

  {
    id: 'jt_minor_holdback',
    document: ['joint_revocable_trust'],
    section: 'Distribution on Death of Surviving Spouse',
    order: 78,
    always: false,
    include: (ctx) => ctx.has_minor_children,
    text: `In the event that any property is payable under the foregoing provisions to a person who has not attained the age of twenty-five (25) years, such property shall be retained by the Trustee to be held and distributed as follows:

(a) To pay to or for the benefit of such person such part of the income and principal as the Trustee shall determine for the comfort, health, support, education and happiness of such person until such person reaches the age of twenty-five (25) years or dies under that age.

(b) To accumulate such part or all of the income as the Trustee shall determine or add such accumulated income to the principal until such person reaches the age of twenty-five (25) years or dies under that age.

(c) To pay the trust property to such person, discharged of all trusts, when such person reaches the age of twenty-five (25) years.

(d) To pay said trust property, if such person dies under the age of twenty-five (25) years, to such one or more members of the group consisting of such person's spouse and issue, in such proportions, limitations and trusts as such person shall appoint by will, making a specific reference to this power of appointment or, in the absence of such appointment, to those persons who would have taken his personal property if such person had died intestate, unmarried and domiciled in Massachusetts under the laws then in force.`,
  },

  {
    id: 'jt_spendthrift',
    document: ['joint_revocable_trust'],
    section: 'Spendthrift Provisions',
    order: 85,
    always: false,
    include: (ctx) => ctx.provisions.includes('spendthrift'),
    text: `SPENDTHRIFT PROVISIONS

The interest of any beneficiary of the trust under this agreement, either as to income or principal, shall not be subject to anticipation, alienation or be in any other manner assigned by said beneficiary, nor shall any interest be subject to any legal process, bankruptcy proceedings or the interference or control of creditors or of any spouse of a married beneficiary, prior to the actual receipt of such interest by the beneficiary.`,
  },

  {
    id: 'jt_trustee_powers',
    document: ['joint_revocable_trust'],
    section: 'Trustee Powers',
    order: 90,
    always: true,
    text: `POWERS OF PERSONAL REPRESENTATIVE AND TRUSTEE

In addition to and not in limitation of the powers granted to the Trustee by common and statutory law or other provisions of this agreement, the Trustee shall have the following powers with respect to property held in trust, which may be exercised at any time in the Trustee's discretion without approval of any court:

(a) To sell at public or at private sale, to give options and to exchange, lease, partition, or otherwise dispose of any real or personal property at public or at private sale or otherwise, for cash or other consideration or on credit, for such consideration and upon such terms or conditions as the Trustee may deem proper, and to execute, acknowledge and deliver deeds, notes, mortgages, transfers, leases, options, contracts and other instruments whether or not the terms or effect thereof may extend beyond the duration of the trust.

(b) To retain any property which the Trustee may receive, even though such property (by reason of its character, amount, proportion to the total trust estate, or otherwise) would not be considered appropriate for a fiduciary apart from this provision.

(c) To invest and reinvest the trust estate from time to time in any property, real or personal, including securities of domestic and foreign corporations and investment trusts, investment companies, common trust funds, collective investment funds, bonds, preferred stocks, common stocks, mortgages, and savings accounts in a bank.

(d) To make division or any distribution hereunder either in kind or in money, or partly in each. Distribution in kind shall be made at the market value of the property distributed at current values as of the date of distribution.

(e) To pay, settle, contest or compromise any claim or matter of difference.

(f) To borrow money from any person, firm, or corporation for the purpose of protecting, preserving or improving the trust property, and to secure the payment of such amounts by mortgage or pledge of any trust property upon such terms and conditions as the Trustee may determine.

(g) To employ such brokers, banks, custodians, investment counsel, attorneys, and other agents, and to delegate to them such of the duties, rights and powers of the Trustee for such periods as the Trustee may think fit.

(h) To locate, access, review, administer, manage, distribute, dispose of, and cancel email accounts, social media accounts, online banking, and other electronic financial accounts, websites, blogs, and any other digital asset, including full power and authority to request and receive passwords and refunds of any monies due from the companies or institutions servicing or hosting any of such accounts.

(i) To pay reasonable compensation to any Trustee for services rendered hereunder.`,
  },

  {
    id: 'jt_amendment_revocation',
    document: ['joint_revocable_trust'],
    section: 'Amendment and Revocation',
    order: 95,
    always: true,
    text: `AMENDMENT AND REVOCATION

During the Grantors' joint lifetimes, this Trust Agreement may be amended or revoked by a written instrument signed by both Grantors and delivered to the Trustee. After the death of one Grantor, this Trust Agreement may be amended or revoked by the surviving Grantor with respect to such Grantor's share of the trust property. This Trust Agreement shall become irrevocable upon the death of the surviving Grantor.`,
  },

  {
    id: 'jt_definitions',
    document: ['joint_revocable_trust'],
    section: 'Definitions',
    order: 100,
    always: true,
    text: `DEFINITIONS

Wherever the word "Trustee" is used in this agreement, it means and includes the original and any successor, whether female, male or corporate, and the singular includes the plural and the plural includes the singular.

Wherever the word "descendants" is used in this agreement, it means lawful descendants in any degree, including the first, whether by blood or adoption in any generation.

Wherever the phrase "by right of representation" is used in this agreement, it means the property is divided into as many equal shares as there are (i) surviving children of the designated ancestor and (ii) deceased children who left surviving descendants. Each surviving child is allocated one share. The share of each deceased child with surviving descendants is divided in the same manner, with subdivision repeating at each succeeding generation until the property is fully allocated among surviving descendants.

Wherever the word "spouse" is used in this agreement, it means [CLIENT FIRST NAME]'s spouse, [SPOUSE FULL NAME].`,
  },

  {
    id: 'jt_execution',
    document: ['joint_revocable_trust'],
    section: 'Execution',
    order: 110,
    always: true,
    text: `IN WITNESS WHEREOF, the Grantors and the Trustee have signed this Trust Agreement on [DocDate].

[CLIENT FULL NAME], Grantor

[SPOUSE FULL NAME], Grantor

[TRUSTEE], Trustee

[CO TRUSTEE], Trustee

COMMONWEALTH OF MASSACHUSETTS
COUNTY OF [SIGNING COUNTY]

On [SIGNING DATE], before me, the undersigned notary public, personally appeared [CLIENT FULL NAME], proved to me through satisfactory evidence of identification, which was a government-issued photo identification to be the person whose name is signed on the preceding or attached document, and who acknowledged that [Client Pronoun] signed it voluntarily for its stated purpose.

WITNESS my hand and notarial seal.

(SEAL)

______________________________________
Notary Public
My Commission Expires: [Notary Commission]

COMMONWEALTH OF MASSACHUSETTS
COUNTY OF [SIGNING COUNTY]

On [SIGNING DATE], before me, the undersigned notary public, personally appeared [SPOUSE FULL NAME], proved to me through satisfactory evidence of identification, which was a government-issued photo identification, to be the person whose name is signed on the preceding or attached document, and who acknowledged that [Spouse Pronoun] signed it voluntarily for its stated purpose.

WITNESS my hand and notarial seal.

(SEAL)

______________________________________
Notary Public
My Commission Expires: [Notary Commission]`,
  },

]

// ─── POUR-OVER WILL ───────────────────────────────────────────────────────

export const POUR_OVER_WILL_CLAUSES: Clause[] = [

  {
    id: 'pow_opening_aka',
    document: ['pour_over_will'],
    section: 'Opening',
    order: 10,
    always: false,
    include: (ctx) => !!ctx.client_aka,
    text: `LAST WILL AND TESTAMENT OF [CLIENT FULL NAME]

I, [CLIENT FULL NAME], also known as [CLIENT AKA], a resident of [City], [County] County, Massachusetts, revoke any prior Wills and codicils made by me and declare this to be my Last Will and Testament.`,
  },

  {
    id: 'pow_opening_no_aka',
    document: ['pour_over_will'],
    section: 'Opening',
    order: 10,
    always: false,
    include: (ctx) => !ctx.client_aka,
    text: `LAST WILL AND TESTAMENT OF [CLIENT FULL NAME]

I, [CLIENT FULL NAME], a resident of [City], [County] County, Massachusetts, revoke any prior Wills and codicils made by me and declare this to be my Last Will and Testament.`,
  },

  {
    id: 'pow_family_married',
    document: ['pour_over_will'],
    section: 'Family Information',
    order: 20,
    always: false,
    include: (ctx) => ctx.is_married,
    text: `FAMILY INFORMATION

I am married to [SPOUSE FULL NAME]. Any reference in this document to my spouse is a reference to [SPOUSE FULL NAME].`,
  },

  {
    id: 'pow_family_unmarried',
    document: ['pour_over_will'],
    section: 'Family Information',
    order: 20,
    always: false,
    include: (ctx) => !ctx.is_married,
    text: `FAMILY INFORMATION

I am unmarried.`,
  },

  {
    id: 'pow_children_definition',
    document: ['pour_over_will'],
    section: 'Family Information',
    order: 25,
    always: false,
    include: (ctx) => ctx.has_children,
    text: `References to my children and descendants in this Last Will and Testament shall refer only to [CHILD FULL NAME] and the descendants of my aforesaid child or children. A person legally adopted prior to attaining eighteen (18) years of age shall not be differentiated from blood descendants for any purpose, but a person who is adopted after attaining eighteen (18) years of age shall not be deemed a child or descendant for all purposes hereunder.`,
  },

  {
    id: 'pow_afterborn_children',
    document: ['pour_over_will'],
    section: 'Family Information',
    order: 26,
    always: false,
    include: (ctx) => ctx.has_children && ctx.include_afterborn_children !== false,
    text: `Any child of mine born or adopted after the date of this Last Will and Testament, and the descendants of any such after-born or after-adopted child, shall be treated as if listed explicitly herein.`,
  },

  {
    id: 'pow_posthumous_children',
    document: ['pour_over_will'],
    section: 'Family Information',
    order: 27,
    always: false,
    include: (ctx) => ctx.has_children && ctx.include_expectant_children !== false,
    text: `Any posthumous child of mine (in gestation at the time of my death) shall be treated as if explicitly named in this Last Will and Testament.`,
  },

  {
    id: 'pow_omissions_intentional',
    document: ['pour_over_will'],
    section: 'Family Information',
    order: 28,
    always: false,
    include: (ctx) => ctx.has_children && Boolean(ctx.omissions_intentional),
    text: `Except as provided in this Article, I have intentionally, and not as a result of any mistake or inadvertence, omitted in this Last Will and Testament to provide for any other children and/or descendants of mine, if any, however defined by law.`,
  },

  {
    id: 'pow_tangible_default',
    document: ['pour_over_will'],
    section: 'Distribution of My Property',
    order: 30,
    always: false,
    include: (ctx) =>
      ctx.tangible_property_distribution == null ||
      ctx.tangible_property_distribution === 'children_then_descendants',
    text: `DISPOSITION OF TANGIBLE PERSONAL PROPERTY

I devise all my tangible personal property in substantially equal shares to those of my children who survive me. If applicable, my Personal Representative shall make all determinations as to the substantial equality of shares, giving due regard to the requests of said persons, or to any requests I might make by letter or memorandum addressed to my Personal Representative. Such letter or written memorandum, if any, will simply be an expression of my wishes and shall not create any trust or legal obligation, nor shall it be offered for probate as part of this Last Will and Testament.`,
  },

  {
    id: 'pow_tangible_spouse_then_children',
    document: ['pour_over_will'],
    section: 'Distribution of My Property',
    order: 30,
    always: false,
    include: (ctx) => ctx.tangible_property_distribution === 'spouse_then_children',
    text: `DISPOSITION OF TANGIBLE PERSONAL PROPERTY

I give all of my tangible personal property to [SPOUSE FULL NAME] if my spouse survives me. If my spouse does not survive me, I give such property to those of my children who survive me, in substantially equal shares. My Personal Representative shall make all determinations as to the substantial equality of shares, giving due regard to the requests of said persons, or to any requests I might make by letter or memorandum addressed to my Personal Representative. Such letter or written memorandum, if any, will simply be an expression of my wishes and shall not create any trust or legal obligation, nor shall it be offered for probate as part of this Last Will and Testament.`,
  },

  {
    id: 'pow_tangible_named_then_children',
    document: ['pour_over_will'],
    section: 'Distribution of My Property',
    order: 30,
    always: false,
    include: (ctx) => ctx.tangible_property_distribution === 'named_then_children',
    text: `DISPOSITION OF TANGIBLE PERSONAL PROPERTY

I give all of my tangible personal property to [TANGIBLE NAMED INDIVIDUAL] if that person survives me. If that person does not survive me, I give such property to those of my children who survive me, in substantially equal shares. My Personal Representative shall make all determinations as to the substantial equality of shares, giving due regard to the requests of said persons, or to any requests I might make by letter or memorandum addressed to my Personal Representative. Such letter or written memorandum, if any, will simply be an expression of my wishes and shall not create any trust or legal obligation, nor shall it be offered for probate as part of this Last Will and Testament.`,
  },

  {
    id: 'pow_pour_over',
    document: ['pour_over_will'],
    section: 'Pour-Over to My Revocable Trust',
    order: 40,
    always: true,
    text: `POUR-OVER TO MY REVOCABLE TRUST

I devise the residue of my estate to the Trustee then serving under the [TRUST NAME] dated [DocDate], (hereinafter sometimes referred to as the "Revocable Trust") executed immediately prior hereto of which I am the Grantor and the present Trustee, to be added to the property held thereunder and administered in accordance with the terms of the Revocable Trust as the same shall exist at the time of my death and not as a trust under this Last Will and Testament.

ALTERNATE DISPOSITION

If the trust referred to above is not in effect at my death, or if for any other reason the pour over fails, I specifically incorporate by reference all the terms of the trust into this Will. I direct my Personal Representative to then establish a new trust under the provisions of that trust and distribute the remainder of my estate to that Trustee to administer as provided in the trust.

If incorporation by reference fails for any reason, I direct my Personal Representative to distribute the remainder of my estate to my spouse if my spouse survives me. If my spouse does not survive me I direct my Personal Representative to distribute the property to my descendants, per stirpes.`,
  },

  {
    id: 'pow_personal_representative_single',
    document: ['pour_over_will'],
    section: 'Nomination of Personal Representatives',
    order: 50,
    always: false,
    include: (ctx) => ctx.pr_structure === 'single',
    text: `NOMINATION OF PERSONAL REPRESENTATIVE

I nominate [PERSONAL REPRESENTATIVE] to be the Personal Representative of this my Last Will and Testament. In the event of a vacancy in the office of Personal Representative, I nominate the following in the order named to serve as Personal Representative hereunder when all other Personal Representatives previously appointed have failed to qualify or ceased to serve:

First: [ALT PERSONAL REPRESENTATIVE]

I request that the same person named herein as Personal Representative, or such person's successor or successors, upon application be appointed Special Personal Representative hereof in the same order of succession.`,
  },

  {
    id: 'pow_personal_representative_spouse_first',
    document: ['pour_over_will'],
    section: 'Nomination of Personal Representatives',
    order: 50,
    always: false,
    include: (ctx) => ctx.pr_structure === 'spouse_first',
    text: `NOMINATION OF PERSONAL REPRESENTATIVES

I nominate [SPOUSE FULL NAME] to serve as the Personal Representative of this my Last Will and Testament. In the event of a vacancy in the office of Personal Representative, I nominate the following in the order named to serve as Personal Representative hereunder when all other Personal Representatives previously appointed have failed to qualify or ceased to serve:

First: [ALT PERSONAL REPRESENTATIVE] and [CO ALT PERSONAL REPRESENTATIVE]

I request that the same person named herein as Personal Representative, or such person's successor or successors, upon application be appointed Special Personal Representative hereof in the same order of succession.`,
  },

  {
    id: 'pow_personal_representative_copr',
    document: ['pour_over_will'],
    section: 'Nomination of Personal Representatives',
    order: 50,
    always: false,
    include: (ctx) => ctx.pr_structure === 'co_pr' || ctx.pr_structure == null,
    text: `NOMINATION OF PERSONAL REPRESENTATIVES

I nominate [PERSONAL REPRESENTATIVE] and [CO PERSONAL REPRESENTATIVE], jointly, to be the Personal Representative of this my Last Will and Testament. In the event of a vacancy in the office of Personal Representative, I nominate the following in the order named to serve as Personal Representative hereunder when all other Personal Representatives previously appointed have failed to qualify or ceased to serve:

First: [ALT PERSONAL REPRESENTATIVE] and [CO ALT PERSONAL REPRESENTATIVE]

I request that the same person named herein as Personal Representative, or such person's successor or successors, upon application be appointed Special Personal Representative hereof in the same order of succession.`,
  },

  {
    id: 'pow_pr_powers',
    document: ['pour_over_will'],
    section: 'Powers of Personal Representative',
    order: 55,
    always: true,
    text: `POWERS OF PERSONAL REPRESENTATIVE

My Personal Representative, in addition to and not in limitation of said Personal Representative's common law and statutory powers, shall have and may exercise the following discretionary powers without the necessity of court license or approval:

(1) To retain for whatever period my Personal Representative deems advisable in my Personal Representative's absolute discretion any property, including property owned by me at my death, and to invest and reinvest in any property, both real and personal, regardless of whether any particular investment would be proper for a Personal Representative and regardless of the extent of diversification of the assets held hereunder.

(2) To sell and to grant options to purchase all or any part of my estate, both real and personal, at any time, at public or private sale, for such consideration and upon such terms as my Personal Representative deems advisable.

(3) To pay, compromise, settle, or otherwise adjust any claims, including taxes, asserted in favor of or against me, my estate, or my Personal Representative.

(4) To make such elections under the tax laws as my Personal Representative shall deem appropriate, including elections with respect to claiming the alternative value in any estate tax return, exemptions, and determining whether to make any adjustments between income and principal.

(5) To access, use, and control my "digital assets" owned or controlled by me at my death, including having access to any and all passwords associated with such digital assets and having access to any electronically stored information owned or controlled by me at my death.`,
  },

  {
    id: 'pow_debts',
    document: ['pour_over_will'],
    section: 'Payments of Debts and Expenses',
    order: 60,
    always: true,
    text: `PAYMENTS OF DEBTS AND EXPENSES

All of my debts, funeral expenses, expenses of administration, and all federal and state taxes in the nature of estate, inheritance, succession, transfer, or like taxes (but excluding generation-skipping transfer taxes), including interest and penalties thereon, arising or owing on, or by reason of, my death, with respect to any property passing under this Last Will and Testament or under the Revocable Trust shall be borne and paid from my residuary estate.`,
  },

  {
    id: 'pow_spendthrift',
    document: ['pour_over_will'],
    section: 'Spendthrift Provisions',
    order: 65,
    always: true,
    text: `SPENDTHRIFT PROVISIONS

The interest of any beneficiary in any share or part of this Last Will and Testament, both principal and income, shall not be voluntarily or involuntarily transferred and shall not be attachable nor paid by way of anticipation, nor transferred or paid in compliance with any judicial or other similar order and shall not be applied to, or held liable for, any of such beneficiary's debts or obligations either in law or equity and shall not in any event pass to such beneficiary's assignee under any insolvency or bankruptcy law, and shall not be subject to the interference or control of creditors, spouses, former spouses, or others.`,
  },

  {
    id: 'pow_guardian',
    document: ['pour_over_will'],
    section: 'Nomination of Guardian',
    order: 70,
    always: false,
    include: (ctx) => ctx.has_minor_children,
    text: `NOMINATION OF GUARDIAN

I appoint as guardian of the person and the property of any minor child of mine, the child's other parent, if living, or, if that parent fails to qualify or ceases to act, I appoint [GUARDIAN] and [CO GUARDIAN] as guardian of the person and the property of any such minor child of mine. I appoint [ALT GUARDIAN] and [CO ALT GUARDIAN], in the order named, to be the successor guardian of the person and the property of any minor child of mine, if and when all persons I have previously named shall fail to qualify or cease to act. No bond or other security shall be required of any such person.`,
  },

  {
    id: 'pow_excluded_guardian',
    document: ['pour_over_will'],
    section: 'Nomination of Guardian',
    order: 75,
    always: false,
    include: (ctx) => !!ctx.excluded_guardian,
    text: `I wish to specifically exclude as guardian of the person and the property of any minor child of mine the following individual(s) for reasons known to me: [EXCLUDED GUARDIAN].

I declare that none of the above-named individuals shall be permitted to care for or raise my minor children in the event of my death or disability. Regardless of whether or how much the above-named individuals might improve and reform their lives, I do not want them to serve as guardian for my minor children in any circumstances.`,
  },

  {
    id: 'pow_bond_none',
    document: ['pour_over_will'],
    section: 'Bond and Estate Supervision',
    order: 80,
    always: false,
    include: (ctx) => ctx.bond !== 'required',
    text: `BOND AND ESTATE SUPERVISION

No bond shall be required of any Personal Representative serving hereunder, whether or not specifically named in this Last Will and Testament, or if a bond is required by law, then no surety will be required on such bond. I request that the administration of my estate be unsupervised.`,
  },

  {
    id: 'pow_bond_required',
    document: ['pour_over_will'],
    section: 'Bond and Estate Supervision',
    order: 80,
    always: false,
    include: (ctx) => ctx.bond === 'required',
    text: `BOND AND ESTATE SUPERVISION

Each Personal Representative serving hereunder shall furnish bond with surety as required by law or court order. I request that the administration of my estate be unsupervised.`,
  },

  {
    id: 'pow_no_contest',
    document: ['pour_over_will'],
    section: 'No-Contest',
    order: 82,
    always: false,
    include: (ctx) => ctx.no_contest_clause === 'include',
    text: `NO-CONTEST CLAUSE

To the extent permitted by law, any beneficiary who contests this Will or any provision of it, directly or indirectly, shall be treated as having predeceased me for purposes of any provision in favor of that beneficiary.`,
  },

  {
    id: 'pow_simultaneous_death_spouse',
    document: ['pour_over_will'],
    section: 'Simultaneous Death',
    order: 83,
    always: false,
    include: (ctx) => ctx.simultaneous_death === 'spouse_survives',
    text: `SIMULTANEOUS DEATH

If my spouse and I die under circumstances where the order of our deaths cannot be established by clear and convincing evidence, my spouse shall be deemed to have survived me for all purposes of this Last Will and Testament.`,
  },

  {
    id: 'pow_simultaneous_death_testator',
    document: ['pour_over_will'],
    section: 'Simultaneous Death',
    order: 83,
    always: false,
    include: (ctx) => ctx.simultaneous_death === 'testator_survives',
    text: `SIMULTANEOUS DEATH

If my spouse and I die under circumstances where the order of our deaths cannot be established by clear and convincing evidence, I shall be deemed to have survived my spouse for all purposes of this Last Will and Testament.`,
  },

  {
    id: 'pow_utma_age',
    document: ['pour_over_will'],
    section: 'Distributions to Minors',
    order: 84,
    always: true,
    text: `DISTRIBUTIONS TO MINORS

If any property becomes distributable under this Last Will and Testament to a person who has not attained age [UTMA AGE], my Personal Representative may distribute that property to a custodian for that person under the Massachusetts Uniform Transfers to Minors Act, to be held until that person reaches age [UTMA AGE].`,
  },

  {
    id: 'pow_specific_bequests',
    document: ['pour_over_will'],
    section: 'Specific Bequests',
    order: 32,
    always: false,
    include: (ctx) => Array.isArray(ctx.specific_bequests) && ctx.specific_bequests.length > 0,
    text: `SPECIFIC BEQUESTS

I make the following specific gifts:

[SPECIFIC BEQUESTS LIST]`,
  },

  {
    id: 'pow_definitions',
    document: ['pour_over_will'],
    section: 'Definitions and Clarifications',
    order: 85,
    always: true,
    text: `DEFINITIONS AND CLARIFICATIONS

(1) Whenever the term "Personal Representative" is used herein, it shall also include any Special Personal Representative, executor, administrator, or other fiduciary, whether acting in a permanent, temporary, or special capacity.

(2) Whenever distribution of property is to be made "by right of representation" such distribution shall be made per stirpes and not per capita at each generation.

(3) The singular shall include the plural, the plural shall include the singular, the masculine pronoun shall include the feminine pronoun or the neuter, the feminine pronoun shall include the masculine pronoun or the neuter, and the neuter shall include the masculine or the feminine pronoun, wherever the context so permits.

(4) All references to the "Code" shall mean the Internal Revenue Code of 1986 or any successor Code as the same may from time to time be amended.

(5) The term "digital assets" shall include files stored on digital devices, including but not limited to, desktop computers, laptop computers, tablets, peripherals, storage devices, mobile telephones, smartphones, and any similar digital device, and shall also include email communications, email accounts, digital music, digital photographs, digital videos, software licenses, social network accounts, file sharing accounts, financial accounts, domain registrations, and other online accounts.`,
  },

  {
    id: 'pow_execution',
    document: ['pour_over_will'],
    section: 'Execution',
    order: 90,
    always: true,
    text: `I, [CLIENT FULL NAME], the Testator, sign my name to this instrument this [Ordinal_DocDate], and being first duly sworn, do hereby declare to the undersigned authority that I sign and execute this instrument as my will and that I sign it willingly, that I execute it as my free and voluntary act for the purposes therein expressed, and that I am 18 years of age or older, of sound mind, and under no constraint or undue influence.

[CLIENT FULL NAME], Testator

We, _________________________, _________________________, the witnesses, sign our names to this instrument being first duly sworn and do declare to the undersigned authority that the Testator signs and executes this instrument as [Client HisHer] will and that [Client Pronoun] signs it willingly and that each of us, in the presence and hearing of the Testator, signs this will as witness to the Testator's signing, and that to the best of our knowledge the Testator is eighteen years of age or older, of sound mind and under no constraint or undue influence.

__________________________, Witness    of   __________________________

__________________________, Witness    of   __________________________

COMMONWEALTH OF MASSACHUSETTS
COUNTY OF [SIGNING COUNTY]

Subscribed, sworn to and acknowledged before me by [CLIENT FULL NAME], the Testator, and subscribed and sworn to before me by _________________________ and _________________________, witnesses, this [SIGNING DATE].

_________________________
Notary Public
My commission expires: [Notary Commission]`,
  },

]

// ─── DURABLE POWER OF ATTORNEY ───────────────────────────────────────────

export const DPOA_CLAUSES: Clause[] = [

  {
    id: 'dpoa_opening',
    document: ['dpoa'],
    section: 'Appointment',
    order: 10,
    always: true,
    text: `DURABLE GENERAL POWER OF ATTORNEY OF [CLIENT FULL NAME]

I, [CLIENT FULL NAME] of [City], Massachusetts hereby appoint [ATTORNEY IN FACT] and [CO ATTORNEY IN FACT], to serve as my Agent and Attorney-in-fact (hereinafter referred to as "Attorney-in-Fact") for me and in my name and behalf to control and manage my property and affairs in all respects including full power and authority to act as provided herein.

If [ATTORNEY IN FACT] and [CO ATTORNEY IN FACT] becomes incapacitated, is not qualified to serve, or declines or otherwise fails to serve, then I appoint the following to serve as my successor to serve as my Attorney-in-Fact for me and in my name and behalf to control and manage my property and affairs in all respects including full power and authority, in the order named:

First: [ALT ATTORNEY IN FACT] and [CO ALT ATTORNEY IN FACT]

If there is more than one Attorney-in-Fact serving at any time, the Attorneys-in-Fact will act jointly. Any third party may, without liability to me or my estate, conclusively rely upon a written statement from either of the aforesaid successor Attorney-in-Facts or from a licensed attorney at law as to the resignation, cessation, or inability of such Attorney-in-Fact's predecessor(s) to serve as attorney-in-fact hereunder.`,
  },

  {
    id: 'dpoa_general_powers',
    document: ['dpoa'],
    section: 'General Grant of Power',
    order: 20,
    always: true,
    text: `A. GENERAL GRANT OF POWER. I authorize my Attorney-in-Fact to exercise or perform any act, power, duty, right or obligation whatsoever that I now have or may hereafter acquire, in relation to any person, matter, transaction, or property, real or personal, tangible or intangible, now owned or hereafter acquired by me, including, without limitation, the following specifically enumerated powers. I grant to my Attorney-in-Fact full power and authority to do everything necessary in exercising any of the powers herein granted as fully as I might or could do if personally present, with full power of substitution or revocation, hereby ratifying and confirming all that my Attorney-in-Fact shall lawfully do or cause to be done by virtue of this durable power of attorney and the powers herein granted.

1. Powers of Collection and Payment. To pay my current bills and just debts; to collect, receive, request, demand, sue for, recover, and hold all such sums of money, debts, dues, commercial paper, checks, drafts, accounts, deposits, legacies, bequests, devises, notes, interests, stock certificates, bonds, dividends, certificates of deposit, annuities, pension, profit sharing, retirement, social security, insurance and other contractual benefits and proceeds, all documents of title, all property and property rights and demands whatsoever, liquidated or unliquidated, now or hereafter owned by, or due, owing, payable or belonging to me, or in which I have or hereafter acquire an interest.

2. Power to Acquire and Sell. To acquire, purchase, grant options to sell, mortgage (including a reverse mortgage), pledge, lease, transfer, assign, deliver, convey or otherwise dispose of real and personal property, tangible or intangible, or interests therein, on such terms and conditions as my Attorney-in-Fact shall deem proper.

3. Power with Respect to Real Property. To have full authority over all real property, including authority to convey, lease, mortgage, encumber, or otherwise deal with all interests in real property that I may own or hereafter acquire, without limitation.

4. Powers with Respect to Financial Accounts and Securities. To open, maintain, modify, and close accounts at banks, savings institutions, investment firms, and brokerage firms; to make deposits and withdrawals; to buy, sell, and trade in stocks, bonds, and other securities on such terms as my Attorney-in-Fact deems advisable.

5. Power with Respect to Retirement Plans. To contribute to, withdraw from, and deposit funds in any type of retirement plan; to select and change payment options for any such plan on my behalf.

6. Gift Making Powers. To make gifts of my property to any one or more of my descendants or to any entity primarily for the benefit of any one or more of my descendants, provided that no gift to any one person shall exceed the annual exclusion amount under the federal gift tax laws in any single year.

7. Estate or Benefit Planning Powers. To create trusts, to transfer property to trusts, and to make elections and take other actions with respect to trusts, all as authorized by law.

8. Digital Assets. To locate, access, review, administer, manage, distribute, dispose of, and cancel my email accounts, social media accounts, online banking, and other electronic financial accounts, websites, blogs, and any other digital asset I may have possessed, including full power and authority to request and receive my passwords and refunds of any monies due to me from the companies or institutions servicing or hosting any of such accounts.`,
  },

  {
    id: 'dpoa_coagent_independently',
    document: ['dpoa'],
    section: 'Co-Agent Authority',
    order: 25,
    always: false,
    include: (ctx) => ctx.coagent_manner === 'independently',
    text: `CO-AGENT AUTHORITY

If more than one Attorney-in-Fact is serving at any time, each Attorney-in-Fact may act independently and alone with respect to any matter within the scope of this Power of Attorney, and the act of any one Attorney-in-Fact shall be as fully effective as if only one Attorney-in-Fact were acting.`,
  },

  {
    id: 'dpoa_coagent_jointly',
    document: ['dpoa'],
    section: 'Co-Agent Authority',
    order: 25,
    always: false,
    include: (ctx) => ctx.coagent_manner === 'jointly',
    text: `CO-AGENT AUTHORITY

If more than one Attorney-in-Fact is serving at any time, the Attorneys-in-Fact shall act jointly with respect to all matters within the scope of this Power of Attorney. No Attorney-in-Fact shall have authority to act alone except as the other Attorneys-in-Fact may delegate in writing.`,
  },

  {
    id: 'dpoa_coagent_majority',
    document: ['dpoa'],
    section: 'Co-Agent Authority',
    order: 25,
    always: false,
    include: (ctx) => ctx.coagent_manner === 'majority',
    text: `CO-AGENT AUTHORITY

If more than one Attorney-in-Fact is serving at any time, the Attorneys-in-Fact shall act by majority decision with respect to all matters within the scope of this Power of Attorney. If two Attorneys-in-Fact are serving, they shall act unanimously.`,
  },

  {
    id: 'dpoa_durability',
    document: ['dpoa'],
    section: 'Durability',
    order: 30,
    always: true,
    text: `B. DURABILITY. This Power of Attorney shall not be affected by my subsequent disability, incapacity, or incompetence, and shall not be affected by lapse of time. This is a Durable Power of Attorney pursuant to the Massachusetts Uniform Probate Code.`,
  },

  {
    id: 'dpoa_execution',
    document: ['dpoa'],
    section: 'Execution',
    order: 40,
    always: true,
    text: `Signed this [Ordinal_DocDate].

[CLIENT FULL NAME]

COMMONWEALTH OF MASSACHUSETTS
COUNTY OF [SIGNING COUNTY]

On [SIGNING DATE], before me, the undersigned notary public, personally appeared [CLIENT FULL NAME], proved to me through satisfactory evidence of identification, which was a government-issued photo identification, to be the person whose name is signed on the preceding or attached document, and acknowledged to me that [Client Pronoun] signed it voluntarily for its stated purpose.

______________________________________
Notary Public
My Commission Expires: [Notary Commission]`,
  },

]

// ─── HEALTH CARE PROXY ────────────────────────────────────────────────────

export const HCP_CLAUSES: Clause[] = [

  {
    id: 'hcp_opening',
    document: ['hcp'],
    section: 'Appointment',
    order: 10,
    always: true,
    text: `MASSACHUSETTS HEALTH CARE PROXY OF [CLIENT FULL NAME]

I, [CLIENT FULL NAME] (the Principal), residing at [Street], [City], Massachusetts being a competent adult at least eighteen (18) years of age or older, of sound mind and under no constraint or undue influence, hereby appoint the following person to be my Health Care Agent (hereinafter referred to as "Health Care Agent" or "Agent") under the terms of this document:

A. HEALTH CARE PROXY. I intend to create a Health Care Proxy according to Chapter 201D of the General Laws of Massachusetts. In making this appointment, I am giving my Health Care Agent the authority to make any and all health care decisions on my behalf, subject to any limitations I state in this document, in the event that I should at some future time become incapable of making health care decisions for myself.

B. APPOINTMENT OF HEALTH CARE AGENT.

Name: [PRIMARY HCP]
Relationship: [Primary HCP Relationship]
Address: [Primary HCP Address]
Telephone: [Primary HCP Phone]`,
  },

  {
    id: 'hcp_alt1',
    document: ['hcp'],
    section: 'Alternate Agents',
    order: 15,
    always: false,
    include: (ctx) => ctx.has_alt1_hcp,
    text: `If [PRIMARY HCP] is not available, willing or competent to serve and is not expected to become available, willing or competent to make a timely decision given my medical circumstances, or in the event that my original Health Care Agent is disqualified from acting on my behalf, then I designate the individuals listed below as alternate Health Care Agents, to serve in the order in which their names appear.

Name: [ALTERNATE 1 HCP]
Relationship: [Alternate 1 HCP Relationship]
Address: [Alternate 1 HCP Address]
Telephone: [Alternate 1 HCP Phone]`,
  },

  {
    id: 'hcp_alt2',
    document: ['hcp'],
    section: 'Alternate Agents',
    order: 16,
    always: false,
    include: (ctx) => ctx.has_alt2_hcp,
    text: `Name: [ALTERNATE 2 HCP]
Relationship: [Alternate 2 HCP Relationship]
Address: [Alternate 2 HCP Address]
Telephone: [Alternate 2 HCP Phone]`,
  },

  {
    id: 'hcp_alt3',
    document: ['hcp'],
    section: 'Alternate Agents',
    order: 17,
    always: false,
    include: (ctx) => ctx.has_alt3_hcp,
    text: `Name: [ALTERNATE 3 HCP]
Relationship: [Alternate 3 HCP Relationship]
Address: [Alternate 3 HCP Address]
Telephone: [Alternate 3 HCP Phone]`,
  },

  {
    id: 'hcp_powers',
    document: ['hcp'],
    section: 'Powers',
    order: 20,
    always: true,
    text: `C. POWERS GIVEN TO HEALTH CARE AGENT.

I give my Health Care Agent full authority to make any and all health care decisions for me including decisions about life-sustaining treatment, subject only to any limitations I state below.

1. My Health Care Agent shall have authority to act on my behalf only if, when and for so long as a determination has been made that I lack the capacity to make or to communicate health care decisions for myself. This determination shall be made in writing by my attending physician according to accepted standards of medical judgment and the requirements of Chapter 201D of the General Laws of Massachusetts.

2. The authority of my Health Care Agent shall cease if my attending physician determines that I have regained capacity. The authority of my Health Care Agent shall recommence if I subsequently lose capacity and consent for treatment is required.

3. I shall be notified of any determination that I lack capacity to make or communicate health care decisions where there is any indication that I am able to comprehend this notice.

4. My Health Care Agent shall have authority to authorize my admission to a medical facility and to authorize medical procedures, operations, treatments, and medications on my behalf.

5. My Health Care Agent shall have authority to authorize the withholding or withdrawal of life-sustaining treatment, including artificial nutrition and hydration, if my Health Care Agent believes in good faith that such is consistent with my wishes as expressed in an advance directive or as otherwise made known to my Health Care Agent.`,
  },

  {
    id: 'hcp_anatomical_all',
    document: ['hcp'],
    section: 'Anatomical Gift',
    order: 25,
    always: false,
    include: (ctx) => ctx.anatomical_gift === 'all',
    text: `ANATOMICAL GIFT

Upon my death, I give any needed organs, tissues, and parts of my body for transplantation, therapy, research, or education, to the extent permitted by law.`,
  },

  {
    id: 'hcp_anatomical_specified',
    document: ['hcp'],
    section: 'Anatomical Gift',
    order: 25,
    always: false,
    include: (ctx) => ctx.anatomical_gift === 'specified',
    text: `ANATOMICAL GIFT

Upon my death, I give [ANATOMICAL SPECIFIED] for transplantation, therapy, research, or education, to the extent permitted by law.`,
  },

  {
    id: 'hcp_anatomical_none',
    document: ['hcp'],
    section: 'Anatomical Gift',
    order: 25,
    always: false,
    include: (ctx) => ctx.anatomical_gift === 'none',
    text: `ANATOMICAL GIFT

Upon my death, I do not wish to make an anatomical gift of any organs, tissues, or parts of my body.`,
  },

  {
    id: 'hcp_execution',
    document: ['hcp'],
    section: 'Execution',
    order: 30,
    always: true,
    text: `Signed this [Ordinal_DocDate].

[CLIENT FULL NAME], Principal

COMMONWEALTH OF MASSACHUSETTS
COUNTY OF [SIGNING COUNTY]

On [SIGNING DATE], before me, the undersigned notary public, personally appeared [CLIENT FULL NAME], proved to me through satisfactory evidence of identification, which was a government-issued photo identification, to be the person whose name is signed on the preceding or attached document, and acknowledged to me that [Client Pronoun] signed it voluntarily for its stated purpose.

______________________________________
Notary Public
My Commission Expires: [Notary Commission]`,
  },

]

// ─── HIPAA AUTHORIZATION ─────────────────────────────────────────────────

export const HIPAA_CLAUSES: Clause[] = [

  {
    id: 'hipaa_full',
    document: ['hipaa'],
    section: 'Authorization',
    order: 10,
    always: true,
    text: `AUTHORIZATION FOR RELEASE OF PROTECTED HEALTH INFORMATION

I, [CLIENT FULL NAME], intend this authorization to comply, now and in the future, with all requirements set forth in the Standards for Privacy of Individually Identifiable Health Information (known as the "Privacy Rule") which implements the privacy requirements of the Health Insurance Portability and Accountability Act of 1996 (Pub L 104-191, 110 Stat 1936; 45 CFR Sections 160-164), commonly known as "HIPAA," so that the information described below will be freely available to those described below.

My Additional Identification Information:

Name: [CLIENT FULL NAME]
Date of Birth: [DOB]

1. Identity of Person or Class of Persons Authorized to Make Disclosure. I hereby authorize all covered entities as defined in HIPAA, and all other health care providers, health plans, and health care clearinghouses, including but not limited to each and every doctor, psychiatrist, psychologist, dentist, therapist, nurse, hospital, clinic, pharmacy, laboratory, ambulance service, assisted living facility, residential care facility, bed and board facility, nursing home, medical insurance company or any other medical provider or agent thereof having protected health information, each being referred to herein as a "Covered Entity," to disclose the information set forth in the following paragraph.

2. Description of Information to Be Disclosed. All health care information, reports and/or records concerning my medical history, condition, diagnosis, testing, prognosis, treatment, billing information and identity of health care providers, whether past, present or future and any other information which is in any way related to my health care. Additionally, this disclosure shall include the ability to ask questions and discuss this protected medical information with the person or entity who has possession of the protected medical information even if I am fully competent to ask questions and discuss this matter at the time.

3. Person or Class of Persons to Whom the Covered Entity May Disclose the Above Described Protected Health Information. The above described information shall be disclosed to any Health Care Proxy acting or designated to act (whether named as a primary or alternate Health Care Proxy) in my Health Care Proxy, any Attorney-in-Fact acting or designated to act (whether named as a primary or alternate Attorney-in-Fact) in my Durable General Power of Attorney, and any trustee or successor trustee acting or designated to act with respect to any trust of which I am named as a beneficiary or trustee.

4. Purpose of Disclosure. At my request.

5. Termination. This Authorization shall terminate on the first to occur of: (1) two years following my death or (2) upon my written revocation actually received by the Covered Entity.

Signed this [Ordinal_DocDate].

[CLIENT FULL NAME]

COMMONWEALTH OF MASSACHUSETTS
COUNTY OF [SIGNING COUNTY]

On [SIGNING DATE], before me, the undersigned notary public, personally appeared [CLIENT FULL NAME], proved to me through satisfactory evidence of identification, which was a government-issued photo identification, to be the person whose name is signed on the preceding or attached document, and acknowledged to me that [Client Pronoun] signed it voluntarily for its stated purpose.

______________________________________
Notary Public
My Commission Expires: [Notary Commission]`,
  },

]

// ─── ADVANCE HEALTH DIRECTIVE ────────────────────────────────────────────

export const AHD_CLAUSES: Clause[] = [

  {
    id: 'ahd_full',
    document: ['ahd'],
    section: 'Advance Directive',
    order: 10,
    always: true,
    text: `ADVANCE DIRECTIVE OF [CLIENT FULL NAME]

I, [CLIENT FULL NAME] of [City], Massachusetts ("Principal"), willfully and voluntarily make known my desire under the circumstances set forth below, and I do hereby declare:

If I am incapable of making an informed decision regarding my health care, I direct my Health Care Agent under a duly executed Health Care Proxy or my health care providers, as the case may be, to follow my instructions as set forth below:

(1) If my death from a terminal condition (i.e. an incurable condition caused by injury, disease, or illness which, to a reasonable degree of medical certainty, makes death imminent and from which, despite the application of life-sustaining procedures, there can be no recovery) is imminent, I direct that my life not be extended by life-sustaining procedures including the administration of nutrition and hydration artificially, unless necessary for the relief of my pain or for my comfort.

(2) If I am in a persistent vegetative state (i.e. a condition caused by injury, disease, or illness in which I have suffered a loss of consciousness, exhibiting no behavioral evidence of self-awareness or awareness of surroundings in a learned manner other than reflex activity of muscles and nerves for low level conditioned response, and from which, after the passage of a medically appropriate period of time, it can be determined, to a reasonable degree of medical certainty, that there can be no recovery), I direct that my life not be extended by life-sustaining procedures, including the administration of nutrition and hydration artificially, unless necessary for the relief of my pain or for my comfort.

(3) If I have an end-stage condition (i.e. an advanced, progressive, irreversible condition caused by injury, disease, or illness that has caused severe and permanent deterioration indicated by my incompetency and complete physical dependency, and for which, to a reasonable degree of medical certainty, treatment of the irreversible condition would be medically ineffective), I direct that my life not be extended by life-sustaining procedures, including the administration of nutrition and hydration artificially, unless necessary for the relief of my pain or for my comfort.

(4) I request effective comfort care and pain relief even though it may hasten my death, including artificially administered hydration and nutrition if necessary or advisable for my pain relief or my comfort care. I wish to reassure my Health Care Agent, my family, and my health care providers that I recognize that death is as much a reality as birth, growth, maturity, and old age. It is my desire to limit my health care to that which offers some reasonable prospect of my recovery, or gives me comfort and support, alleviates pain, or which facilitates my interaction with others to the extent that this is possible.

In the absence of my ability to give directions regarding the use of such life-prolonging procedures, it is my intention that this Declaration be honored by my family and physician as the final expression of my legal right with regard to medical or surgical treatment and to accept the consequences therefor.

I empower my Health Care Proxy to speak for my family in their sole and unrestricted discretion in these matters.

This Advance Directive is intended to be used in conjunction with, and is supplemental to, my Massachusetts Health Care Proxy, my Durable General Power of Attorney, and my Authorization for Release of Protected Health Information (HIPAA Authorization), each executed on or about the date hereof.

IN WITNESS WHEREOF, I have executed this declaration, as my free and voluntary act and deed, on this [Ordinal_DocDate].

[CLIENT FULL NAME]`,
  },

]

// ─── PERSONAL PROPERTY MEMORANDUM ───────────────────────────────────────

export const PPM_CLAUSES: Clause[] = [

  {
    id: 'ppm_full',
    document: ['ppm'],
    section: 'Memorandum',
    order: 10,
    always: true,
    text: `MEMORANDUM FOR DISPOSITION OF PERSONAL EFFECTS
IN LAST WILL AND TESTAMENT OF [CLIENT FULL NAME]

To my Personal Representative:

This memorandum is declared to be attached to a copy of my Last Will and Testament, as provided therein and provides for the particular disposition of my Personal Effects. I direct my Personal Representative to take possession of such property as nominee only and to deliver such property to the following designated person(s) as soon after the opening of the administration of my Estate as possible.

[PERSONAL PROPERTY SCHEDULE TO BE COMPLETED BY CLIENT]

Dated: ___________________________

____________________________________
[CLIENT FULL NAME]`,
  },

]

// ─── PARENTAL APPOINTMENT OF GUARDIAN ───────────────────────────────────

export const PARENTAL_DELEGATION_CLAUSES: Clause[] = [

  {
    id: 'pd_full',
    document: ['parental_guardian_appointment'],
    section: 'Appointment',
    order: 10,
    always: true,
    text: `PARENTAL APPOINTMENT OF GUARDIAN
BY [CLIENT FULL NAME] AND [SPOUSE FULL NAME]

We, [CLIENT FULL NAME] and [SPOUSE FULL NAME], both of [Address] (both of whom are to be hereinafter sometimes referred to collectively as "Parents," or individually as "Parent"), hereby state:

A. We are the parents of the following minor children:

[CHILD FULL NAME] born on [Child DOB]

B. We hereby intend to create a Parental Appointment of Guardian for Minor according to M.G.L. c. 190B, § 5-202. In making this appointment, we are giving our Guardian(s) the authority to make any and all decisions with regard to the welfare of our above-named minor child(ren) and any other minor child of ours born or adopted after the date of this instrument pursuant to M.G.L. c. 190B, § 5-202 (a).

C. We hereby appoint as Guardian the following individual:

Name: [GUARDIAN] and [CO GUARDIAN]
Address: [Guardian Address]
Phone: [Guardian Phone]

D. If for any reason [GUARDIAN] and [CO GUARDIAN] are not able or willing to act as Guardian, then we appoint the following person as successor Guardian:

Name: [ALT GUARDIAN] and [CO ALT GUARDIAN]
Address: [Alt Guardian Address]
Phone: [Alt Guardian Phone]

E. Pursuant to M.G.L. c.190B § 5-202 (a), this appointment may be amended or revoked.

F. This Parental Appointment of Guardian for Minor shall be effective for thirty (30) days, upon the occurrence of one or more of the following events, pursuant to M.G.L. c. 190B, § 5-202:

1. The death of both of the Parents;
2. Adjudication of incapacity of both of the Parents;
3. The death of one Parent and the adjudication of incapacity of the other Parent; or
4. Written determination by a physician that both of the Parents are no longer able to care for their minor children.

IN WITNESS WHEREOF, we hereto set our hands and seals, and in the presence of two witnesses, declare this document to be our Parental Appointment of Guardian for Minor, this [Ordinal_DocDate].

[CLIENT FULL NAME]                    [SPOUSE FULL NAME]`,
  },

]

// Engagement-agreement clauses moved to lib/engagement/clauses.ts —
// assembled deterministically (no LLM) by app/api/admin/engagement/route.ts.

// ─── MASTER INDEX ────────────────────────────────────────────────────────

export const ALL_CLAUSES: Clause[] = [
  ...JOINT_TRUST_CLAUSES,
  ...POUR_OVER_WILL_CLAUSES,
  ...DPOA_CLAUSES,
  ...HCP_CLAUSES,
  ...HIPAA_CLAUSES,
  ...AHD_CLAUSES,
  ...PPM_CLAUSES,
  ...PARENTAL_DELEGATION_CLAUSES,
]

export function getClausesForDocument(docType: string, ctx: DraftContext): Clause[] {
  return ALL_CLAUSES
    .filter(c => c.document.includes(docType))
    .filter(c => c.always || (c.include && c.include(ctx)))
    .sort((a, b) => a.order - b.order)
}
