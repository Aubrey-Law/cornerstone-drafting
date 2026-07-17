import generateAgenda from '@/lib/pmps/templates/pmps-agenda'
import generateProposal from '@/lib/pmps/templates/pmps-proposal'
import generateTaxWorksheet from '@/lib/pmps/templates/pmps-tax-worksheet'
import generateOnePageSummary from '@/lib/pmps/templates/pmps-one-page-summary'
import { computeMATax } from '@/lib/pmps/templates/pmps-tax-calc'
import type { PmpsArtifact, PmpsArtifactKind, PmpsData } from '@/lib/pmps/types'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const

type TemplateGenerator = (data: Record<string, unknown>) => Promise<Buffer>

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function approximateMoney(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)} million`
  return money(Math.round(value / 1_000) * 1_000)
}

function displayDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' }).format(parsed)
}

function age(value: string | null) {
  if (!value) return null
  const dob = new Date(`${value}T12:00:00`)
  if (Number.isNaN(dob.valueOf())) return null
  const today = new Date()
  let years = today.getFullYear() - dob.getFullYear()
  if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) years -= 1
  return years
}

function documentList(data: PmpsData) {
  const docs: Array<Record<string, unknown>> = []
  const push = (enabled: boolean | undefined, name: string, category: string, options: Record<string, unknown> = {}) => {
    if (enabled) docs.push({ name, category, ...options })
  }
  if (data.documents.include_trust) {
    if (data.clients.type === 'couple' && data.planStructure === 'separate_clayton') {
      docs.push({ name: 'Revocable Living Trust', displayName: `Revocable Living Trust (${data.clients.client.fullName})`, category: 'core', forSpouse: 1 })
      docs.push({ name: 'Revocable Living Trust', displayName: `Revocable Living Trust (${data.clients.spouse?.fullName})`, category: 'core', forSpouse: 2 })
    } else {
      docs.push({ name: 'Revocable Living Trust', category: 'core', joint: data.clients.type === 'couple' })
    }
  }
  push(data.documents.include_pour_over_will, 'Pour-Over Will', 'will', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_simple_will, 'Last Will and Testament', 'will', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_testamentary_trust_will, 'Testamentary Trust Will', 'will', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_dpoa, 'Durable Power of Attorney', 'incapacity', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_hcp, 'Health Care Proxy', 'incapacity', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_hipaa, 'HIPAA Authorization', 'incapacity', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_ahd, 'Advance Health Directive (Living Will)', 'incapacity', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_ppm, 'Personal Property Memorandum', 'will', { perSpouse: data.clients.type === 'couple' })
  push(data.documents.include_certificate_of_trust, 'Certificate of Trust', 'asset', { perSpouse: data.planStructure === 'separate_clayton' })
  push(data.documents.include_assignment_of_personal_property, 'Assignment of Tangible Personal Property', 'asset', { joint: data.clients.type === 'couple' })
  push(data.documents.include_deed, 'Quitclaim Deed', 'asset', { joint: true })
  push(data.documents.include_parental_appointment, 'Parental Appointment of Guardian', 'guardian', { joint: data.clients.type === 'couple' })
  push(data.documents.include_temp_delegation, 'Temporary Delegation of Parental Powers', 'guardian', { joint: data.clients.type === 'couple' })
  return docs
}

function fiduciarySet(data: PmpsData, spouse: 1 | 2) {
  const f = data.fiduciaries
  if (spouse === 2) {
    return {
      initialTrustee: data.clients.spouse?.fullName ?? null,
      successorTrustees: [f.spouse_trustee_successor].filter(Boolean),
      personalRep: f.spouse_pr_primary ?? null,
      poaAgent: f.spouse_dpoa_primary ?? null,
      poaSuccessor: f.spouse_dpoa_successor ?? null,
      hcpAgent: f.spouse_hcp_primary ?? null,
      hcpSuccessor: f.spouse_hcp_successor ?? null,
      guardian: f.guardian_primary ?? null,
    }
  }
  return {
    initialTrustee: f.trustee_initial ?? data.clients.client.fullName,
    successorTrustees: [f.trustee_successor, f.trustee_co_successor, f.trustee_second_successor].filter(Boolean),
    personalRep: [f.pr_primary, f.pr_successor].filter(Boolean).join(', then ') || null,
    poaAgent: [f.dpoa_primary, f.dpoa_successor].filter(Boolean).join(', then ') || null,
    poaSuccessor: f.dpoa_successor ?? null,
    hcpAgent: [f.hcp_primary, f.hcp_successor].filter(Boolean).join(', then ') || null,
    hcpSuccessor: f.hcp_successor ?? null,
    guardian: [f.guardian_primary, f.guardian_successor].filter(Boolean).join(', then ') || null,
  }
}

function planType(structure: PmpsData['planStructure']) {
  return {
    joint_outright: 'Joint Revocable Living Trust — Outright to Surviving Spouse',
    joint_disclaimer: 'Joint Revocable Living Trust with Disclaimer Planning',
    separate_clayton: 'Separate Trusts with Credit Shelter (Clayton Election)',
    individual_single: 'Individual Revocable Living Trust Estate Plan',
  }[structure]
}

/** Map approved Cornerstone facts into the unchanged production-template schema. */
export function toPmpsTemplateData(data: PmpsData) {
  const tax = computeMATax(data.grossEstate, data.planStructure)
  const assets = data.assets.map(asset => ({
    category: asset.description || asset.category,
    value: asset.estimated_value ?? 0,
    display: money(asset.estimated_value ?? 0),
  }))
  const hasRealEstate = data.assets.some(asset => String(asset.category).includes('real'))
  const hasLifeInsurance = data.assets.some(asset => /insurance/i.test(`${asset.category} ${asset.description}`))
  const spouse1 = data.clients.client
  const spouse2 = data.clients.spouse
  const children = data.children.map(child => ({ name: child.full_name, dob: displayDate(child.dob), age: age(child.dob), isMinor: child.minor }))
  const legalPlan = data.hasLegalPlan ? { name: data.legalPlanName || 'Legal plan' } : null

  return {
    matter: { date: data.date, filePrefix: data.filePrefix, outputDir: null },
    clients: {
      type: data.clients.type,
      spouse1: { firstName: spouse1.firstName, lastName: spouse1.lastName, fullName: spouse1.fullName, dob: displayDate(spouse1.dob), age: age(spouse1.dob), citizenship: spouse1.citizenship },
      spouse2: spouse2 ? { firstName: spouse2.firstName, lastName: spouse2.lastName, fullName: spouse2.fullName, dob: displayDate(spouse2.dob), age: age(spouse2.dob), citizenship: spouse2.citizenship } : null,
      address: data.address,
      county: data.county,
      marriedSince: displayDate(data.marriedSince),
    },
    children,
    hasMinorChildren: children.some(child => child.isMinor),
    hasLegalPlan: data.hasLegalPlan,
    legalPlan,
    flatFee: data.flatFee ? money(data.flatFee) : null,
    hasTrust: data.documents.include_trust,
    hasCreditShelter: data.planStructure === 'joint_disclaimer' || data.planStructure === 'separate_clayton',
    hasRealEstate,
    hasLifeInsurance,
    hasAnticipatedInheritance: false,
    hasPets: false,
    assets: { grossEstate: data.grossEstate, grossEstateDisplay: money(data.grossEstate), grossEstateApprox: approximateMoney(data.grossEstate), breakdown: assets },
    tax,
    plan: {
      planStructure: data.planStructure,
      clayton: data.planStructure === 'separate_clayton',
      maQtip: data.planStructure === 'joint_disclaimer' || data.planStructure === 'separate_clayton',
      type: planType(data.planStructure),
      documents: documentList(data),
    },
    fiduciaries: { notes: [], spouse1: fiduciarySet(data, 1), spouse2: spouse2 ? fiduciarySet(data, 2) : null },
    considerations: {
      pets: null, petName: null,
      lifeInsurance: hasLifeInsurance ? 'Review life-insurance ownership and beneficiary designations during the planning session.' : null,
      anticipatedInheritance: null,
      businessInterest: data.assets.some(asset => /business/i.test(`${asset.category} ${asset.description}`)) ? 'Review business-interest valuation, liquidity, and situs.' : null,
      outOfStateProperty: null,
      realEstateTransfer: hasRealEstate && data.documents.include_trust ? 'Review transfer of approved real property to the trust.' : null,
      beneficiaryDesignations: 'Review retirement, insurance, and transfer-on-death beneficiary designations for consistency with the approved plan.',
      youngAdultPlans: null, ilit: false, gifting: false, giftingNote: null,
    },
    flags: [],
  }
}

const BUILDERS: Record<PmpsArtifactKind, { suffix: string; build: TemplateGenerator }> = {
  agenda: { suffix: 'Agenda', build: generateAgenda },
  proposal: { suffix: 'Proposal', build: generateProposal },
  tax_worksheet: { suffix: 'TaxWorksheet', build: generateTaxWorksheet },
  one_page_summary: { suffix: 'OnePager', build: generateOnePageSummary },
}

export async function generatePmpsArtifacts(data: PmpsData, selectedKinds: PmpsArtifactKind[]): Promise<PmpsArtifact[]> {
  const templateData = toPmpsTemplateData(data)
  return Promise.all(selectedKinds.map(async kind => {
    const definition = BUILDERS[kind]
    return {
      kind,
      filename: `${data.filePrefix}_${definition.suffix}.docx`,
      contentType: DOCX,
      bytes: await definition.build(templateData),
    }
  }))
}
