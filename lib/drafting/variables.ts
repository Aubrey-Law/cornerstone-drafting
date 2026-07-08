/**
 * Placeholder variable builders for Aubrey Law document generation.
 *
 * buildClientVariables / buildSpouseVariables — flat-sheet API for template fill.
 *
 * Flat-sheet projection lives in ./projectDesignSheet.ts.
 */

import { formatPhoneDisplay } from '@/lib/phone'

export {
  projectDesignSheetToFlatSheet,
  projectDraftPayloadToFlatSheet,
} from './projectDesignSheet'

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
    '[ADDITIONAL DISINHERITANCE LANGUAGE]': str(sheet.additional_disinheritance_language),
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
    '[ADDITIONAL DISINHERITANCE LANGUAGE]': str(sheet.additional_disinheritance_language),
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
