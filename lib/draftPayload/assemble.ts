import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import {
  getDocumentInclusions,
  getTrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import { computeDesignSheetDefaults } from '@/lib/designSheetDefaults'
import { formatPhoneDisplay } from '@/lib/phone'
import { hasYoungAdultEstatePlanChild } from '@/lib/youngAdultEstatePlan'
import type { DesignSheet } from '@/types/database'
import type { DraftPayload } from '@/lib/draftPayload/types'
import type { ClientIntakeRow, ContactRow, DesignSheetRow, MatterDetailsRow, MatterRow } from '@/lib/draftPayload/types'
import {
  buildFiduciarySlots,
  decisionString,
  deriveDocuments,
  designSheetForDocumentInclusions,
  draftPayloadChildren,
  fullName,
  overlayDesignSheetFiduciarySlots,
  pick,
} from '@/lib/draftPayload/helpers'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'

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
  // Overlay computed defaults (trust name, citizenship, domicile) onto the saved
  // sheet before any reads. The drafting workspace persists these on load, but
  // generation can be triggered without that page (e.g. a direct API call), and
  // applying them here also makes the trust name consistent with the seeded
  // default instead of the divergent fallback further down. Side-effect-free:
  // computeDesignSheetDefaults only fills blanks, so attorney values win.
  const rawDesignSheet = designSheetRaw as DesignSheetRow | null
  const designSheet: DesignSheetRow | null = rawDesignSheet
    ? ({
        ...rawDesignSheet,
        ...computeDesignSheetDefaults(rawDesignSheet as unknown as DesignSheet, {
          client_name: '',
          spouse_name: '',
        }),
      } as DesignSheetRow)
    : null
  const details = detailsRaw as MatterDetailsRow | null

  if (!matter.client_intake_id) {
    throw new Error('No intake found for matter: ' + resolvedMatterId)
  }

  const [{ data: intakeRaw }, { data: contactsRaw }] = await Promise.all([
    admin
      .from('client_intake')
      .select(
        'id, first_name, middle_name, last_name, full_name, date_of_birth, ' +
        'preferred_pronoun, ' +
        'phone, email, address_line1, city, county, state, zip, marital_status, has_minor_children, ' +
        'practice_area'
      )
      .eq('id', matter.client_intake_id)
      .maybeSingle(),
    admin
      .from('contacts')
      .select('id, first_name, middle_name, last_name, preferred_pronoun, relationship_type, relationship_label, address_line1, date_of_birth, phone, email, contact_roles(*)')
      .eq('client_intake_id', matter.client_intake_id),
  ])

  if (!intakeRaw) {
    throw new Error('No intake found for matter: ' + resolvedMatterId)
  }

  const intake = intakeRaw as unknown as ClientIntakeRow
  const contacts = (contactsRaw ?? []) as unknown as ContactRow[]

  const normalizedPlanType = normalizeDesignPlanType(designSheet?.plan_type)
  const isJoint = designSheet?.is_joint === true

  // ── Derive shared values ────────────────────────────────────────────────────

  const isMarried = intake.marital_status?.toLowerCase() === 'married'
  const designChildren = draftPayloadChildren(designSheet)
  const hasMinorChildren = designChildren.some(child => child.minor) || (intake.has_minor_children ?? false)
  const hasYoungAdultChild = hasYoungAdultEstatePlanChild(designSheet?.children)
  const documentInclusions = getDocumentInclusions(designSheetForDocumentInclusions(designSheet, intake.marital_status))
  const trustPlanningType = getTrustPlanningType({ decisions: designSheet?.decisions ?? null })

  // matter.type — joint vs individual is now driven by design_sheets.is_joint, not plan_type
  let matterType: DraftPayload['matter']['type']
  if (!isMarried) {
    matterType = 'individual'
  } else if (isJoint) {
    matterType = 'married_joint'
  } else {
    matterType = 'married_individual'
  }

  // trust_type
  const effectivePracticeArea = pick(details?.practice_area, intake.practice_area)
  const isEP = effectivePracticeArea != null &&
    (effectivePracticeArea.toUpperCase().includes('EP') ||
     effectivePracticeArea.toLowerCase().includes('estate'))

  const trustType: DraftPayload['matter']['trust_type'] = isEP
    ? ((details?.ep_trust_type as 'revocable_living' | null) ?? 'revocable_living')
    : null

  // ancillary docs
  const rawAncillary = details?.ep_ancillary_docs
  const ancillaryDocs: string[] = Array.isArray(rawAncillary) ? (rawAncillary as string[]) : []

  // Whether the plan uses revocable trust metadata. This is broader than
  // generating the trust document because a pour-over will still needs the
  // trust name/date when the trust draft itself is unchecked.
  const usesRevocableTrust = normalizedPlanType
    ? normalizedPlanType === 'pour_over'
    : trustType != null

  // ── Client ─────────────────────────────────────────────────────────────────

  const clientFirst = intake.first_name ?? ''
  const clientLast = intake.last_name ?? ''
  const clientFullName = pick(intake.full_name, fullName(clientFirst, clientLast)) ?? ''
  // Manual design-sheet edits persist these address fields into `decisions`
  // (only the intake sync worker writes the real columns), so fall back to
  // decisions — as `county` already does — when the column is empty.
  const clientAddress = pick(designSheet?.street, decisionString(designSheet, 'street'), intake.address_line1)
  const clientCity = pick(designSheet?.city, decisionString(designSheet, 'city'), intake.city)
  const clientCounty = pick(
    designSheet?.county,
    decisionString(designSheet, 'county'),
    intake.county,
    designSheet?.signing_county,
  )
  const clientState = pick(designSheet?.state, decisionString(designSheet, 'state'), intake.state)
  const clientZip = pick(designSheet?.zip, decisionString(designSheet, 'zip'), intake.zip)

  // ── Spouse ─────────────────────────────────────────────────────────────────

  const spouseContact = contacts.find(c => c.relationship_type === 'spouse') ?? null
  const spouseFirst = spouseContact?.first_name ?? ''
  const spouseLast = spouseContact?.last_name ?? ''
  const spouseFullName = pick(
    [spouseFirst, spouseContact?.middle_name, spouseLast].filter(Boolean).join(' ') || null,
    fullName(spouseFirst, spouseLast),
  )

  const spouse: DraftPayload['spouse'] = isMarried && spouseFullName
    ? {
        first_name: spouseFirst,
        last_name: spouseLast,
        full_name: spouseFullName,
        aka: designSheet?.spouse_aka ?? null,
        preferred_pronoun: spouseContact?.preferred_pronoun ?? null,
        dob: spouseContact?.date_of_birth ?? null,
      }
    : null

  // ── Trust ──────────────────────────────────────────────────────────────────

  let trustName: string
  if (designSheet?.trust_name) {
    trustName = designSheet.trust_name
  } else if (matterType === 'married_joint') {
    trustName = `${clientLast} Family Revocable Living Trust`
  } else {
    trustName = `${clientFullName} Revocable Living Trust`
  }

  // Distribution ages from age_distribution_schedule (Testamentary Trust §5.5)
  function deriveDistributionAges(schedule: string | null | undefined): number[] {
    switch (schedule) {
      case 'outright_25': return [25]
      case 'outright_30': return [30]
      case 'outright_35': return [35]
      case 'staggered_25_30_35': return [25, 30, 35]
      default: return [25, 30, 35]
    }
  }

  const trust: DraftPayload['trust'] = usesRevocableTrust
    ? {
        name: trustName,
        date: designSheet?.trust_date || new Date().toISOString().split('T')[0],
        distribution_ages: deriveDistributionAges(designSheet?.age_distribution_schedule),
        ma_estate_taxable: details?.ep_ma_estate_taxable ?? false,
        ma_estate_tax_savings: details?.ep_ma_estate_tax_savings != null
          ? String(details.ep_ma_estate_tax_savings)
          : null,
        separate_trusts: details?.ep_separate_trusts ?? false,
        has_ilit: details?.ep_has_ilit ?? false,
        ilit_trustee: details?.ep_ilit_trustee ?? null,
      }
    : null

  // ── Fiduciaries ────────────────────────────────────────────────────────────

  const fiduciaries = overlayDesignSheetFiduciarySlots(
    buildFiduciarySlots(contacts),
    contacts,
    designSheet,
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
    pr_structure: (designSheet?.pr_structure as DraftPayload['will_provisions']['pr_structure']) ?? null,
    trustee_structure: (designSheet?.trustee_structure as DraftPayload['will_provisions']['trustee_structure']) ?? null,
    cotrustee_decision_standard: (designSheet?.cotrustee_decision_standard as DraftPayload['will_provisions']['cotrustee_decision_standard']) ?? null,
    bond: (designSheet?.bond as 'no_bond' | 'required') ?? 'no_bond',
    supervision: (designSheet?.supervision as 'unsupervised' | 'supervised') ?? 'unsupervised',
    simultaneous_death: (designSheet?.simultaneous_death as DraftPayload['will_provisions']['simultaneous_death']) ?? null,
    utma_age: ((designSheet?.utma_age === 18 ? 18 : 21) as 18 | 21),
    no_contest_clause: (designSheet?.no_contest_clause as 'omit' | 'include') ?? 'omit',
    include_disclaimer_article: designSheet?.include_disclaimer_article ?? true,
    include_self_proving_affidavit: designSheet?.include_self_proving_affidavit ?? true,
    tangible_property_distribution: designSheet?.tangible_property_distribution ?? null,
    tangible_property_named_individual: designSheet?.tangible_property_named_individual ?? null,
    pour_over_alternate_disposition: designSheet?.pour_over_alternate_disposition ?? null,
    pour_over_alternate_named: designSheet?.pour_over_alternate_named ?? null,
    outright_residuary: designSheet?.outright_residuary ?? null,
    outright_residuary_named: designSheet?.outright_residuary_named ?? null,
    outright_residuary_alternate: designSheet?.outright_residuary_alternate ?? null,
    beneficiary_structure: designSheet?.beneficiary_structure ?? null,
    single_beneficiary_name: designSheet?.single_beneficiary_name ?? null,
    single_beneficiary_remainder: designSheet?.single_beneficiary_remainder ?? null,
    age_distribution_schedule: designSheet?.age_distribution_schedule ?? null,
    trust_protector: designSheet?.trust_protector ?? false,
    trust_protector_name: designSheet?.trust_protector_name ?? null,
    pet_care_option: (designSheet?.pet_care_option as 'omit' | 'direct_bequest' | 'pet_trust') ?? 'omit',
    pet_care_details: designSheet?.pet_care_details ?? {},
    specific_bequests: designSheet?.specific_bequests ?? [],
  }

  const dpoa_provisions: DraftPayload['dpoa_provisions'] = {
    coagent_manner: (designSheet?.dpoa_coagent_manner as DraftPayload['dpoa_provisions']['coagent_manner']) ?? 'independently',
    self_dealing_reviewer: designSheet?.dpoa_self_dealing_reviewer ?? null,
    self_dealing_reviewer_alt: designSheet?.dpoa_self_dealing_reviewer_alt ?? null,
    include_section_l: designSheet?.dpoa_include_section_l === 'yes',
  }

  const hcp_provisions: DraftPayload['hcp_provisions'] = {
    anatomical_gift: (designSheet?.hcp_anatomical_gift as DraftPayload['hcp_provisions']['anatomical_gift']) ?? null,
    anatomical_specified: designSheet?.hcp_anatomical_specified ?? null,
  }

  const hipaa_provisions: DraftPayload['hipaa_provisions'] = {
    psychotherapy_notes: (designSheet?.hipaa_psychotherapy_notes as DraftPayload['hipaa_provisions']['psychotherapy_notes']) ?? null,
  }

  const execution: DraftPayload['execution'] = {
    signing_month: designSheet?.signing_month ?? null,
    signing_year: designSheet?.signing_year ?? null,
    signing_county: designSheet?.signing_county ?? null,
    notary_commission_expiration: designSheet?.notary_commission_expiration ?? null,
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
      aka: designSheet?.client_aka ?? null,
      preferred_pronoun: intake.preferred_pronoun ?? null,
      dob: intake.date_of_birth ?? null,
      address: clientAddress,
      city: clientCity,
      county: clientCounty,
      state: clientState,
      zip: clientZip,
      email: intake.email ?? null,
      phone: formatPhoneDisplay(intake.phone) || null,
      excluded_guardian: designSheet?.excluded_guardian_flag
        ? (designSheet.excluded_guardian_name ?? null)
        : null,
    },
    spouse,
    children: draftPayloadChildren(designSheet),
    trust,
    fiduciaries,
    documents,
    will_provisions,
    dpoa_provisions,
    hcp_provisions,
    hipaa_provisions,
    execution,
    design_sheet_id: designSheet?.id ?? null,
    special_provisions: details?.ep_special_provisions ?? null,
    ancillary_docs: ancillaryDocs,
    notes: details?.internal_notes ?? null,
  }
}