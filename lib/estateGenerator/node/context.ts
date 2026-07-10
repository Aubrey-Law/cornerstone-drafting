import { loadNodeEstateStateRules } from '@/lib/estateGenerator/node/config'
import type { NodeEstateContext, NodeEstateData } from '@/lib/estateGenerator/node/types'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { getPath, isPresent } from '@/lib/estateGenerator/node/validation'

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
    typeof item === 'object' && item !== null && !Array.isArray(item)
  )) : []
}

const DEFAULT_POUR_OVER_ALTERNATE_DISPOSITION_TEXT = 'If incorporation by reference fails for any reason, I direct my Personal Representative to distribute the remainder of my estate, excluding any property over which I have a power of appointment, to my spouse if my spouse survives me. If my spouse does not survive me I direct my Personal Representative to distribute the property to my descendants, per stirpes.'
const BLANK_DOC_DATE = '________________, 20__'
const BLANK_ORDINAL_DOC_DATE = '_____ day of _________________, 20___'
const BLANK_SIGNING_COUNTY = '__________________________'
// The notary supplies their commission expiration via their own seal/stamp at
// signing, so when no value is provided we render nothing after the
// "My Commission Expires:" label rather than an empty fill line.
const BLANK_NOTARY_COMMISSION = ''

export interface BuildNodeEstateContextArgs {
  data: NodeEstateData
  state: string
  root?: string
}

