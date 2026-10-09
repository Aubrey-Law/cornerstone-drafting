import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@aubrey-law/db-types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { ClientFormAnswers } from './clientFormAnswers'

export type ClientFormStatus = 'sent' | 'in_progress' | 'submitted' | 'cancelled'
export type ClientFormAssignmentRow = {
  id: string
  matter_id: string
  client_intake_id: string
  form_version_id: string
  title: string
  status: ClientFormStatus
  answers: ClientFormAnswers
  revision: number
  sent_by: string | null
  sent_at: string
  submitted_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}
export type MatterLinkedIntakeRow = {
  id: string
  matter_id: string
  client_intake_id: string
  label: string | null
  created_by: string | null
  created_at: string
}

// Narrow typed extension until the additive migration is available to db:types:local.
type RowTable<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] }
type FormsDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Tables'> & {
  Tables: Database['public']['Tables'] & {
    client_form_assignments: RowTable<ClientFormAssignmentRow>
    matter_linked_intakes: RowTable<MatterLinkedIntakeRow>
  }
} }
export const formsDb = () => getAdminClient() as unknown as SupabaseClient<FormsDatabase>
