import type { DraftPayload } from '@/lib/draftPayload/types'
import { PMPS_ARTIFACT_KINDS, type PmpsAssemblyResult, type PmpsPlanStructure, type PmpsRunInput } from '@/lib/pmps/types'

function cleanFilenamePart(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9-]/g, '') || 'Client'
}

function validStructure(value: unknown): value is PmpsPlanStructure {
  return ['joint_outright', 'joint_disclaimer', 'separate_clayton', 'individual_single'].includes(String(value))
}

export function assemblePmpsData(payload: DraftPayload, input: PmpsRunInput = {}, details?: { legalPlan?: string | null; flatFee?: number | null }): PmpsAssemblyResult {
  const preflight: PmpsAssemblyResult['preflight'] = []
  const isCouple = Boolean(payload.spouse)
  const hasLegalPlan = typeof input.hasLegalPlan === 'boolean'
    ? input.hasLegalPlan
    : details?.legalPlan ? true : undefined
  const flatFee = typeof input.flatFee === 'number' && Number.isFinite(input.flatFee)
    ? input.flatFee
    : details?.flatFee ?? null
  const planStructure = validStructure(input.planStructure) ? input.planStructure : undefined
  const assets = payload.assets ?? []
  const grossEstate = assets.reduce((sum, asset) => sum + (asset.estimated_value ?? 0), 0)

  if (!payload.client.full_name?.trim() || !payload.client.dob) preflight.push({ field: 'client', message: '[UNKNOWN] Confirm the client name and date of birth.' })
  if (isCouple && (!payload.spouse?.full_name?.trim() || !payload.spouse.dob)) preflight.push({ field: 'spouse', message: '[UNKNOWN] Confirm the spouse name and date of birth.' })
  if (hasLegalPlan === undefined) preflight.push({ field: 'hasLegalPlan', message: '[UNKNOWN] Confirm whether a legal insurance plan applies.' })
  if (hasLegalPlan === false && (!flatFee || flatFee <= 0)) preflight.push({ field: 'flatFee', message: '[UNKNOWN] Provide the approved flat fee for a client without legal-plan coverage.' })
  if (!planStructure) preflight.push({ field: 'planStructure', message: '[UNKNOWN] Select the approved PMPS plan structure.' })
  if (planStructure === 'individual_single' && isCouple) preflight.push({ field: 'planStructure', message: 'The selected individual plan conflicts with the spouse recorded on the matter.' })
  if (planStructure && planStructure !== 'individual_single' && !isCouple) preflight.push({ field: 'planStructure', message: 'The selected couple plan conflicts with an individual matter.' })
  if (!assets.length || assets.some(asset => asset.estimated_value === null)) preflight.push({ field: 'assets', message: '[UNKNOWN] Complete values for every asset used in the PMPS estate total.' })
  if (grossEstate <= 0) preflight.push({ field: 'assets', message: '[UNKNOWN] A positive approved gross-estate value is required.' })
  if (!payload.fiduciaries.pr_primary || !payload.fiduciaries.dpoa_primary || !payload.fiduciaries.hcp_primary) {
    preflight.push({ field: 'fiduciaries', message: '[UNKNOWN] Confirm primary personal representative, DPOA agent, and health-care agent.' })
  }

  const selectedKinds = input.documentKinds?.length
    ? PMPS_ARTIFACT_KINDS.filter(kind => input.documentKinds?.includes(kind))
    : [...PMPS_ARTIFACT_KINDS]
  if (!selectedKinds.length) preflight.push({ field: 'documentKinds', message: 'Select at least one PMPS document.' })
  if (preflight.length || hasLegalPlan === undefined || !planStructure) return { data: null, preflight, selectedKinds }

  const lastNames = [payload.client.last_name, payload.spouse?.last_name].filter(Boolean) as string[]
  const filePrefix = [...new Set(lastNames.map(cleanFilenamePart))].join('-') || 'Client'
  return {
    preflight,
    selectedKinds,
    data: {
      matterId: payload.matter.id,
      matterNumber: payload.matter.matter_number,
      date: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' }).format(new Date()),
      filePrefix,
      clients: {
        type: isCouple ? 'couple' : 'individual',
        client: { fullName: payload.client.full_name, firstName: payload.client.first_name, lastName: payload.client.last_name, dob: payload.client.dob },
        spouse: payload.spouse ? { fullName: payload.spouse.full_name, firstName: payload.spouse.first_name, lastName: payload.spouse.last_name, dob: payload.spouse.dob } : null,
      },
      children: payload.children,
      assets,
      grossEstate,
      fiduciaries: payload.fiduciaries,
      documents: payload.documents,
      hasLegalPlan,
      legalPlanName: input.legalPlanName?.trim() || details?.legalPlan || null,
      flatFee,
      planStructure,
    },
  }
}
