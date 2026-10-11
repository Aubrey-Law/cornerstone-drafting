import type { TriageClassification } from '@/lib/queries/emailTriage'

/**
 * Tasks allow at most one of matter_id / lead_id (`tasks_one_relation`).
 * Triage rows for leads often carry both: the open intake and a matter the
 * lead already produced. Prefer the matter when present — that is where firm
 * work continues after hire — otherwise the lead.
 */
export function taskRecordLink(row: {
  matter_id: string | null
  client_intake_id: string | null
  classification?: TriageClassification
}): { matter_id: string | null; lead_id: string | null } {
  if (row.matter_id) return { matter_id: row.matter_id, lead_id: null }
  if (row.client_intake_id) return { matter_id: null, lead_id: row.client_intake_id }
  return { matter_id: null, lead_id: null }
}
