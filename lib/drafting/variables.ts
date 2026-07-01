/**
 * Placeholder variable builders for Aubrey Law document generation.
 *
 * buildClientVariables / buildSpouseVariables — original flat-sheet API,
 * kept for the template-fill route (app/api/admin/draft/[sheetId]/generate).
 *
 * buildClientVariables2 / buildSpouseVariables2 — new API used by
 * app/api/drafting/docx that takes separate intake + designSheet objects.
 */

import { formatPhoneDisplay } from '@/lib/phone'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function phone(value: unknown): string {
  return formatPhoneDisplay(typeof value === 'string' ? value : null)
}

function pronounHe(p: string): string {
  if (p.startsWith('he')) return 'he'
  if (p.startsWith('she')) return 'she'
  if (p.startsWith('they')) return 'they'
  return p
}
function pronounHis(p: string): string {
  if (p.startsWith('he')) return 'his'
  if (p.startsWith('she')) return 'her'
  if (p.startsWith('they')) return 'their'
  return p
}
function pronounHim(p: string): string {
  if (p.startsWith('he')) return 'him'
  if (p.startsWith('she')) return 'her'
  if (p.startsWith('they')) return 'them'
  return p
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] ?? ''
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function ordinalDate(d: Date): string {
  const day = d.getDate()
  const month = d.toLocaleDateString('en-US', { month: 'long' })
  const year = d.getFullYear()
  return `${ordinalSuffix(day)} day of ${month}, ${year}`
}

function formatSigningDate(month: unknown, year: unknown): string {
  const m = String(month ?? '').trim()
  const y = String(year ?? '').trim()
  if (!m && !y) return '__________, 20__'
  if (!m) return `__________, ${y}`
  if (!y) return `${m} __, 20__`
  return `${m} ${y}`
}

type SpecificBequestRow = {
  kind?: 'cash' | 'item' | 'charitable'
  amount?: number | null
  item_description?: string | null
  beneficiary_name?: string | null
  charity_name?: string | null
}

function formatSpecificBequests(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return ''
  const rows = raw as SpecificBequestRow[]
  return rows
    .map((b, i) => {
      const n = `(${i + 1})`
      if (b.kind === 'cash') {
        const amt = typeof b.amount === 'number'
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(b.amount)
          : '$________'
        return `${n} I give and bequeath the sum of ${amt} to ${b.beneficiary_name ?? '________'}, if such person survives me.`
      }
      if (b.kind === 'item') {
        return `${n} I give and bequeath ${b.item_description ?? '________'} to ${b.beneficiary_name ?? '________'}, if such person survives me.`
      }
      if (b.kind === 'charitable') {
        const amt = typeof b.amount === 'number'
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(b.amount)
          : '$________'
        return `${n} I give and bequeath ${amt} to ${b.charity_name ?? '________'}.`
      }
      return `${n} ________`
    })
    .join('\n\n')
}

// ─── Original flat-sheet builders (used by existing template-fill route) ─────

