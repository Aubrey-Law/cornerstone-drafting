import type { DraftPayload } from '@/lib/draftPayload/types'
import type { DesignSheetRow } from '@/lib/draftPayload/types'
import { designSheetString, isDesignSheetMarried } from '@/lib/draftPayload/designSheetFields'
import { buildFiduciariesFromDesignSheet } from '@/lib/draftPayload/helpers'
import { draftPayloadFamilyProvisions } from '@/lib/draftPayload/familyProvisions'
import type { ContactRow } from '@/lib/draftPayload/types'

type DesignSheetChildRow = {
  name?: string
  dob?: string | null
  first_name?: string
  middle_name?: string
  last_name?: string
}

type FlatSheet = Record<string, unknown>

function str(v: unknown): string {
  return String(v ?? '')
}

function upper(v: unknown): string {
  return str(v).toUpperCase()
}

function ordinalSuffix(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const mod = n % 100
  return n + (suffixes[(mod - 20) % 10] || suffixes[mod] || suffixes[0])
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

export function formatSpecificBequests(raw: unknown): string {
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

function childDisplayName(child: DesignSheetChildRow): string {
  const composed = typeof child.name === 'string' ? child.name.trim() : ''
  if (composed) return composed
  return [child.first_name, child.middle_name, child.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
}

function fiduciaryFlatFields(
  fiduciaries: DraftPayload['fiduciaries'],
  clientFull: string,
  spouseFull: string,
): FlatSheet {
  return {
    initial_trustee: upper(fiduciaries.trustee_initial || clientFull),
    co_trustee: upper(fiduciaries.trustee_co || spouseFull),
    successor_trustee: upper(fiduciaries.trustee_successor),
    co_successor_trustee: upper(fiduciaries.trustee_co_successor),

    hcp_client_agent: upper(fiduciaries.hcp_primary),
    hcp_client_alt1: upper(fiduciaries.hcp_successor),
    hcp_client_alt2: '',
    hcp_client_alt3: '',

    hcp_spouse_agent: upper(fiduciaries.spouse_hcp_primary),
    hcp_spouse_alt1: upper(fiduciaries.spouse_hcp_successor),
    hcp_spouse_alt2: '',
    hcp_spouse_alt3: '',

    poa_client_primary: upper(fiduciaries.dpoa_primary),
    poa_client_co: upper(fiduciaries.dpoa_co_agent),
    poa_client_alt: upper(fiduciaries.dpoa_successor),
    poa_client_co_alt: '',

    poa_spouse_primary: upper(fiduciaries.spouse_dpoa_primary),
    poa_spouse_co: '',
    poa_spouse_alt: upper(fiduciaries.spouse_dpoa_successor),
    poa_spouse_co_alt: '',

    personal_representative: upper(fiduciaries.pr_primary),
    personal_representative_co: upper(fiduciaries.pr_co_primary),
    personal_representative_alt1: upper(fiduciaries.pr_successor),
    personal_representative_co_alt: upper(fiduciaries.pr_co_successor),

    personal_representative_spouse: upper(fiduciaries.spouse_pr_primary),
    personal_representative_spouse_co: '',
    personal_representative_spouse_alt1: upper(fiduciaries.spouse_pr_successor),
    personal_representative_spouse_co_alt: '',

    guardian: upper(fiduciaries.guardian_primary),
    co_guardian: '',
    alt_guardian: upper(fiduciaries.guardian_successor),
    co_alt_guardian: upper(fiduciaries.guardian_second_successor),

    hcp_client_relationship: str(fiduciaries.hcp_primary_relationship),
    hcp_client_address: str(fiduciaries.hcp_primary_address),
    hcp_client_phone: '',
    hcp_client_alt1_relationship: str(fiduciaries.hcp_successor_relationship),
    hcp_client_alt1_address: str(fiduciaries.hcp_successor_address),
    hcp_client_alt1_phone: '',
    hcp_client_alt2_relationship: '',
    hcp_client_alt2_address: '',
    hcp_client_alt2_phone: '',
    hcp_client_alt3_relationship: '',
    hcp_client_alt3_address: '',
    hcp_client_alt3_phone: '',

    hcp_spouse_relationship: str(fiduciaries.spouse_hcp_primary_relationship),
    hcp_spouse_address: str(fiduciaries.spouse_hcp_primary_address),
    hcp_spouse_phone: '',
    hcp_spouse_alt1_relationship: str(fiduciaries.spouse_hcp_successor_relationship),
    hcp_spouse_alt1_address: str(fiduciaries.spouse_hcp_successor_address),
    hcp_spouse_alt1_phone: '',
    hcp_spouse_alt2_relationship: '',
    hcp_spouse_alt2_address: '',
    hcp_spouse_alt2_phone: '',
    hcp_spouse_alt3_relationship: '',
    hcp_spouse_alt3_address: '',
    hcp_spouse_alt3_phone: '',

    guardian_address: '',
    guardian_phone: '',
    alt_guardian_address: '',
    alt_guardian_phone: '',
  }
}

function legacyFiduciaryFlatFields(sheet: DesignSheetRow): FlatSheet {
  return {
    initial_trustee: upper(designSheetString(sheet, 'client_name')),
    co_trustee: upper(designSheetString(sheet, 'spouse_name')),
    successor_trustee: upper(sheet.trustee_alt1 || sheet.executor_primary || ''),
    co_successor_trustee: upper(sheet.trustee_alt1_co || sheet.executor_alt1_co || ''),

    hcp_client_agent: upper(sheet.hcp_primary || ''),
    hcp_client_alt1: upper(sheet.hcp_alt1 || ''),
    hcp_client_alt2: '',
    hcp_client_alt3: '',

    hcp_spouse_agent: upper(sheet.hcp_co || ''),
    hcp_spouse_alt1: upper(sheet.hcp_alt1_co || ''),
    hcp_spouse_alt2: '',
    hcp_spouse_alt3: '',

    poa_client_primary: upper(sheet.poa_primary || ''),
    poa_client_co: upper(sheet.poa_co || ''),
    poa_client_alt: upper(sheet.poa_alt1 || ''),
    poa_client_co_alt: '',

    poa_spouse_primary: '',
    poa_spouse_co: '',
    poa_spouse_alt: '',
    poa_spouse_co_alt: '',

    personal_representative: upper(sheet.executor_primary || ''),
    personal_representative_co: upper(sheet.executor_co || ''),
    personal_representative_alt1: upper(sheet.executor_alt1 || ''),
    personal_representative_co_alt: upper(sheet.executor_alt1_co || ''),

    personal_representative_spouse: '',
    personal_representative_spouse_co: '',
    personal_representative_spouse_alt1: '',
    personal_representative_spouse_co_alt: '',

    guardian: upper(sheet.guardian_primary || ''),
    co_guardian: upper(sheet.guardian_co || ''),
    alt_guardian: upper(sheet.guardian_alt1 || ''),
    co_alt_guardian: upper(sheet.guardian_alt1_co || ''),
    guardian_address: '',
    guardian_phone: '',
    alt_guardian_address: '',
    alt_guardian_phone: '',

    hcp_client_relationship: '',
    hcp_client_address: '',
    hcp_client_phone: '',
    hcp_client_alt1_relationship: '',
    hcp_client_alt1_address: '',
    hcp_client_alt1_phone: '',
    hcp_client_alt2_relationship: '',
    hcp_client_alt2_address: '',
    hcp_client_alt2_phone: '',
    hcp_client_alt3_relationship: '',
    hcp_client_alt3_address: '',
    hcp_client_alt3_phone: '',
    hcp_spouse_relationship: '',
    hcp_spouse_address: '',
    hcp_spouse_phone: '',
    hcp_spouse_alt1_relationship: '',
    hcp_spouse_alt1_address: '',
    hcp_spouse_alt1_phone: '',
    hcp_spouse_alt2_relationship: '',
    hcp_spouse_alt2_address: '',
    hcp_spouse_alt2_phone: '',
    hcp_spouse_alt3_relationship: '',
    hcp_spouse_alt3_address: '',
    hcp_spouse_alt3_phone: '',
  }
}

function baseFlatFieldsFromDesignSheet(sheet: DesignSheetRow): FlatSheet {
  const clientFull = designSheetString(sheet, 'client_name') ?? ''
  const spouseFull = designSheetString(sheet, 'spouse_name') ?? ''
  const city = designSheetString(sheet, 'city') ?? ''
  const state = designSheetString(sheet, 'state') ?? ''
  const county = designSheetString(sheet, 'county') ?? ''
  const street = designSheetString(sheet, 'street') ?? ''
  const zip = designSheetString(sheet, 'zip') ?? ''
  const fullAddress = [street, `${city}, ${state} ${zip}`.trim()].filter(Boolean).join(', ')

  const children = Array.isArray(sheet.children) ? sheet.children : []
  const childNames = children.map(child => childDisplayName(child as DesignSheetChildRow)).filter(Boolean).join(', ')
  const childDob = (children[0] as DesignSheetChildRow | undefined)?.dob ?? ''

  const decisions = (typeof sheet.decisions === 'object' && sheet.decisions ? sheet.decisions : {}) as Record<string, unknown>
  const familyProvisions = draftPayloadFamilyProvisions(sheet)
  const excludedPerson = familyProvisions.disinherited.length > 0
    ? upper(familyProvisions.disinherited.map(person => person.full_name).join(', '))
    : upper(decisions.excluded_person ?? '')
  const excludedGuardian = sheet.excluded_guardian_flag && sheet.excluded_guardian_name
    ? upper(sheet.excluded_guardian_name)
    : upper(decisions.excluded_guardian ?? '')

  const clientLast = clientFull.split(/\s+/).pop() ?? ''
  const spouseLast = spouseFull.split(/\s+/).pop() ?? ''
  const trustName = sheet.trust_name
    ? str(sheet.trust_name)
    : `THE ${upper(clientLast)} FAMILY REVOCABLE LIVING TRUST`
  const spouseTrustName = sheet.spouse_trust_name
    ? str(sheet.spouse_trust_name)
    : spouseLast !== clientLast
      ? `THE ${upper(spouseLast)} FAMILY REVOCABLE LIVING TRUST`
      : trustName

  const today = new Date()
  const isMarried = isDesignSheetMarried(sheet)

  return {
    client_name: clientFull,
    spouse_name: spouseFull,
    client_pronouns: str(sheet.client_pronouns || 'he/him'),
    spouse_pronouns: str(sheet.spouse_pronouns || 'she/her'),
    client_aka: str(sheet.client_aka),
    spouse_aka: str(sheet.spouse_aka),
    children_names: childNames,
    child_dob: childDob,
    excluded_person: excludedPerson,
    additional_disinheritance_language: familyProvisions.additional_disinheritance_language ?? '',
    excluded_guardian: excludedGuardian,
    remote_beneficiary: '',
    address: fullAddress,
    street,
    city,
    state,
    county,
    doc_date: longDate(today),
    ordinal_doc_date: ordinalDate(today),
    signing_date: formatSigningDate(sheet.signing_month, sheet.signing_year),
    signing_county: str(sheet.signing_county),
    notary_commission: str(sheet.notary_commission_expiration),
    tangible_property_named_individual: str(sheet.tangible_property_named_individual),
    utma_age: String(sheet.utma_age ?? 21),
    anatomical_specified: str(sheet.hcp_anatomical_specified),
    specific_bequests_list: formatSpecificBequests(sheet.specific_bequests),
    client_dob: str(sheet.client_dob),
    spouse_dob: str(sheet.spouse_dob),
    trust_name: trustName,
    client2_trust_name: spouseTrustName,
    marital_status_clause: isMarried && spouseFull
      ? `I am married to ${spouseFull}.`
      : 'I am not married.',
  }
}

/**
 * Project a design sheet (plus optional resolved fiduciaries) into the flat
 * record shape consumed by buildClientVariables / buildSpouseVariables.
 */
export function projectDesignSheetToFlatSheet(args: {
  designSheet: Record<string, unknown>
  fiduciaries?: DraftPayload['fiduciaries']
  contacts?: ContactRow[]
}): FlatSheet {
  const sheet = args.designSheet as unknown as DesignSheetRow
  const clientFull = designSheetString(sheet, 'client_name') ?? ''
  const spouseFull = designSheetString(sheet, 'spouse_name') ?? ''

  let fiduciaries = args.fiduciaries
  if (!fiduciaries && args.contacts) {
    fiduciaries = buildFiduciariesFromDesignSheet(
      sheet,
      args.contacts,
      { full_name: clientFull, address: designSheetString(sheet, 'street') },
      spouseFull ? { full_name: spouseFull, address: null } : null,
    )
  }

  const fiduciaryFields = fiduciaries
    ? fiduciaryFlatFields(fiduciaries, clientFull, spouseFull)
    : legacyFiduciaryFlatFields(sheet)

  return {
    ...baseFlatFieldsFromDesignSheet(sheet),
    ...fiduciaryFields,
  }
}

/**
 * Canonical flat-sheet projection used by every template-fill path. Maps the
 * same DraftPayload the Node generator uses into placeholder variable input.
 */
export function projectDraftPayloadToFlatSheet(payload: DraftPayload): FlatSheet {
  const client = payload.client
  const spouse = payload.spouse
  const clientFull = client.full_name
  const spouseFull = spouse?.full_name ?? ''
  const street = client.address ?? ''
  const city = client.city ?? ''
  const state = client.state ?? ''
  const zip = client.zip ?? ''
  const fullAddress = [street, `${city}, ${state} ${zip}`.trim()].filter(Boolean).join(', ')

  const childNames = payload.children.map(child => child.full_name).filter(Boolean).join(', ')
  const childDob = payload.children[0]?.dob ?? ''
  const familyProvisions = payload.family_provisions ?? draftPayloadFamilyProvisions(null)
  const excludedPerson = familyProvisions.disinherited.length > 0
    ? upper(familyProvisions.disinherited.map(person => person.full_name).join(', '))
    : ''

  const clientLast = client.last_name || clientFull.split(/\s+/).pop() || ''
  const spouseLast = spouse?.last_name || spouseFull.split(/\s+/).pop() || ''
  const trustName = payload.trust?.name
    ?? (spouseFull ? `THE ${clientLast.toUpperCase()} FAMILY REVOCABLE LIVING TRUST` : `${clientFull} Revocable Living Trust`)
  const spouseTrustName = payload.trust?.name && spouseFull && spouseLast !== clientLast
    ? `THE ${spouseLast.toUpperCase()} FAMILY REVOCABLE LIVING TRUST`
    : trustName

  const today = new Date()
  const isMarried = payload.matter.type !== 'individual'

  return {
    client_name: clientFull,
    spouse_name: spouseFull,
    client_pronouns: client.preferred_pronoun ?? 'he/him',
    spouse_pronouns: spouse?.preferred_pronoun ?? 'she/her',
    client_aka: client.aka ?? '',
    spouse_aka: spouse?.aka ?? '',
    children_names: childNames,
    child_dob: childDob,
    excluded_person: excludedPerson,
    additional_disinheritance_language: familyProvisions.additional_disinheritance_language ?? '',
    excluded_guardian: upper(client.excluded_guardian),
    remote_beneficiary: '',
    address: fullAddress,
    street,
    city,
    state,
    county: client.county ?? '',
    doc_date: longDate(today),
    ordinal_doc_date: ordinalDate(today),
    signing_date: formatSigningDate(payload.execution.signing_month, payload.execution.signing_year),
    signing_county: str(payload.execution.signing_county || client.county),
    notary_commission: str(payload.execution.notary_commission_expiration),
    tangible_property_named_individual: str(payload.will_provisions.tangible_property_named_individual),
    utma_age: String(payload.will_provisions.utma_age ?? 21),
    anatomical_specified: str(payload.hcp_provisions.anatomical_specified),
    specific_bequests_list: formatSpecificBequests(payload.will_provisions.specific_bequests),
    client_dob: client.dob ?? '',
    spouse_dob: spouse?.dob ?? '',
    trust_name: trustName,
    client2_trust_name: spouseTrustName,
    marital_status_clause: isMarried && spouseFull
      ? `I am married to ${spouseFull}.`
      : 'I am not married.',
    ...fiduciaryFlatFields(payload.fiduciaries, clientFull, spouseFull),
  }
}