export function buildNodeEstateContext({ data, state, root }: BuildNodeEstateContextArgs): NodeEstateContext {
  const stateCode = normalizeJurisdictionStateCode(state)
  const stateRules = loadNodeEstateStateRules(stateCode, root)
  const client = { ...recordValue(data.client) }
  client.state ??= stateCode

  const spouse = recordValue(data.spouse)
  const hasSpouse = Boolean(spouse.exists) || isPresent(spouse.full_name)
  const childRecords = arrayValue(data.children)
  const children = childRecords.filter(child => isPresent(child.full_name))
  const gifts = arrayValue(data.specific_gifts)
  const charitable = arrayValue(data.charitable_gifts)
  const planning = recordValue(data.planning)
  const will = { ...recordValue(data.will) }
  will.pr_structure ??= 'single'
  will.bond ??= 'no_bond'
  will.supervision ??= 'unsupervised'
  will.simultaneous_death ??= 'omit'
  will.utma_age ??= 21
  will.no_contest_clause ??= 'omit'
  will.include_disclaimer_article ??= true
  will.include_self_proving_affidavit ??= true
  const tangiblePersonalProperty = { ...recordValue(will.tangible_personal_property) }
  tangiblePersonalProperty.distribution_method ??= 'children_then_descendants'
  tangiblePersonalProperty.named_individual = recordValue(tangiblePersonalProperty.named_individual)
  will.tangible_personal_property = tangiblePersonalProperty
  const petCare = { ...recordValue(will.pet_care) }
  petCare.option ??= 'omit'
  petCare.primary_caretaker = recordValue(petCare.primary_caretaker)
  petCare.successor_caretaker = recordValue(petCare.successor_caretaker)
  petCare.pet_trustee = recordValue(petCare.pet_trustee)
  petCare.remainder_beneficiary = recordValue(petCare.remainder_beneficiary)
  petCare.enforcer = recordValue(petCare.enforcer)
  will.pet_care = petCare
  const family = recordValue(data.family)
  const familyRecord = {
    ...family,
    include_child_gender_markers: Boolean(family.include_child_gender_markers),
    include_afterborn_children: family.include_afterborn_children !== false,
    include_expectant_children: family.include_expectant_children !== false,
    omissions_intentional: Boolean(family.omissions_intentional),
    include_general_disinheritance: family.include_general_disinheritance !== false,
    disinherit_issue: Boolean(family.disinherit_issue),
    additional_disinheritance_language: typeof family.additional_disinheritance_language === 'string'
      ? family.additional_disinheritance_language
      : '',
  }
  const assets = recordValue(data.assets)
  const tax = recordValue(data.tax)
  const guardians = recordValue(data.guardians)
  const fiduciaries = recordValue(data.fiduciaries)
  const agent = recordValue(fiduciaries.agent)
  const trust = { ...recordValue(data.trust) }
  trust.display_date = trust.date || '________________, 20___'
  const disinherited = arrayValue(trust.disinherited)
  const pourOver = { ...recordValue(data.pour_over) }
  pourOver.alternate_disposition ??= 'spouse_then_descendants'
  pourOver.alternate_disposition_text ??= DEFAULT_POUR_OVER_ALTERNATE_DISPOSITION_TEXT
  pourOver.alternate_named ??= { full_name: '' }
  const outrightWill = { ...recordValue(data.outright_will) }
  const outrightResiduary = { ...recordValue(outrightWill.residuary) }
  outrightResiduary.disposition ??= hasSpouse ? 'spouse_then_descendants' : 'descendants_then_heirs'
  outrightResiduary.named = recordValue(outrightResiduary.named)
  outrightResiduary.alternate = recordValue(outrightResiduary.alternate)
  outrightWill.residuary = outrightResiduary
  const dpoa = { ...recordValue(data.dpoa) }
  dpoa.include_section_l = Boolean(dpoa.include_section_l)
  dpoa.include_entity_powers = Boolean(dpoa.include_entity_powers)
  dpoa.include_advanced_trust_gifting = Boolean(dpoa.include_advanced_trust_gifting)
  dpoa.include_extended_personal_care = Boolean(dpoa.include_extended_personal_care)
  dpoa.self_dealing_reviewer = recordValue(dpoa.self_dealing_reviewer)
  dpoa.self_dealing_reviewer_alt = recordValue(dpoa.self_dealing_reviewer_alt)
  const healthcare = { ...recordValue(data.healthcare) }
  healthcare.anatomical_gift ??= null
  healthcare.anatomical_specified ??= ''
  const hipaa = { ...recordValue(data.hipaa) }
  hipaa.psychotherapy_notes ??= null

  const execution = { ...recordValue(data.execution) }
  const signingScheduled = Boolean(execution.signing_scheduled)
  const executionSigningCounty = execution.signing_county ?? client.signing_county
  execution.display_doc_date = signingScheduled && isPresent(execution.doc_date)
    ? execution.doc_date
    : BLANK_DOC_DATE
  execution.display_ordinal_doc_date = signingScheduled
    && isPresent(execution.ordinal_doc_date)
    ? execution.ordinal_doc_date
    : BLANK_ORDINAL_DOC_DATE
  execution.display_signing_county = signingScheduled && isPresent(executionSigningCounty)
    ? executionSigningCounty
    : BLANK_SIGNING_COUNTY
  execution.display_notary_commission = signingScheduled && isPresent(execution.notary_commission)
    ? execution.notary_commission
    : BLANK_NOTARY_COMMISSION

  const hasMinorChildren = childRecords.some(child => Boolean(child.minor)) || Boolean(planning.has_minor_children)
  const minorChildren = children.filter(child => Boolean(child.minor))
  const hasCoPoa = isPresent(getPath(data, 'fiduciaries.agent.co_primary.full_name'))
  const poaAction = typeof agent.co_agents_action === 'string' ? agent.co_agents_action : 'separate'
  const hasDpoaSelfDealingReviewer = isPresent(getPath(dpoa, 'self_dealing_reviewer.full_name'))
  const hasDpoaSelfDealingReviewerAlt = isPresent(getPath(dpoa, 'self_dealing_reviewer_alt.full_name'))
  const anatomicalGift = typeof healthcare.anatomical_gift === 'string' ? healthcare.anatomical_gift : null
  const clientAnatomicalGift = typeof healthcare.client_anatomical_gift === 'string'
    ? healthcare.client_anatomical_gift
    : null
  const hasAnatomicalSpecified = anatomicalGift === 'specified' && isPresent(healthcare.anatomical_specified)
  const hipaaPsychotherapyNotes = typeof hipaa.psychotherapy_notes === 'string' ? hipaa.psychotherapy_notes : null
  const clientAdvanceDirective = typeof healthcare.client_advance_directive === 'string'
    ? healthcare.client_advance_directive
    : null
  const spouseAdvanceDirective = typeof healthcare.spouse_advance_directive === 'string'
    ? healthcare.spouse_advance_directive
    : null
  const assetItems = arrayValue(assets.items)
  const ownsRealProperty = Boolean(assets.real_property) || assetItems.some(item => item.category === 'real_property')
  const simultaneousDeath = typeof will.simultaneous_death === 'string' ? will.simultaneous_death : 'omit'
  const petCareOption = typeof petCare.option === 'string' ? petCare.option : 'omit'

  return {
    ...data,
    client,
    children,
    minor_children: minorChildren,
    will,
    trust,
    pour_over: pourOver,
    outright_will: outrightWill,
    dpoa,
    healthcare,
    hipaa,
    execution,
    state: { code: stateCode, ...stateRules },
    has_spouse: hasSpouse,
    has_children: children.length > 0,
    has_minor_children: hasMinorChildren,
    has_blended_family: Boolean(family.blended_family),
    has_co_poa: hasCoPoa,
    has_solo_poa: !hasCoPoa,
    co_poa_joint: hasCoPoa && poaAction === 'joint',
    co_poa_majority: hasCoPoa && poaAction === 'majority',
    co_poa_separate: hasCoPoa && poaAction !== 'joint' && poaAction !== 'majority',
    aif_has_spouse: Boolean(agent.primary_has_spouse),
    has_dpoa_self_dealing_reviewer: hasDpoaSelfDealingReviewer,
    has_dpoa_self_dealing_reviewer_alt: hasDpoaSelfDealingReviewerAlt,
    hcp_anatomical_all: anatomicalGift === 'all' || clientAnatomicalGift === 'yes',
    hcp_anatomical_specified: hasAnatomicalSpecified,
    hcp_anatomical_none: anatomicalGift === 'none' || clientAnatomicalGift === 'no',
    hcp_anatomical_defer: clientAnatomicalGift === 'defer',
    hcp_client_advance_prolong_life: clientAdvanceDirective === 'prolong_life',
    hcp_client_advance_dnr: clientAdvanceDirective === 'do_not_resuscitate',
    hcp_client_advance_do_not_prolong: clientAdvanceDirective === 'do_not_prolong_life',
    hcp_spouse_advance_prolong_life: spouseAdvanceDirective === 'prolong_life',
    hcp_spouse_advance_dnr: spouseAdvanceDirective === 'do_not_resuscitate',
    hcp_spouse_advance_do_not_prolong: spouseAdvanceDirective === 'do_not_prolong_life',
    hipaa_psychotherapy_authorized: hipaaPsychotherapyNotes === 'authorize',
    hipaa_include_poa: Boolean(hipaa.include_poa),
    hipaa_include_trustees: Boolean(hipaa.include_trustees),
    hipaa_list_fiduciaries_by_name: hipaa.list_fiduciaries_by_name === 'by_name',
    hipaa_list_fiduciaries_general: hipaa.list_fiduciaries_by_name === 'general_language',
    uses_revocable_trust: Boolean(planning.uses_revocable_trust),
    requires_guardian_clause: hasMinorChildren,
    has_specific_gifts: gifts.length > 0,
    has_charitable_gifts: charitable.length > 0,
    has_tangible_personal_property: isPresent(tangiblePersonalProperty.distribution_method),
    has_pet_care: petCareOption === 'direct_bequest' || petCareOption === 'pet_trust',
    has_simultaneous_death: hasSpouse && (simultaneousDeath === 'spouse_survives' || simultaneousDeath === 'testator_survives'),
    has_excluded_guardians: arrayValue(guardians.excluded).length > 0,
    has_disinherited: disinherited.length > 0,
    include_child_gender_markers: familyRecord.include_child_gender_markers,
    include_afterborn_children: familyRecord.include_afterborn_children,
    include_expectant_children: familyRecord.include_expectant_children,
    omissions_intentional: familyRecord.omissions_intentional,
    include_general_disinheritance: familyRecord.include_general_disinheritance,
    disinherit_issue: familyRecord.disinherit_issue,
    family: familyRecord,
    owns_real_property: ownsRealProperty,
    has_assets: assetItems.length > 0,
    tax_sensitive_estate: Boolean(tax.sensitive_estate),
    state_requires_self_proving_affidavit: Boolean(stateRules.requires_self_proving_affidavit),
    signing_scheduled: signingScheduled,
  }
}