// Variables filled from the client's perspective
export function buildClientVariables(sheet: Record<string, unknown>): Record<string, string> {
  const str = (v: unknown) => String(v ?? '')
  const upper = (v: unknown) => str(v).toUpperCase()
  const cpron = str(sheet.client_pronouns)
  const spron = str(sheet.spouse_pronouns)
  const clientFullName = upper(sheet.client_name)
  const spouseFullName = upper(sheet.spouse_name)

  return {
    '[CLIENT]':            clientFullName,
    '[CLIENT FULL NAME]':  clientFullName,
    '[CLIENT FIRST NAME]': firstName(clientFullName),
    '[CLIENT AKA]':        upper(sheet.client_aka),

    '[SPOUSE]':            spouseFullName,
    '[SPOUSE FULL NAME]':  spouseFullName,
    '[SPOUSE FIRST NAME]': firstName(spouseFullName),
    '[SPOUSE AKA]':        upper(sheet.spouse_aka),

    '[CHILD FULL NAME]': upper(sheet.children_names),
    '[Child DOB]':       str(sheet.child_dob),

    '[TRUSTEE]':             upper(sheet.initial_trustee),
    '[CO TRUSTEE]':          upper(sheet.co_trustee),
    '[SUCCESSOR TRUSTEE]':   upper(sheet.successor_trustee),
    '[CO SUCCESSOR TRUSTEE]':upper(sheet.co_successor_trustee),

    '[PRIMARY HCP]':    upper(sheet.hcp_client_agent),
    '[ALTERNATE 1 HCP]':upper(sheet.hcp_client_alt1),
    '[ALTERNATE 2 HCP]':upper(sheet.hcp_client_alt2),
    '[ALTERNATE 3 HCP]':upper(sheet.hcp_client_alt3),

    '[ATTORNEY IN FACT]':        upper(sheet.poa_client_primary),
    '[CO ATTORNEY IN FACT]':     upper(sheet.poa_client_co),
    '[ALT ATTORNEY IN FACT]':    upper(sheet.poa_client_alt),
    '[CO ALT ATTORNEY IN FACT]': upper(sheet.poa_client_co_alt),

    '[PERSONAL REPRESENTATIVE]':        upper(sheet.personal_representative),
    '[CO PERSONAL REPRESENTATIVE]':     upper(sheet.personal_representative_co),
    '[ALT PERSONAL REPRESENTATIVE]':    upper(sheet.personal_representative_alt1),
    '[CO ALT PERSONAL REPRESENTATIVE]': upper(sheet.personal_representative_co_alt),

    '[GUARDIAN]':        upper(sheet.guardian),
    '[CO GUARDIAN]':     upper(sheet.co_guardian),
    '[ALT GUARDIAN]':    upper(sheet.alt_guardian),
    '[CO ALT GUARDIAN]': upper(sheet.co_alt_guardian),

    '[EXCLUDED PERSON]':   upper(sheet.excluded_person),
    '[EXCLUDED GUARDIAN]': upper(sheet.excluded_guardian),
    '[REMOTE BENEFICIARY]':upper(sheet.remote_beneficiary),

    '[Address]':       str(sheet.address),
    '[Street]':        str(sheet.street),
    '[City]':          str(sheet.city),
    '[State]':         str(sheet.state),
    '[County]':        str(sheet.county),
    '[SIGNING COUNTY]':str(sheet.signing_county || sheet.county),

    '[DocDate]':          str(sheet.doc_date),
    '[Ordinal_DocDate]':  str(sheet.ordinal_doc_date),
    '[SIGNING DATE]':     str(sheet.signing_date),
    '[Notary Commission]':str(sheet.notary_commission),

    '[Client Pronoun]': pronounHe(cpron),
    '[Client HisHer]':  pronounHis(cpron),
    '[Client HimHer]':  pronounHim(cpron),
    '[Spouse Pronoun]': pronounHe(spron),
    '[Spouse HisHer]':  pronounHis(spron),

    '[TRUST NAME]':       upper(sheet.trust_name),
    '[SPOUSE TRUST NAME]':upper(sheet.client2_trust_name),

    '[Primary HCP Relationship]':    str(sheet.hcp_client_relationship),
    '[Primary HCP Address]':         str(sheet.hcp_client_address),
    '[Primary HCP Phone]':           phone(sheet.hcp_client_phone),
    '[Alternate 1 HCP Relationship]':str(sheet.hcp_client_alt1_relationship),
    '[Alternate 1 HCP Address]':     str(sheet.hcp_client_alt1_address),
    '[Alternate 1 HCP Phone]':       phone(sheet.hcp_client_alt1_phone),
    '[Alternate 2 HCP Relationship]':str(sheet.hcp_client_alt2_relationship),
    '[Alternate 2 HCP Address]':     str(sheet.hcp_client_alt2_address),
    '[Alternate 2 HCP Phone]':       phone(sheet.hcp_client_alt2_phone),
    '[Alternate 3 HCP Relationship]':str(sheet.hcp_client_alt3_relationship),
    '[Alternate 3 HCP Address]':     str(sheet.hcp_client_alt3_address),
    '[Alternate 3 HCP Phone]':       phone(sheet.hcp_client_alt3_phone),

    '[Guardian Address]':    str(sheet.guardian_address),
    '[Guardian Phone]':      phone(sheet.guardian_phone),
    '[Alt Guardian Address]':str(sheet.alt_guardian_address),
    '[Alt Guardian Phone]':  phone(sheet.alt_guardian_phone),

    '[First]':               'first',
    '[NUMBER]':              'FIRST',
    '[DOB]':                 str(sheet.client_dob),
    '[Marital_Status_Clause]':str(sheet.marital_status_clause),

    '[TANGIBLE NAMED INDIVIDUAL]': upper(sheet.tangible_property_named_individual),
    '[UTMA AGE]':                  str(sheet.utma_age),
    '[ANATOMICAL SPECIFIED]':      str(sheet.anatomical_specified),
    '[SPECIFIC BEQUESTS LIST]':    str(sheet.specific_bequests_list),
  }
}

