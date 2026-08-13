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
import { reconcilePlanTrackDecisions } from '@/lib/designSheet/reconcilePlanTrack'
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

  let sheet = await fetchDesignSheet(matterId)
  const needsSeed = !sheet || isDesignSheetUnseeded(sheet)
  if (needsSeed) {
    try {
      await ensureDesignSheetSeededFromIntake(matterId, { sheet, intake: intakeSnapshot })
    } catch (error) {
      // Seed failures must not take down the drafting workspace error boundary.
      console.error('ensureDesignSheetSeededFromIntake failed:', error)
    }
    sheet = await fetchDesignSheet(matterId)
  }

  const admin = getAdminClient()
  const [{ data: matterRow }, { data: detailsRow }] = await Promise.all([
    admin
      .from('matters')
      .select('li_plan_coverage, li_design_sheet_data, li_design_sheet_approved, matter_type')
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

  // The sheet's plan track follows the matter's practice area. Normally the
  // matter-details write already reconciled it; this catches sheets changed by a
  // backfill, an import, or SQL, so the workspace never renders the wrong plan.
  if (sheet?.id) {
    const { decisions } = reconcilePlanTrackDecisions({
      sheet,
      practiceArea: normalizedPracticeArea,
      intake: intakeSnapshot,
    })
    if (decisions) {
      const { error } = await admin
        .from('design_sheets')
        .update({ decisions, updated_at: new Date().toISOString() })
        .eq('id', sheet.id)
      if (error) {
        console.error('plan track reconcile failed:', error.message)
      } else {
        sheet = await fetchDesignSheet(matterId)
      }
    }
  }

  const matterType = (matterRow?.matter_type as 'individual' | 'couple' | null | undefined) ?? null
  const matterWithPracticeArea = { ...matter, practice_area: practiceArea }
  const isLP = normalizedPracticeArea === 'EP-LP'
  const lpData = isLP
    ? {
        li_plan_coverage: (matterRow?.li_plan_coverage as string) ?? '',
        li_design_sheet_data: (matterRow?.li_design_sheet_data as Record<string, unknown>) ?? {},
        li_design_sheet_approved: (matterRow?.li_design_sheet_approved as boolean) ?? false,
      }
    : null

  // Apply computed defaults once immediately after seeding — not on every workspace load.
  if (needsSeed && sheet?.id && sheet.client_name && isDesignSheetUnseeded(sheet) === false) {
    const defaultsPatch = computeDesignSheetDefaults(sheet, matterWithPracticeArea)
    // Skip write-on-read when nothing meaningful is missing beyond already-persisted values.
    const meaningfulKeys = Object.keys(defaultsPatch).filter(key => {
      const current = (sheet as unknown as Record<string, unknown>)[key]
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

  if (sheet) sheet = { ...sheet, matter_type: matterType }

  return {
    matterId,
    matter: matterWithPracticeArea,
    contacts,
    sheet,
    lpData,
    intakeSnapshot,
  }
}
