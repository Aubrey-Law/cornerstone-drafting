import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  isDocumentRequestStatus,
  type DocumentRequest,
  type DocumentRequestSource,
  type DocumentRequestStatus,
} from './model'

/**
 * Reads and writes for `document_requests`. Every caller has already proven
 * the actor may touch the matter: staff routes through `requireAdmin`, the
 * portal through `getMatterForUser`, the registry through the action gate.
 */

const COLUMNS = 'id, matter_id, title, description, due_on, status, source, requested_at, received_document_id, received_at, accepted_at, waived_at, waived_reason'

interface Row {
  id: string
  matter_id: string
  title: string
  description: string | null
  due_on: string | null
  status: string
  source: string
  requested_at: string
  received_document_id: string | null
  received_at: string | null
  accepted_at: string | null
  waived_at: string | null
  waived_reason: string | null
}

function fromRow(row: Row): DocumentRequest {
  return {
    id: row.id,
    matterId: row.matter_id,
    title: row.title,
    description: row.description,
    dueOn: row.due_on,
    status: isDocumentRequestStatus(row.status) ? row.status : 'requested',
    source: (row.source === 'meeting_notes' || row.source === 'automation') ? row.source : 'staff',
    requestedAt: row.requested_at,
    receivedDocumentId: row.received_document_id,
    receivedAt: row.received_at,
    acceptedAt: row.accepted_at,
    waivedAt: row.waived_at,
    waivedReason: row.waived_reason,
  }
}

/** Code and migrations deploy in no guaranteed order; until the table exists there are no requests. */
export function isMissingRequestsTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

/** Every request on the matter, oldest first, waived ones last. */
export async function listDocumentRequests(matterId: string, client: SupabaseClient = getAdminClient()): Promise<DocumentRequest[]> {
  const { data, error } = await client
    .from('document_requests')
    .select(COLUMNS)
    .eq('matter_id', matterId)
    .order('requested_at', { ascending: true })
    .limit(200)
  if (error) {
    if (isMissingRequestsTable(error)) return []
    throw new Error(error.message)
  }
  const rows = ((data ?? []) as unknown as Row[]).map(fromRow)
  return [...rows.filter(row => row.status !== 'waived'), ...rows.filter(row => row.status === 'waived')]
}

export interface CreateDocumentRequestInput {
  matterId: string
  title: string
  description?: string | null
  dueOn?: string | null
  source?: DocumentRequestSource
  sourceRef?: string | null
  requestedBy?: string | null
}

export async function createDocumentRequest(input: CreateDocumentRequestInput, client: SupabaseClient = getAdminClient()): Promise<DocumentRequest> {
  const { data, error } = await client
    .from('document_requests')
    .insert({
      matter_id: input.matterId,
      title: input.title,
      description: input.description ?? null,
      due_on: input.dueOn ?? null,
      source: input.source ?? 'staff',
      source_ref: input.sourceRef ?? null,
      requested_by: input.requestedBy ?? null,
    })
    .select(COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return fromRow(data as unknown as Row)
}

/** The client uploaded against the request: it is received and the document is linked. */
export async function markDocumentRequestReceived(
  input: { requestId: string; matterId: string; documentId: string },
  client: SupabaseClient = getAdminClient(),
): Promise<DocumentRequest | null> {
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('document_requests')
    .update({ status: 'received', received_document_id: input.documentId, received_at: now, updated_at: now })
    .eq('id', input.requestId)
    .eq('matter_id', input.matterId)
    .in('status', ['requested', 'received'])
    .select(COLUMNS)
    .maybeSingle()
  if (error) {
    if (isMissingRequestsTable(error)) return null
    throw new Error(error.message)
  }
  return data ? fromRow(data as unknown as Row) : null
}

export type DocumentRequestDecision =
  | { kind: 'accept'; actorId: string }
  | { kind: 'waive'; actorId: string; reason: string | null }
  | { kind: 'reopen' }

/** Staff decide what to do with a request: accept what arrived, waive it, or ask again. */
export async function decideDocumentRequest(
  input: { requestId: string; matterId: string; decision: DocumentRequestDecision },
  client: SupabaseClient = getAdminClient(),
): Promise<DocumentRequest | null> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  let status: DocumentRequestStatus
  switch (input.decision.kind) {
    case 'accept':
      status = 'accepted'
      Object.assign(patch, { status, accepted_at: now, accepted_by: input.decision.actorId, waived_at: null, waived_reason: null })
      break
    case 'waive':
      status = 'waived'
      Object.assign(patch, { status, waived_at: now, waived_reason: input.decision.reason })
      break
    case 'reopen':
      status = 'requested'
      Object.assign(patch, { status, accepted_at: null, accepted_by: null, waived_at: null, waived_reason: null })
      break
  }
  const { data, error } = await client
    .from('document_requests')
    .update(patch)
    .eq('id', input.requestId)
    .eq('matter_id', input.matterId)
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? fromRow(data as unknown as Row) : null
}

/** Only a request nothing has arrived against can be taken back. */
export async function deleteUnansweredDocumentRequest(requestId: string, client: SupabaseClient = getAdminClient()): Promise<boolean> {
  const { data, error } = await client
    .from('document_requests')
    .delete()
    .eq('id', requestId)
    .eq('status', 'requested')
    .select('id')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}