// Variables filled from the spouse's perspective
export function buildSpouseVariables(sheet: Record<string, unknown>): Record<string, string> {
  const str = (v: unknown) => String(v ?? '')
  const upper = (v: unknown) => str(v).toUpperCase()
  const cpron = str(sheet.client_pronouns)
  const spron = str(sheet.spouse_pronouns)
  const clientFullName = upper(sheet.client_name)
  const spouseFullName = upper(sheet.spouse_name)

  return {
    '[CLIENT]':            spouseFullName,
    '[CLIENT FULL NAME]':  spouseFullName,
    '[CLIENT FIRST NAME]': firstName(spouseFullName),
    '[CLIENT AKA]':        upper(sheet.spouse_aka),

    '[SPOUSE]':            clientFullName,
    '[SPOUSE FULL NAME]':  clientFullName,
    '[SPOUSE FIRST NAME]': firstName(clientFullName),
    '[SPOUSE AKA]':        upper(sheet.client_aka),

    '[CHILD FULL NAME]': upper(sheet.children_names),
    '[Child DOB]':       str(sheet.child_dob),

    '[TRUSTEE]':             upper(sheet.initial_trustee),
    '[CO TRUSTEE]':          upper(sheet.co_trustee),
    '[SUCCESSOR TRUSTEE]':   upper(sheet.successor_trustee),
    '[CO SUCCESSOR TRUSTEE]':upper(sheet.co_successor_trustee),

    '[PRIMARY HCP]':    upper(sheet.hcp_spouse_agent),
    '[ALTERNATE 1 HCP]':upper(sheet.hcp_spouse_alt1),
    '[ALTERNATE 2 HCP]':upper(sheet.hcp_spouse_alt2),
    '[ALTERNATE 3 HCP]':upper(sheet.hcp_spouse_alt3),

    '[ATTORNEY IN FACT]':        upper(sheet.poa_spouse_primary),
    '[CO ATTORNEY IN FACT]':     upper(sheet.poa_spouse_co),
    '[ALT ATTORNEY IN FACT]':    upper(sheet.poa_spouse_alt),
    '[CO ALT ATTORNEY IN FACT]': upper(sheet.poa_spouse_co_alt),

    '[PERSONAL REPRESENTATIVE]':        upper(sheet.personal_representative_spouse),
    '[CO PERSONAL REPRESENTATIVE]':     upper(sheet.personal_representative_spouse_co),
    '[ALT PERSONAL REPRESENTATIVE]':    upper(sheet.personal_representative_spouse_alt1),
    '[CO ALT PERSONAL REPRESENTATIVE]': upper(sheet.personal_representative_spouse_co_alt),

    '[GUARDIAN]':        upper(sheet.guardian),
    '[CO GUARDIAN]':     upper(sheet.co_guardian),
    '[ALT GUARDIAN]':    upper(sheet.alt_guardian),
    '[CO ALT GUARDIAN]': upper(sheet.co_alt_guardian),

    '[EXCLUDED PERSON]':   upper(sheet.excluded_person),
    '[EXCLUDED GUARDIAN]': upper(sheet.excluded_guardian),
    '[REMOTE BENEFICIARY]':upper(sheet.remote_beneficiary),

    '[Address]':       str(sheet.address),
    '[Street]':        str(sheet.street),
    '[City]':          str(sheet.city),
    '[State]':         str(sheet.state),
    '[County]':        str(sheet.county),
    '[SIGNING COUNTY]':str(sheet.signing_county || sheet.county),

    '[DocDate]':          str(sheet.doc_date),
    '[Ordinal_DocDate]':  str(sheet.ordinal_doc_date),
    '[SIGNING DATE]':     str(sheet.signing_date),
    '[Notary Commission]':str(sheet.notary_commission),

    '[Client Pronoun]': pronounHe(spron),
    '[Client HisHer]':  pronounHis(spron),
    '[Client HimHer]':  pronounHim(spron),
    '[Spouse Pronoun]': pronounHe(cpron),
    '[Spouse HisHer]':  pronounHis(cpron),

    '[TRUST NAME]':       upper(sheet.client2_trust_name),
    '[SPOUSE TRUST NAME]':upper(sheet.trust_name),

    '[Primary HCP Relationship]':    str(sheet.hcp_spouse_relationship),
    '[Primary HCP Address]':         str(sheet.hcp_spouse_address),
    '[Primary HCP Phone]':           phone(sheet.hcp_spouse_phone),
    '[Alternate 1 HCP Relationship]':str(sheet.hcp_spouse_alt1_relationship),
    '[Alternate 1 HCP Address]':     str(sheet.hcp_spouse_alt1_address),
    '[Alternate 1 HCP Phone]':       phone(sheet.hcp_spouse_alt1_phone),
    '[Alternate 2 HCP Relationship]':str(sheet.hcp_spouse_alt2_relationship),
    '[Alternate 2 HCP Address]':     str(sheet.hcp_spouse_alt2_address),
    '[Alternate 2 HCP Phone]':       phone(sheet.hcp_spouse_alt2_phone),
    '[Alternate 3 HCP Relationship]':str(sheet.hcp_spouse_alt3_relationship),
    '[Alternate 3 HCP Address]':     str(sheet.hcp_spouse_alt3_address),
    '[Alternate 3 HCP Phone]':       phone(sheet.hcp_spouse_alt3_phone),

    '[Guardian Address]':    str(sheet.guardian_address),
    '[Guardian Phone]':      phone(sheet.guardian_phone),
    '[Alt Guardian Address]':str(sheet.alt_guardian_address),
    '[Alt Guardian Phone]':  phone(sheet.alt_guardian_phone),

    '[First]':               'first',
    '[NUMBER]':              'FIRST',
    '[DOB]':                 str(sheet.spouse_dob),
    '[Marital_Status_Clause]':str(sheet.marital_status_clause),

    '[TANGIBLE NAMED INDIVIDUAL]': upper(sheet.tangible_property_named_individual),
    '[UTMA AGE]':                  str(sheet.utma_age),
    '[ANATOMICAL SPECIFIED]':      str(sheet.anatomical_specified),
    '[SPECIFIC BEQUESTS LIST]':    str(sheet.specific_bequests_list),
  }
}

