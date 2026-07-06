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
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
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
  const [matter, contacts, intakeSnapshot] = await Promise.all([
    fetchMatter(matterId),
    fetchMatterContacts(matterId),
    fetchIntakeForMatter(matterId),
  ])

  if (!matter) notFound()

  await ensureDesignSheetSeededFromIntake(matterId)

  let sheet = await fetchDesignSheet(matterId)

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

  if (sheet?.id && sheet.client_name) {
    const defaultsPatch = computeDesignSheetDefaults(sheet, matterWithPracticeArea)
    if (Object.keys(defaultsPatch).length > 0) {
      await admin.from('design_sheets').update({
        ...buildDesignSheetPersistencePayload({ ...sheet, ...defaultsPatch }),
        updated_at: new Date().toISOString(),
      }).eq('id', sheet.id)

      sheet = await fetchDesignSheet(matterId)
    }
  }

  return {
    matterId,
    matter: matterWithPracticeArea,
    contacts,
    sheet,
    lpData,
    intakeSnapshot,
  }
}
