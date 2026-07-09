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
import { isDesignSheetUnseeded } from '@/lib/designSheet/seedFromIntake'
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

  // Seed only when needed; avoid re-fetching intake inside ensure when we already have it.
  let sheet = await fetchDesignSheet(matterId)
  if (!sheet || isDesignSheetUnseeded(sheet)) {
    await ensureDesignSheetSeededFromIntake(matterId)
    sheet = await fetchDesignSheet(matterId)
  }

  const admin = getAdminClient()
  const [{ data: matterRow }, { data: detailsRow }] = await Promise.all([
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
  ])

  // Prefer matter_details, then pipeline row already loaded via fetchMatter.
  const practiceArea = detailsRow?.practice_area ?? matter.practice_area ?? null
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

  // Only apply computed defaults when the sheet was just seeded / still missing key defaults.
  if (sheet?.id && sheet.client_name && isDesignSheetUnseeded(sheet) === false) {
    const defaultsPatch = computeDesignSheetDefaults(sheet, matterWithPracticeArea)
    // Skip write-on-read when nothing meaningful is missing beyond already-persisted values.
    const meaningfulKeys = Object.keys(defaultsPatch).filter(key => {
      const current = (sheet as Record<string, unknown>)[key]
      return current == null || current === ''
    })
    if (meaningfulKeys.length > 0) {
      const patch: Record<string, unknown> = {}
      for (const key of meaningfulKeys) patch[key] = defaultsPatch[key as keyof typeof defaultsPatch]
      await admin.from('design_sheets').update({
        ...buildDesignSheetPersistencePayload({ ...sheet, ...patch }),
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
