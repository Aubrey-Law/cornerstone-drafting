import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { MatterDocument } from '@/types/database'

/**
 * Every read below follows the same trust model as `fetchSharedDocuments`:
 * the caller has already proven this user owns `matterId` (via
 * `getMatterForUser`, whose intake read is RLS-gated), so the admin client is
 * used to fetch the matter-scoped rows. Never call these with a matter id that
 * did not come out of that ownership check.
 */

/** Everything the firm has shared with the client, newest first. */
export async function fetchSharedDocuments(matterId: string): Promise<MatterDocument[]> {
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .not('shared_at', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchSharedDocuments error:', error)
    return []
  }
  return (data ?? []) as MatterDocument[]
}

/** Documents the client uploaded themselves. */
export async function fetchClientUploads(
  matterId: string,
  userId: string,
): Promise<MatterDocument[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .eq('source', 'client')
    .eq('uploaded_by', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchClientUploads error:', error)
    return []
  }
  return (data ?? []) as MatterDocument[]
}

/**
 * Firm-shared documents and this client's own uploads, newest first.
 * Used by the portal dashboard's "Recent documents" card.
 */
export async function fetchRecentPortalDocuments(
  matterId: string,
  userId: string,
  limit = 2,
): Promise<MatterDocument[]> {
  const [shared, uploads] = await Promise.all([
    fetchSharedDocuments(matterId),
    fetchClientUploads(matterId, userId),
  ])
  return [...shared, ...uploads]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
}

export interface PortalMatterMeta {
  matterName: string | null
  createdAt: string | null
}

/** Display metadata for the dashboard header (`{name} · started {date}`). */
export async function fetchPortalMatterMeta(matterId: string): Promise<PortalMatterMeta | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matters')
    .select('name, created_at')
    .eq('id', matterId)
    .maybeSingle()

  if (error) {
    console.error('fetchPortalMatterMeta error:', error)
    return null
  }
  if (!data) return null
  return {
    matterName: (data.name as string | null) ?? null,
    createdAt: (data.created_at as string | null) ?? null,
  }
}

export interface PortalFirmMessage {
  id: string
  body: string
  senderRole: string
  createdAt: string
}

/**
 * The most recent message *from the firm* (anything the client did not send).
 * Mirrors the `sender_role <> 'client'` rule in the `mark_messages_read` RPC.
 */
export async function fetchLatestFirmMessage(matterId: string): Promise<PortalFirmMessage | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('messages')
    .select('id, body, sender_role, created_at')
    .eq('matter_id', matterId)
    .neq('sender_role', 'client')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('fetchLatestFirmMessage error:', error)
    return null
  }
  if (!data) return null
  return {
    id: data.id as string,
    body: (data.body as string | null) ?? '',
    senderRole: (data.sender_role as string | null) ?? 'attorney',
    createdAt: data.created_at as string,
  }
}

/** Unread firm messages for this matter, using the same rule as `mark_messages_read`. */
export async function fetchUnreadFirmMessageCount(matterId: string): Promise<number> {
  const admin = getAdminClient()
  const { count, error } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('matter_id', matterId)
    .neq('sender_role', 'client')
    .is('read_at', null)

  if (error) {
    console.error('fetchUnreadFirmMessageCount error:', error)
    return 0
  }
  return count ?? 0
}

export interface PortalAppointment {
  id: string
  startTime: string
  typeLabel: string | null
}

/**
 * Next scheduled appointment for this matter.
 *
 * Note: `matters.next_appointment` (exposed via `v_matter_pipeline`) is a
 * hard-coded `null` placeholder in the schema, so the real source of truth is
 * the `appointments` table keyed by `linked_matter_id`.
 */
export async function fetchNextAppointment(matterId: string): Promise<PortalAppointment | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('appointments')
    .select('id, start_time, appointment_types(label)')
    .eq('linked_matter_id', matterId)
    .eq('status', 'scheduled')
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('fetchNextAppointment error:', error)
    return null
  }
  if (!data) return null
  // PostgREST types the embedded row as an array or object depending on the
  // inferred cardinality; normalize both shapes.
  const rawType = (data as { appointment_types?: unknown }).appointment_types
  const typeRow = (Array.isArray(rawType) ? rawType[0] : rawType) as { label?: string } | undefined
  return {
    id: data.id as string,
    startTime: data.start_time as string,
    typeLabel: typeRow?.label ?? null,
  }
}