// ─── Flat-sheet builder from intake + design_sheet (for new drafting routes) ──

/**
 * Merges intake + designSheet into the flat sheet shape expected by
 * buildClientVariables / buildSpouseVariables.
 *
 * Fiduciaries are resolved from intake.fiduciaries (legacy Fiduciaries object)
 * or intake.fiduciary_entries (new array format).
 */
export function buildFlatSheet(
  intake: Record<string, unknown>,
  designSheet: Record<string, unknown>,
): Record<string, unknown> {
  const str   = (v: unknown) => String(v ?? '')
  const upper = (v: unknown) => str(v).toUpperCase()

  const clientFirst = str(intake.first_name)
  const clientLast  = str(intake.last_name)
  const clientFull  = `${clientFirst} ${clientLast}`.trim()

  const spouseFirst = str(intake.spouse_first_name)
  const spouseLast  = str(intake.spouse_last_name)
  const spouseFull  = `${spouseFirst} ${spouseLast}`.trim()

  const city   = str(intake.city)
  const state  = str(intake.state)
  const county = str(intake.county)
  const street = str(intake.address_line1)
  const zip    = str(intake.zip)
  const addr2  = intake.address_line2 ? str(intake.address_line2) : ''
  const fullAddress = [street, addr2, `${city}, ${state} ${zip}`].filter(Boolean).join(', ')

  // Children
  type ChildRow = { first_name?: string; last_name?: string; date_of_birth?: string }
  const children = (Array.isArray(intake.children) ? intake.children : []) as ChildRow[]
  const childNames = children
    .map(c => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim())
    .filter(Boolean)
    .join(', ')
  const childDob = children[0]?.date_of_birth ?? ''

  // Fiduciaries — legacy object map. The old `fidArray` branch (reading
  // intake.fiduciary_entries as a flat array) was unreachable; the column
  // has always been an object. Drafting now reads fiduciaries from
  // contact_roles via the design-sheet projection.
  const fids    = (typeof intake.fiduciaries === 'object' && intake.fiduciaries
    ? intake.fiduciaries
    : {}) as Record<string, string>

  function getFidByRole(_role: string, _subject: 'client' | 'spouse', _isPrimary: boolean): string {
    return ''
  }

  // In joint revocable trust the initial trustees ARE the grantors
  const initialTrustee    = clientFull
  const coTrustee         = spouseFull

  // Successor trustee — from fiduciary data
  let successorTrustee   = getFidByRole('personal_rep', 'client', true)
  let coSuccessorTrustee = ''
  if (!successorTrustee && fids) {
    successorTrustee   = upper(fids.trustee_pr || fids.successor_trustee || fids.trustee || '')
    coSuccessorTrustee = upper(fids.trustee_pr_co || fids.trustee_pr_alt1 || '')
  }

  // HCP
  let hcpPrimary = getFidByRole('hcp', 'client', true)
  let hcpAlt1 = getFidByRole('hcp', 'client', false)
  if (!hcpPrimary && fids) {
    hcpPrimary = upper(fids.hc_proxy || '')
    hcpAlt1    = upper(fids.hcp_alt1 || '')
  }
  const hcpAlt2 = fids.hcp_alt2 ? upper(fids.hcp_alt2) : ''
  const hcpAlt3 = fids.hcp_alt3 ? upper(fids.hcp_alt3) : ''

  // Spouse HCP
  let spouseHcpPrimary = getFidByRole('hcp', 'spouse', true)
  let spouseHcpAlt1    = getFidByRole('hcp', 'spouse', false)
  if (!spouseHcpPrimary && fids) {
    spouseHcpPrimary = upper(fids.spouse_hcp || fids.spouse_fa || '')
    spouseHcpAlt1    = ''
  }

  // POA
  let poaPrimary = getFidByRole('poa', 'client', true)
  let poaAlt     = getFidByRole('poa', 'client', false)
  if (!poaPrimary && fids) {
    poaPrimary = upper(fids.poa_agent || fids.financial_agent || '')
    poaAlt     = upper(fids.fa_alt1 || fids.successor_financial_agent || '')
  }

  // Spouse POA
  let spousePoaPrimary = getFidByRole('poa', 'spouse', true)
  if (!spousePoaPrimary && fids) {
    spousePoaPrimary = upper(fids.spouse_fa || '')
  }

  // Personal Representative
  let prPrimary = getFidByRole('personal_rep', 'client', true)
  let prAlt     = getFidByRole('personal_rep', 'client', false)
  if (!prPrimary && fids) {
    prPrimary = upper(fids.executor || fids.trustee_pr || '')
    prAlt     = upper(fids.successor_executor || fids.trustee_pr_alt1 || '')
  }

  // Spouse PR
  let spousePrPrimary = getFidByRole('personal_rep', 'spouse', true)
  if (!spousePrPrimary && fids) {
    spousePrPrimary = upper(fids.spouse_rep_primary || '')
  }

  // Guardian
  let guardianPrimary = getFidByRole('guardian', 'client', true)
  let guardianAlt     = getFidByRole('guardian', 'client', false)
  if (!guardianPrimary && fids) {
    const guardOrder = Array.isArray(fids.guardian_order) ? fids.guardian_order as string[] : []
    guardianPrimary = upper(fids.guardian || guardOrder[0] || '')
    guardianAlt     = upper(guardOrder[1] || fids.temporary_guardian || '')
  }

  // Decisions
  const decisions = (typeof designSheet.decisions === 'object' && designSheet.decisions
    ? designSheet.decisions
    : {}) as Record<string, unknown>

  const excludedPerson   = upper(decisions.excluded_person  ?? intake.excluded_person  ?? '')
  const excludedGuardian = upper(decisions.excluded_guardian ?? intake.excluded_guardian ?? '')

  // Trust name
  const trustName = `THE ${upper(clientLast)} FAMILY REVOCABLE LIVING TRUST`
  const spouseTrustName = spouseLast !== clientLast
    ? `THE ${upper(spouseLast)} FAMILY REVOCABLE LIVING TRUST`
    : trustName

  // Doc date
  const today = new Date()
  const docDate     = longDate(today)
  const ordinalDocDate = ordinalDate(today)

  return {
    client_name:       clientFull,
    spouse_name:       spouseFull,
    client_pronouns:   str(intake.preferred_pronoun || 'he/him'),
    spouse_pronouns:   str(intake.spouse_preferred_pronoun || 'she/her'),
    client_aka:        str(intake.prior_names),
    spouse_aka:        str(intake.spouse_prior_names),

    children_names:    childNames,
    child_dob:         childDob,

    initial_trustee:   initialTrustee,
    co_trustee:        coTrustee,
    successor_trustee: successorTrustee,
    co_successor_trustee: coSuccessorTrustee,

    hcp_client_agent:  hcpPrimary,
    hcp_client_alt1:   hcpAlt1,
    hcp_client_alt2:   hcpAlt2,
    hcp_client_alt3:   hcpAlt3,

    hcp_spouse_agent:  spouseHcpPrimary,
    hcp_spouse_alt1:   spouseHcpAlt1,
    hcp_spouse_alt2:   '',
    hcp_spouse_alt3:   '',

    poa_client_primary:  poaPrimary,
    poa_client_co:       '',
    poa_client_alt:      poaAlt,
    poa_client_co_alt:   '',

    poa_spouse_primary:  spousePoaPrimary,
    poa_spouse_co:       '',
    poa_spouse_alt:      '',
    poa_spouse_co_alt:   '',

    personal_representative:         prPrimary,
    personal_representative_co:      '',
    personal_representative_alt1:    prAlt,
    personal_representative_co_alt:  '',

    personal_representative_spouse:          spousePrPrimary,
    personal_representative_spouse_co:       '',
    personal_representative_spouse_alt1:     '',
    personal_representative_spouse_co_alt:   '',

    guardian:          guardianPrimary,
    co_guardian:       '',
    alt_guardian:      guardianAlt,
    co_alt_guardian:   '',
    guardian_address:  '',
    guardian_phone:    '',
    alt_guardian_address: '',
    alt_guardian_phone:   '',

    excluded_person:   excludedPerson,
    excluded_guardian: excludedGuardian,
    remote_beneficiary: '',

    address:       fullAddress,
    street,
    city,
    state,
    county,

    doc_date:          docDate,
    ordinal_doc_date:  ordinalDocDate,
    signing_date:      formatSigningDate(designSheet.signing_month, designSheet.signing_year),
    signing_county:    str(designSheet.signing_county),
    notary_commission: str(designSheet.notary_commission_expiration),

    tangible_property_named_individual: str(designSheet.tangible_property_named_individual),
    utma_age:               String(designSheet.utma_age ?? 21),
    anatomical_specified:   str(designSheet.hcp_anatomical_specified),
    specific_bequests_list: formatSpecificBequests(designSheet.specific_bequests),

    client_dob:        str(intake.date_of_birth),
    spouse_dob:        str(intake.spouse_date_of_birth),

    trust_name:        trustName,
    client2_trust_name: spouseTrustName,

    marital_status_clause: intake.marital_status === 'married'
      ? `I am married to ${spouseFull}.`
      : 'I am not married.',

    // HCP contact details (not collected in intake — left blank)
    hcp_client_relationship: '', hcp_client_address: '', hcp_client_phone: '',
    hcp_client_alt1_relationship: '', hcp_client_alt1_address: '', hcp_client_alt1_phone: '',
    hcp_client_alt2_relationship: '', hcp_client_alt2_address: '', hcp_client_alt2_phone: '',
    hcp_client_alt3_relationship: '', hcp_client_alt3_address: '', hcp_client_alt3_phone: '',
    hcp_spouse_relationship: '', hcp_spouse_address: '', hcp_spouse_phone: '',
    hcp_spouse_alt1_relationship: '', hcp_spouse_alt1_address: '', hcp_spouse_alt1_phone: '',
    hcp_spouse_alt2_relationship: '', hcp_spouse_alt2_address: '', hcp_spouse_alt2_phone: '',
    hcp_spouse_alt3_relationship: '', hcp_spouse_alt3_address: '', hcp_spouse_alt3_phone: '',
  }
}

// ─── Engagement agreement variable builder ─────────────────────────────────

export interface EngagementVariableInput {
  clientName: string
  attorneyName: string
  firmName: string
  feeAmount: number
  scopeOfWork: string
  paymentTerms: string
  effectiveDate: string
  practiceArea: string
}

export function buildEngagementVariables(data: EngagementVariableInput): Record<string, string> {
  const formattedFee = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.feeAmount)
  return {
    '[CLIENT NAME]':    data.clientName.toUpperCase(),
    '[ATTORNEY NAME]':  data.attorneyName,
    '[FIRM NAME]':      data.firmName,
    '[FEE AMOUNT]':     formattedFee,
    '[SCOPE OF WORK]':  data.scopeOfWork,
    '[PAYMENT TERMS]':  data.paymentTerms,
    '[EFFECTIVE DATE]': data.effectiveDate,
    '[PRACTICE AREA]':  data.practiceArea,
  }
}

export { escapeXml }
