import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isRequestSection, type ProbateRequestItem } from './probateSet'
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

const LEGACY_COLUMNS = 'id, matter_id, title, description, due_on, status, source, requested_at, received_document_id, received_at, accepted_at, waived_at, waived_reason'
const COLUMNS = `${LEGACY_COLUMNS}, section, template_key`

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
  section?: string | null
  template_key?: string | null
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
    section: isRequestSection(row.section) ? row.section : null,
    templateKey: row.template_key ?? null,
  }
}

/** Code and migrations deploy in no guaranteed order; until the table exists there are no requests. */
export function isMissingRequestsTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

/** The section and template columns arrive with the probate intake migration. */
function isMissingColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? '')
}

/** Every request on the matter, oldest first, waived ones last. */
export async function listDocumentRequests(matterId: string, client: SupabaseClient = getAdminClient()): Promise<DocumentRequest[]> {
  const read = (columns: string) => client
    .from('document_requests')
    .select(columns)
    .eq('matter_id', matterId)
    .order('requested_at', { ascending: true })
    .limit(200)
  let { data, error } = await read(COLUMNS)
  if (error && isMissingColumn(error)) ({ data, error } = await read(LEGACY_COLUMNS))
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
    .select(LEGACY_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return fromRow(data as unknown as Row)
}

export class RequestListUnavailableError extends Error {
  constructor() {
    super('The probate document list is not available until the probate intake migration has run')
  }
}

/**
 * Adds the chosen standard-list items to the matter. The insert names the
 * matter and item as its conflict target, so a double click or a second send
 * adds nothing that is already there. Returns only the rows it created.
 */
export async function createListRequests(
  input: { matterId: string; items: readonly ProbateRequestItem[]; dueOn: string | null; requestedBy: string },
  client: SupabaseClient = getAdminClient(),
): Promise<DocumentRequest[]> {
  if (input.items.length === 0) return []
  const { data, error } = await client
    .from('document_requests')
    .upsert(input.items.map(item => ({
      matter_id: input.matterId,
      title: item.title,
      description: item.description,
      due_on: input.dueOn,
      source: 'staff',
      requested_by: input.requestedBy,
      section: item.section,
      template_key: item.key,
    })), { onConflict: 'matter_id,template_key', ignoreDuplicates: true })
    .select(COLUMNS)
  if (error) {
    if (isMissingColumn(error) || isMissingRequestsTable(error) || error.code === '42P10') throw new RequestListUnavailableError()
    throw new Error(error.message)
  }
  return ((data ?? []) as unknown as Row[]).map(fromRow)
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
    .select(LEGACY_COLUMNS)
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
    .select(LEGACY_COLUMNS)
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
