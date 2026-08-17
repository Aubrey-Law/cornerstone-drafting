/**
 * Everything a completion pass needs to know: the sheet as stored, what is still
 * missing, and the raw material an answer could come from.
 *
 * Read-only on purpose. `loadDraftingMatterContext` assembles a superset of this
 * but also seeds, reconciles the plan track and resyncs the SLA template — side
 * effects that belong to opening the workspace, not to asking what is missing.
 * Autofill always runs from a page that has already done all that.
 */
import {
  computeDesignSheetReadiness,
  type DesignReadinessBlocker,
} from '@/lib/designSheetReadiness'
import { fetchDesignSheet, fetchIntakeForMatter, fetchMatter, fetchMatterContacts } from '@/lib/queries'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizePracticeArea } from '@/lib/practiceArea'
import type { IntakeSnapshot } from '@/lib/queries'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'

/** Matter notes are the meeting record; ten is what the assistant chat also reads. */
const MATTER_NOTE_LIMIT = 10

export interface CompletionMatterNote {
  id: string
  note_type: string | null
  body: string | null
  created_at: string | null
}

export interface CompletionAssetRow {
  category: string | null
  description: string | null
  value: number | null
  ownership: string | null
}

export interface DesignSheetCompletionContext {
  matterId: string
  matter: PipelineMatter
  sheet: DesignSheet
  contacts: MatterContact[]
  intake: IntakeSnapshot | null
  notes: CompletionMatterNote[]
  assets: CompletionAssetRow[]
  blocking: DesignReadinessBlocker[]
  optional: DesignReadinessBlocker[]
  readinessComplete: boolean
}

export async function buildCompletionContext(matterId: string): Promise<DesignSheetCompletionContext> {
  const admin = getAdminClient()

  const [matter, contacts, intake, sheet] = await Promise.all([
    fetchMatter(matterId),
    fetchMatterContacts(matterId),
    fetchIntakeForMatter(matterId),
    fetchDesignSheet(matterId),
  ])

  if (!matter) throw new Error('Matter not found')
  if (!sheet) throw new Error('This matter has no design sheet yet. Open the drafting workspace first.')

  const [matterRow, detailsRow, notesRes] = await Promise.all([
    admin
      .from('matters')
      .select('client_intake_id, li_plan_coverage, li_design_sheet_data, li_design_sheet_approved')
      .eq('id', matterId)
      .maybeSingle(),
    admin.from('matter_details').select('practice_area').eq('client_id', matterId).maybeSingle(),
    admin
      .from('matter_notes')
      .select('id, note_type, body, created_at')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: false })
      .limit(MATTER_NOTE_LIMIT),
  ])

  // asset_intake keys off the intake row, and IntakeSnapshot is a projection that
  // does not carry its id — take it from the matter's FK instead.
  const clientIntakeId = matterRow.data?.client_intake_id as string | null | undefined
  const assetsRes = clientIntakeId
    ? await admin
        .from('asset_intake')
        .select('category, description, value, ownership')
        .eq('client_intake_id', clientIntakeId)
        .order('category')
    : { data: [] as CompletionAssetRow[] }

  const practiceArea = detailsRow.data?.practice_area ?? matter.practice_area ?? null
  const isLP = normalizePracticeArea(practiceArea) === 'EP-LP'
  const lpData = isLP
    ? {
        li_design_sheet_data:
          (matterRow.data?.li_design_sheet_data as Record<string, unknown>) ?? {},
      }
    : null

  const readiness = computeDesignSheetReadiness({
    sheet,
    matter: { has_minor_children: matter.has_minor_children },
    isLP,
    lpData,
  })

  return {
    matterId,
    matter,
    sheet,
    contacts,
    intake,
    notes: (notesRes.data ?? []) as CompletionMatterNote[],
    assets: (assetsRes.data ?? []) as CompletionAssetRow[],
    blocking: readiness.blocking,
    optional: readiness.optional,
    readinessComplete: readiness.complete,
  }
}
