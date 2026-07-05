import { notFound } from 'next/navigation'
import {
  fetchMatter,
  fetchDesignSheet,
  fetchMatterContacts,
  fetchIntakeForMatter,
} from '@/lib/queries'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { buildDesignSheetPersistencePayload } from '@/lib/designSheetPersistence'
import { computeDesignSheetDefaults } from '@/lib/designSheetDefaults'
import { formatPhoneDisplay } from '@/lib/phone'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

export interface DraftingMatterContext {
  matterId: string
  matter: PipelineMatter
  contacts: MatterContact[]
  sheet: DesignSheet | null
  lpData: {
    li_plan_coverage: string
    li_design_sheet_data: Record<string, unknown>
    li_design_sheet_approved: boolean
  } | null
  intakeSnapshot: IntakeSnapshot | null
}

export async function loadDraftingMatterContext(matterId: string): Promise<DraftingMatterContext> {
  const [matter, sheet, contacts, intakeSnapshot] = await Promise.all([
    fetchMatter(matterId),
    fetchDesignSheet(matterId),
    fetchMatterContacts(matterId),
    fetchIntakeForMatter(matterId),
  ])

  if (!matter) notFound()

  const admin = getAdminClient()
  const [{ data: matterRow }, { data: detailsRow }, { data: pipelineRow }] = await Promise.all([
    admin
      .from('matters')
      .select('li_plan_coverage, li_design_sheet_data, li_design_sheet_approved')
      .eq('id', matterId)
      .maybeSingle(),
    admin
      .from('matter_details')
      .select('practice_area')
      .eq('client_id', matterId)
      .maybeSingle(),
    admin
      .from('v_matter_pipeline')
      .select('practice_area')
      .eq('matter_id', matterId)
      .maybeSingle(),
  ])

  const practiceArea = detailsRow?.practice_area ?? pipelineRow?.practice_area ?? null
  const normalizedPracticeArea = normalizePracticeArea(practiceArea)
  if (normalizedPracticeArea === 'Probate') {
    notFound()
  }

  const matterWithPracticeArea = { ...matter, practice_area: practiceArea }
  const isLP = normalizedPracticeArea === 'EP-LP'
  const lpData = isLP
    ? {
        li_plan_coverage: (matterRow?.li_plan_coverage as string) ?? '',
        li_design_sheet_data: (matterRow?.li_design_sheet_data as Record<string, unknown>) ?? {},
        li_design_sheet_approved: (matterRow?.li_design_sheet_approved as boolean) ?? false,
      }
    : null

  let effectiveSheet = sheet
  if (sheet && !sheet.client_name && intakeSnapshot?.first_name) {
    const children = intakeSnapshot.children?.map(c => ({
      name: c.name,
      dob: c.date_of_birth,
      relationship: c.relationship as 'biological' | 'adopted' | 'stepchild',
      is_minor: false,
    })) ?? null

    const seedPayload = buildDesignSheetPersistencePayload({
      client_name: [intakeSnapshot.first_name, intakeSnapshot.middle_name, intakeSnapshot.last_name].filter(Boolean).join(' ') || null,
      client_dob: intakeSnapshot.date_of_birth,
      client_phone: formatPhoneDisplay(intakeSnapshot.phone),
      client_email: intakeSnapshot.email,
      marital_status: intakeSnapshot.marital_status,
      street: intakeSnapshot.address_line1,
      city: intakeSnapshot.city,
      state: intakeSnapshot.state,
      zip: intakeSnapshot.zip,
      county: intakeSnapshot.county,
      spouse_name: [intakeSnapshot.spouse_first_name, intakeSnapshot.spouse_middle_name, intakeSnapshot.spouse_last_name].filter(Boolean).join(' ') || null,
      spouse_dob: intakeSnapshot.spouse_date_of_birth,
      spouse_phone: formatPhoneDisplay(intakeSnapshot.spouse_phone),
      spouse_email: intakeSnapshot.spouse_email,
      marriage_date: intakeSnapshot.date_of_marriage,
      children: children?.length ? children : null,
      trustee_primary: intakeSnapshot.trustee_primary,
      trustee_alt1: intakeSnapshot.trustee_alternate,
      executor_primary: intakeSnapshot.executor_primary,
      executor_alt1: intakeSnapshot.executor_alternate,
      poa_primary: intakeSnapshot.poa_primary,
      poa_alt1: intakeSnapshot.poa_alternate,
      hcp_primary: intakeSnapshot.hcp_primary,
      hcp_alt1: intakeSnapshot.hcp_alternate,
      guardian_primary: intakeSnapshot.guardian_primary,
      guardian_alt1: intakeSnapshot.guardian_alternate,
    })

    await admin.from('design_sheets').update({
      ...seedPayload,
      updated_at: new Date().toISOString(),
    }).eq('id', sheet.id)

    effectiveSheet = await fetchDesignSheet(matterId)
  }

  if (effectiveSheet?.id && effectiveSheet.client_name) {
    const defaultsPatch = computeDesignSheetDefaults(effectiveSheet, matterWithPracticeArea)
    if (Object.keys(defaultsPatch).length > 0) {
      await admin.from('design_sheets').update({
        ...buildDesignSheetPersistencePayload({ ...effectiveSheet, ...defaultsPatch }),
        updated_at: new Date().toISOString(),
      }).eq('id', effectiveSheet.id)

      effectiveSheet = await fetchDesignSheet(matterId)
    }
  }

  return {
    matterId,
    matter: matterWithPracticeArea,
    contacts,
    sheet: effectiveSheet,
    lpData,
    intakeSnapshot,
  }
}
