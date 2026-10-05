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

/**
 * PMPS notes are usually taken while the client is still a lead, so they live in
 * lead_meeting_notes and never become matter notes. Five matches what the
 * assistant chat reads for a lead; with the matter notes the cap is fifteen.
 */
const LEAD_MEETING_NOTE_LIMIT = 5

export const LEAD_MEETING_NOTE_TYPE = 'lead meeting note'

export interface CompletionMatterNote {
  id: string
  note_type: string | null
  body: string | null
  created_at: string | null
}

interface LeadMeetingNoteRow {
  id: string
  title: string | null
  body: string | null
  meeting_date: string | null
}

type SupabaseMaybeError = { code?: string; message?: string; details?: string; hint?: string } | null | undefined

/** Same test as the matter page: a missing table or column is not a failure. */
function isOptionalHistorySchemaError(error: SupabaseMaybeError) {
  if (!error) return false
  const text = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return (
    text.includes('lead_meeting_notes') ||
    text.includes('schema cache') ||
    text.includes('could not find') ||
    text.includes('does not exist')
  )
}

async function loadLeadMeetingNotes(
  admin: ReturnType<typeof getAdminClient>,
  clientIntakeId: string | null | undefined,
): Promise<CompletionMatterNote[]> {
  if (!clientIntakeId) return []

  const { data, error } = await admin
    .from('lead_meeting_notes')
    .select('id, title, body, meeting_date')
    .eq('lead_id', clientIntakeId)
    .order('meeting_date', { ascending: false })
    .limit(LEAD_MEETING_NOTE_LIMIT)

  if (error) {
    // Supplementary material: autofill still runs from the matter notes alone.
    if (isOptionalHistorySchemaError(error)) {
      console.warn('Lead meeting notes schema unavailable; autofill continues without them:', error.message)
    } else {
      console.warn('Lead meeting notes unavailable; autofill continues without them:', error.message)
    }
    return []
  }

  return ((data ?? []) as LeadMeetingNoteRow[]).map(row => ({
    id: row.id,
    note_type: LEAD_MEETING_NOTE_TYPE,
    body: [row.title?.trim(), row.body?.trim()].filter(Boolean).join('\n') || null,
    created_at: row.meeting_date,
  }))
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
  // The lead id is the intake id too, so the PMPS notes hang off the same FK.
  const [assetsRes, leadMeetingNotes] = await Promise.all([
    clientIntakeId
      ? admin
          .from('asset_intake')
          .select('category, description, value, ownership')
          .eq('client_intake_id', clientIntakeId)
          .order('category')
      : Promise.resolve({ data: [] as CompletionAssetRow[] }),
    loadLeadMeetingNotes(admin, clientIntakeId),
  ])

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
    notes: [...((notesRes.data ?? []) as CompletionMatterNote[]), ...leadMeetingNotes],
    assets: (assetsRes.data ?? []) as CompletionAssetRow[],
    blocking: readiness.blocking,
    optional: readiness.optional,
    readinessComplete: readiness.complete,
  }
}
