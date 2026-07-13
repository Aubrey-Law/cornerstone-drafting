/**
 * Hand-maintained Supabase row shapes for Cornerstone Drafting.
 * Source: `supabase/migrations/` + `types/database.ts`.
 * Replace with `supabase gen types typescript` when wired to CI.
 */

import type {
  DesignSheet,
  MatterContact,
  MatterDocument,
  PipelineMatter,
} from '@/types/database'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface UserRow {
  id: string
  email: string | null
  display_name: string | null
  role: 'client' | 'attorney' | 'admin' | 'va' | 'staff'
  preferences: Json
  created_at: string
}

export interface MatterRow {
  id: string
  client_intake_id: string | null
  matter_number: string | null
  relationship_status: 'lead' | 'hired' | 'lost'
  hired_at: string | null
  lost_at: string | null
  lost_reason: string | null
  li_plan_coverage: string | null
  li_design_sheet_data: Json | null
  li_design_sheet_approved: boolean | null
  created_at: string
  updated_at: string | null
}

export type DesignSheetRow = DesignSheet

export type MatterDocumentRow = MatterDocument & {
  matter_id: string
  storage_key: string
  mime_type: string | null
  uploaded_by: string | null
}

export type ContactRow = MatterContact & {
  client_intake_id: string
  created_at: string
  updated_at: string | null
}

export type PipelineMatterRow = PipelineMatter

export interface DocSelectionRow {
  id: string
  design_sheet_id: string
  doc_type: string | null
  variant: string | null
  party: string | null
  selected: boolean | null
}

/** Tables queried by the drafting app — use for explicit casts at query sites. */
export type DraftingTableRows = {
  users: UserRow
  matters: MatterRow
  design_sheets: DesignSheetRow
  matter_documents: MatterDocumentRow
  contacts: ContactRow
  doc_selections: DocSelectionRow
  v_matter_pipeline: PipelineMatterRow
}
