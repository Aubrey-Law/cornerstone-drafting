import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import {
  getDocumentInclusions,
  getTrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import { computeDesignSheetDefaults } from '@/lib/designSheetDefaults'
import { formatPhoneDisplay } from '@/lib/phone'
import { hasYoungAdultEstatePlanChild } from '@/lib/youngAdultEstatePlan'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import type { DesignSheet } from '@/types/database'
import type { DraftPayload } from '@/lib/draftPayload/types'
import type { ContactRow, DesignSheetRow, MatterDetailsRow, MatterRow } from '@/lib/draftPayload/types'
import {
  designSheetString,
  isDesignSheetMarried,
  splitFullName,
} from '@/lib/draftPayload/designSheetFields'
import {
  buildFiduciariesFromDesignSheet,
  deriveDocuments,
  designSheetForDocumentInclusions,
  draftPayloadChildren,
  pick,
} from '@/lib/draftPayload/helpers'
import { getDesignSheetDpoaProvisions } from '@/lib/designSheetDpoaProvisions'
import { getWillPersonalRepresentativePowers } from '@/lib/designSheetWillPowers'
import { draftPayloadFamilyProvisions } from '@/lib/draftPayload/familyProvisions'
import {
  draftPayloadTrustProvisions,
  formatTrustDisplayName,
} from '@/lib/draftPayload/trustProvisions'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { isDesignSheetUnseeded } from '@/lib/designSheet/seedFromIntake'

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildDraftPayload(matterId: string): Promise<DraftPayload> {
  const admin = getAdminClient()
  const resolvedMatterId = await resolveMatterId(matterId, admin)

  // ── Parallel fetches ────────────────────────────────────────────────────────

  const [
    { data: matterRaw, error: matterError },
    { data: detailsRaw },
    { data: designSheetRaw },
  ] = await Promise.all([
    admin
      .from('matters')
      .select('id, client_intake_id, matter_number, status, stage')
      .eq('id', resolvedMatterId)
      .maybeSingle(),

    admin
      .from('matter_details')
      .select(
        'id, client_id, practice_area, ep_trust_type, ep_ancillary_docs, ' +
        'ep_special_provisions, ep_ma_estate_taxable, ep_ma_estate_tax_savings, ' +
        'ep_separate_trusts, ep_has_ilit, ep_ilit_trustee, internal_notes'
      )
      .eq('client_id', resolvedMatterId)
      .maybeSingle(),

    admin
      .from('design_sheets')
      .select('*')
      .eq('matter_id', resolvedMatterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // ── Validate required rows ──────────────────────────────────────────────────

  if (matterError || !matterRaw) {
    throw new Error('Matter not found: ' + matterId)
  }

  const matter = matterRaw as MatterRow
  let rawDesignSheet = designSheetRaw as DesignSheetRow | null

  if (rawDesignSheet && isDesignSheetUnseeded(rawDesignSheet) && matter.client_intake_id) {
    await ensureDesignSheetSeededFromIntake(resolvedMatterId)
    const { data: reloadedSheet } = await admin
      .from('design_sheets')
      .select('*')
      .eq('matter_id', resolvedMatterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    rawDesignSheet = reloadedSheet as DesignSheetRow | null
  }

  if (!rawDesignSheet?.id) {
    throw new Error('No design sheet found for matter: ' + resolvedMatterId)
  }

  // Overlay computed defaults (trust name, citizenship, domicile) onto the saved
  // sheet before any reads. Side-effect-free: computeDesignSheetDefaults only
  // fills blanks, so attorney values win.
  const designSheet: DesignSheetRow = {
    ...rawDesignSheet,
    ...computeDesignSheetDefaults(rawDesignSheet as unknown as DesignSheet, {
      client_name: designSheetString(rawDesignSheet, 'client_name') ?? '',
      spouse_name: designSheetString(rawDesignSheet, 'spouse_name') ?? '',
    }),
  } as DesignSheetRow

  const details = detailsRaw as MatterDetailsRow | null

  // Contacts are fetched only to resolve contact_id references in design-sheet
  // fiduciary slots — not as a generation source.
  let contacts: ContactRow[] = []
  if (matter.client_intake_id) {
    const { data: contactsRaw } = await admin
      .from('contacts')
      .select('id, first_name, middle_name, last_name, preferred_pronoun, relationship_type, relationship_label, address_line1, date_of_birth, phone, email, contact_roles(*)')
      .eq('client_intake_id', matter.client_intake_id)
    contacts = (contactsRaw ?? []) as unknown as ContactRow[]
  }

  const normalizedPlanType = normalizeDesignPlanType(designSheet.plan_type)
  const isJoint = designSheet.is_joint === true
  const isMarried = isDesignSheetMarried(designSheet)

  // ── Derive shared values ────────────────────────────────────────────────────

  const designChildren = draftPayloadChildren(designSheet)
  const hasMinorChildren = designChildren.some(child => child.minor)
  const hasYoungAdultChild = hasYoungAdultEstatePlanChild(designSheet.children)
  const documentInclusions = getDocumentInclusions(designSheetForDocumentInclusions(designSheet))
  const trustPlanningType = getTrustPlanningType({ decisions: designSheet.decisions ?? null })

  let matterType: DraftPayload['matter']['type']
  if (!isMarried) {
    matterType = 'individual'
  } else if (isJoint) {
    matterType = 'married_joint'
  } else {
    matterType = 'married_individual'
  }

  const effectivePracticeArea = details?.practice_area ?? null
  const isEP = effectivePracticeArea != null &&
    (effectivePracticeArea.toUpperCase().includes('EP') ||
     effectivePracticeArea.toLowerCase().includes('estate'))

  const trustType: DraftPayload['matter']['trust_type'] = isEP
    ? ((details?.ep_trust_type as 'revocable_living' | null) ?? 'revocable_living')
    : null

  const rawAncillary = details?.ep_ancillary_docs
  const ancillaryDocs: string[] = Array.isArray(rawAncillary) ? (rawAncillary as string[]) : []

  const usesRevocableTrust = normalizedPlanType
    ? normalizedPlanType === 'pour_over'
    : trustType != null

  // ── Client (design sheet is source of truth) ───────────────────────────────

  const clientFullName = designSheetString(designSheet, 'client_name') ?? ''
  const { first_name: clientFirst, last_name: clientLast } = splitFullName(clientFullName)
  const clientAddress = designSheetString(designSheet, 'street')
  const clientCity = designSheetString(designSheet, 'city')
  const clientCounty = pick(
    designSheetString(designSheet, 'county'),
    designSheetString(designSheet, 'signing_county'),
  )
  const clientState = normalizeJurisdictionStateCode(designSheetString(designSheet, 'state'))
  const clientZip = designSheetString(designSheet, 'zip')

  // ── Spouse (design sheet is source of truth) ───────────────────────────────

  const spouseFullName = designSheetString(designSheet, 'spouse_name')
  const { first_name: spouseFirst, last_name: spouseLast } = splitFullName(spouseFullName)

  const spouse: DraftPayload['spouse'] = isMarried && spouseFullName
    ? {
        first_name: spouseFirst,
        last_name: spouseLast,
        full_name: spouseFullName,
        aka: designSheet.spouse_aka ?? null,
        preferred_pronoun: designSheet.spouse_pronouns ?? null,
        dob: designSheet.spouse_dob ?? null,
      }
    : null

  // ── Trust ──────────────────────────────────────────────────────────────────

  let trustName: string
  if (designSheet.trust_name) {
    trustName = designSheet.trust_name
  } else if (matterType === 'married_joint') {
    trustName = `${clientLast || clientFullName} Family Revocable Living Trust`
  } else {
    trustName = `${clientFullName} Revocable Living Trust`
  }

  function deriveDistributionAges(schedule: string | null | undefined, sheet: DesignSheetRow): number[] {
    const staggered = Array.isArray(sheet.staggered_distributions) ? sheet.staggered_distributions : []
    const staggerAges = staggered
      .map(tier => tier.age)
      .filter((age): age is number => typeof age === 'number' && Number.isFinite(age))
    if (staggerAges.length > 0) return staggerAges

    if (typeof sheet.distribution_age === 'number' && Number.isFinite(sheet.distribution_age)) {
      return [sheet.distribution_age]
    }

    switch (schedule) {
      case 'outright_25': return [25]
      case 'outright_30': return [30]
      case 'outright_35': return [35]
      case 'staggered_25_30_35': return [25, 30, 35]
      default: return [25, 30, 35]
    }
  }

  const trustProvisions = draftPayloadTrustProvisions(designSheet)
  const remoteIndividualIds = Array.isArray(designSheet.remote_beneficiary_individuals)
    ? designSheet.remote_beneficiary_individuals
    : []
  trustProvisions.remote_beneficiary_individual_names = remoteIndividualIds
    .map(id => {
      const contact = contacts.find(entry => entry.id === id)
      if (!contact) return null
      const parts = [contact.first_name, contact.middle_name, contact.last_name].filter(Boolean)
      return parts.join(' ').trim() || null
    })
    .filter((name): name is string => Boolean(name))

  const trustDate = designSheet.trust_date || new Date().toISOString().split('T')[0]
  const spouseTrustName = designSheet.spouse_trust_name ?? null

  const trust: DraftPayload['trust'] = usesRevocableTrust
    ? {
        name: trustName,
        spouse_name: spouseTrustName,
        display_name: formatTrustDisplayName(trustName, trustDate, trustProvisions.client_name_format),
        spouse_display_name: spouseTrustName
          ? formatTrustDisplayName(spouseTrustName, trustDate, trustProvisions.spouse_name_format)
          : null,
        date: trustDate,
        distribution_ages: deriveDistributionAges(designSheet.age_distribution_schedule, designSheet),
        ma_estate_taxable: details?.ep_ma_estate_taxable ?? false,
        ma_estate_tax_savings: details?.ep_ma_estate_tax_savings != null
          ? String(details.ep_ma_estate_tax_savings)
          : null,
        separate_trusts: details?.ep_separate_trusts ?? false,
        has_ilit: details?.ep_has_ilit ?? false,
        ilit_trustee: details?.ep_ilit_trustee ?? null,
      }
    : null

  // ── Fiduciaries (design sheet slots + legacy columns only) ─────────────────

  const fiduciaries = buildFiduciariesFromDesignSheet(
    designSheet,
    contacts,
    {
      full_name: clientFullName,
      address: clientAddress,
    },
    spouse ? {
      full_name: spouse.full_name,
      address: null,
    } : null,
  )

  // ── Documents ─────────────────────────────────────────────────────────────

  const documents = deriveDocuments(
    effectivePracticeArea,
    ancillaryDocs,
    hasMinorChildren,
    hasYoungAdultChild,
    isMarried,
    normalizedPlanType,
    documentInclusions,
    trustPlanningType,
  )

  // ── Will / DPOA / HCP / HIPAA provisions ──────────────────────────────────

  const will_provisions: DraftPayload['will_provisions'] = {
    pr_structure: (designSheet.pr_structure as DraftPayload['will_provisions']['pr_structure']) ?? null,
    trustee_structure: (designSheet.trustee_structure as DraftPayload['will_provisions']['trustee_structure']) ?? null,
    cotrustee_decision_standard: (designSheet.cotrustee_decision_standard as DraftPayload['will_provisions']['cotrustee_decision_standard']) ?? null,
    bond: (designSheet.bond as 'no_bond' | 'required') ?? 'no_bond',
    supervision: (designSheet.supervision as 'unsupervised' | 'supervised') ?? 'unsupervised',
    simultaneous_death: (designSheet.simultaneous_death as DraftPayload['will_provisions']['simultaneous_death']) ?? null,
    utma_age: ((designSheet.utma_age === 18 ? 18 : 21) as 18 | 21),
    no_contest_clause: (designSheet.no_contest_clause as 'omit' | 'include') ?? 'omit',
    include_disclaimer_article: designSheet.include_disclaimer_article ?? true,
    include_self_proving_affidavit: designSheet.include_self_proving_affidavit ?? true,
    tangible_property_distribution: designSheet.tangible_property_distribution ?? null,
    tangible_property_named_individual: designSheet.tangible_property_named_individual ?? null,
    pour_over_alternate_disposition: designSheet.pour_over_alternate_disposition ?? null,
    pour_over_alternate_named: designSheet.pour_over_alternate_named ?? null,
    outright_residuary: designSheet.outright_residuary ?? null,
    outright_residuary_named: designSheet.outright_residuary_named ?? null,
    outright_residuary_alternate: designSheet.outright_residuary_alternate ?? null,
    beneficiary_structure: designSheet.beneficiary_structure ?? null,
    single_beneficiary_name: designSheet.single_beneficiary_name ?? null,
    single_beneficiary_remainder: designSheet.single_beneficiary_remainder ?? null,
    age_distribution_schedule: designSheet.age_distribution_schedule ?? null,
    trust_protector: designSheet.trust_protector ?? false,
    trust_protector_name: designSheet.trust_protector_name ?? null,
    pet_care_option: (designSheet.pet_care_option as 'omit' | 'direct_bequest' | 'pet_trust') ?? 'omit',
    pet_care_details: designSheet.pet_care_details ?? {},
    specific_bequests: designSheet.specific_bequests ?? [],
    pr_powers: getWillPersonalRepresentativePowers(designSheet),
  }

  const sheetDpoaProvisions = getDesignSheetDpoaProvisions(designSheet)

  const dpoa_provisions: DraftPayload['dpoa_provisions'] = {
    coagent_manner: (designSheet.dpoa_coagent_manner as DraftPayload['dpoa_provisions']['coagent_manner']) ?? 'independently',
    self_dealing_reviewer: designSheet.dpoa_self_dealing_reviewer ?? null,
    self_dealing_reviewer_alt: designSheet.dpoa_self_dealing_reviewer_alt ?? null,
    include_section_l: designSheet.dpoa_include_section_l === 'yes',
    agent_compensation: sheetDpoaProvisions.agent_compensation,
    coagent_serving: sheetDpoaProvisions.coagent_serving,
    allow_gifts: sheetDpoaProvisions.allow_gifts,
    trust_powers: {
      agent_may_create_trusts: sheetDpoaProvisions.agent_may_create_trusts,
      agent_may_create_trusts_for_dependents: sheetDpoaProvisions.agent_may_create_trusts_for_dependents,
      allow_agent_as_trustee: sheetDpoaProvisions.allow_agent_as_trustee,
      agent_may_create_medicaid_trusts: sheetDpoaProvisions.agent_may_create_medicaid_trusts,
      agent_may_modify_sole_settlor_trusts: sheetDpoaProvisions.agent_may_modify_sole_settlor_trusts,
      agent_may_modify_joint_trusts: sheetDpoaProvisions.agent_may_modify_joint_trusts,
    },
    special_powers: {
      allow_delegation: sheetDpoaProvisions.allow_delegation,
      prohibit_arbitration: sheetDpoaProvisions.prohibit_arbitration,
      power_529_plans: sheetDpoaProvisions.power_529_plans,
      allow_medical_information_access: sheetDpoaProvisions.allow_medical_information_access,
      power_digital_assets: sheetDpoaProvisions.power_digital_assets,
      allow_self_designation_beneficiary: sheetDpoaProvisions.allow_self_designation_beneficiary,
    },
    basic_powers: sheetDpoaProvisions.basic_powers,
    all_basic_powers: sheetDpoaProvisions.all_basic_powers,
    additional_powers: sheetDpoaProvisions.additional_powers,
    specific_businesses: sheetDpoaProvisions.specific_businesses,
    additional_limitations: sheetDpoaProvisions.additional_limitations,
  }

  const hcp_provisions: DraftPayload['hcp_provisions'] = {
    anatomical_gift: (designSheet.hcp_anatomical_gift as DraftPayload['hcp_provisions']['anatomical_gift']) ?? null,
    anatomical_specified: designSheet.hcp_anatomical_specified ?? null,
  }

  const hipaa_provisions: DraftPayload['hipaa_provisions'] = {
    psychotherapy_notes: (designSheet.hipaa_psychotherapy_notes as DraftPayload['hipaa_provisions']['psychotherapy_notes']) ?? null,
  }

  const execution: DraftPayload['execution'] = {
    signing_month: designSheet.signing_month ?? null,
    signing_year: designSheet.signing_year ?? null,
    signing_county: designSheet.signing_county ?? null,
    notary_commission_expiration: designSheet.notary_commission_expiration ?? null,
  }

  // ── Assemble payload ───────────────────────────────────────────────────────

  return {
    matter: {
      id: matter.id,
      matter_number: matter.matter_number,
      type: matterType,
      trust_type: trustType,
      practice_area: effectivePracticeArea,
      minor_children: hasMinorChildren,
    },
    client: {
      first_name: clientFirst,
      last_name: clientLast,
      full_name: clientFullName,
      aka: designSheet.client_aka ?? null,
      preferred_pronoun: designSheet.client_pronouns ?? null,
      dob: designSheet.client_dob ?? null,
      address: clientAddress,
      city: clientCity,
      county: clientCounty,
      state: clientState,
      zip: clientZip,
      email: designSheet.client_email ?? null,
      phone: formatPhoneDisplay(designSheet.client_phone) || null,
      excluded_guardian: designSheet.excluded_guardian_flag
        ? (designSheet.excluded_guardian_name ?? null)
        : null,
    },
    spouse,
    children: designChildren,
    family_provisions: draftPayloadFamilyProvisions(designSheet),
    trust,
    trust_provisions: trustProvisions,
    fiduciaries,
    documents,
    will_provisions,
    dpoa_provisions,
    hcp_provisions,
    hipaa_provisions,
    execution,
    design_sheet_id: designSheet.id,
    special_provisions: details?.ep_special_provisions ?? null,
    ancillary_docs: ancillaryDocs,
    notes: details?.internal_notes ?? null,
  }
}
