import 'server-only'
import type { getAdminClient } from '@/lib/supabaseAdmin'

type SupabaseMaybeError = { code?: string; message?: string; details?: string; hint?: string } | null
type AdminClient = ReturnType<typeof getAdminClient>

export type MatterShellRow = {
  client_intake_id: string | null
  matter_number?: string | null
  matter_type?: 'individual' | 'couple' | null
  matter_number_manual?: boolean | null
  portal_uploads_reviewed_at?: string | null
}
export type ClientIntakeShellRow = {
  id: string
  intake_sent_at: string | null
  intake_completed_at: string | null
  uploads_reviewed_at?: string | null
  email: string | null
  first_name: string | null
  status?: string | null
  user_id?: string | null
  client_user_id?: string | null
  unlock_requested_at?: string | null
  unlock_request_note?: string | null
}

const MATTER_SHELL_COLUMNS_FULL = 'client_intake_id, matter_number, matter_type, matter_number_manual, portal_uploads_reviewed_at'
const MATTER_SHELL_COLUMNS_BASE = 'client_intake_id, matter_number'
const CLIENT_INTAKE_COLUMNS_FULL = 'id, intake_sent_at, intake_completed_at, uploads_reviewed_at, email, first_name, status, user_id, client_user_id, unlock_requested_at, unlock_request_note'
const CLIENT_INTAKE_COLUMNS_BASE = 'id, intake_sent_at, email, first_name, status, user_id, client_user_id'

function normalizeClientIntakeShell(row: Partial<ClientIntakeShellRow> | null): ClientIntakeShellRow | null {
  if (!row?.id) return null
  return {
    id: row.id,
    intake_sent_at: row.intake_sent_at ?? null,
    intake_completed_at: row.intake_completed_at ?? null,
    uploads_reviewed_at: row.uploads_reviewed_at ?? null,
    email: row.email ?? null,
    first_name: row.first_name ?? null,
    status: row.status ?? null,
    user_id: row.user_id ?? null,
    client_user_id: row.client_user_id ?? null,
    unlock_requested_at: row.unlock_requested_at ?? null,
    unlock_request_note: row.unlock_request_note ?? null,
  }
}

export function isOptionalHistorySchemaError(error: SupabaseMaybeError) {
  if (!error) return false
  const text = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return (
    text.includes('source_lead_note_id') ||
    text.includes('source_matter_activity_id') ||
    text.includes('lead_meeting_notes') ||
    text.includes('lead_activity') ||
    text.includes('schema cache') ||
    text.includes('could not find') ||
    text.includes('does not exist')
  )
}

export async function loadMatterShell(admin: AdminClient, matterId: string): Promise<MatterShellRow | null> {
  const full = await admin
    .from('matters')
    .select(MATTER_SHELL_COLUMNS_FULL)
    .eq('id', matterId)
    .maybeSingle()

  if (!full.error) return full.data as MatterShellRow | null
  if (!isOptionalHistorySchemaError(full.error)) throw new Error(`Could not load matter history: ${full.error.message}`)

  console.warn('Matter detail optional matter columns unavailable; loading base matter row only:', full.error.message)
  const base = await admin
    .from('matters')
    .select(MATTER_SHELL_COLUMNS_BASE)
    .eq('id', matterId)
    .maybeSingle()

  if (base.error) throw new Error(`Could not load matter history: ${base.error.message}`)
  return base.data as MatterShellRow | null
}

export async function loadClientIntakeShell(admin: AdminClient, intakeId: string): Promise<ClientIntakeShellRow | null> {
  const full = await admin
    .from('client_intake')
    .select(CLIENT_INTAKE_COLUMNS_FULL)
    .eq('id', intakeId)
    .maybeSingle()

  if (!full.error) return normalizeClientIntakeShell(full.data as Partial<ClientIntakeShellRow> | null)
  if (!isOptionalHistorySchemaError(full.error)) throw new Error(`Could not load client intake: ${full.error.message}`)

  console.warn('Client intake optional columns unavailable; loading base intake row only:', full.error.message)
  const base = await admin
    .from('client_intake')
    .select(CLIENT_INTAKE_COLUMNS_BASE)
    .eq('id', intakeId)
    .maybeSingle()

  if (base.error) throw new Error(`Could not load client intake: ${base.error.message}`)
  return normalizeClientIntakeShell(base.data as Partial<ClientIntakeShellRow> | null)
}
