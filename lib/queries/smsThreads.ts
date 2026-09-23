import { getAdminClient } from '@/lib/supabaseAdmin'
import { optOutPhoneKey } from '@/lib/sms/optOut'

/**
 * Texts page data: one conversation per outside phone number, whether or not
 * that number belongs to a lead, client or contact. Backed by `v_sms_threads`.
 */

export type SmsThreadKind = 'lead' | 'client' | 'contact' | 'unknown'
export type SmsThreadFilter = 'all' | 'unread' | 'unknown'

export interface SmsThread {
  /** 10-digit key, as in `normalize_us_phone()`. Used in URLs. */
  phone: string
  phoneE164: string
  name: string | null
  kind: SmsThreadKind
  href: string | null
  leadId: string | null
  matterId: string | null
  contactId: string | null
  lastBody: string
  lastDirection: 'inbound' | 'outbound'
  lastStatus: string
  lastMessageAt: string
  unreadCount: number
  optedOut: boolean
}

export interface SmsThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  error: string | null
  actorName: string | null
  createdAt: string
}

interface ThreadRow {
  phone: string
  phone_e164: string
  last_body: string
  last_direction: 'inbound' | 'outbound'
  last_status: string
  last_message_at: string
  unread_count: number
  lead_id: string | null
  matter_id: string | null
  contact_id: string | null
  recipient_name: string | null
  opted_out: boolean
}

const THREAD_COLUMNS =
  'phone, phone_e164, last_body, last_direction, last_status, last_message_at, unread_count, lead_id, matter_id, contact_id, recipient_name, opted_out'

function fullName(first: string | null | undefined, last: string | null | undefined): string | null {
  return [first?.trim(), last?.trim()].filter(Boolean).join(' ').trim() || null
}

/** Names and record links for a page of threads, in three batched reads. */
async function enrichThreads(rows: ThreadRow[]): Promise<SmsThread[]> {
  const admin = getAdminClient()
  const leadIds = [...new Set(rows.map(r => r.lead_id).filter((v): v is string => Boolean(v)))]
  const contactIds = [...new Set(rows.map(r => r.contact_id).filter((v): v is string => Boolean(v)))]
  const matterIds = [...new Set(rows.map(r => r.matter_id).filter((v): v is string => Boolean(v)))]

  const [intakes, contacts, matters] = await Promise.all([
    leadIds.length
      ? admin.from('client_intake').select('id, full_name, first_name, last_name, matter_id').in('id', leadIds)
      : Promise.resolve({ data: [] as never[] }),
    contactIds.length
      ? admin.from('contacts').select('id, first_name, last_name, preferred_name').in('id', contactIds)
      : Promise.resolve({ data: [] as never[] }),
    matterIds.length
      ? admin.from('v_matter_pipeline_all').select('matter_id, client_name, relationship_status').in('matter_id', matterIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  type IntakeRow = { id: string; full_name: string | null; first_name: string | null; last_name: string | null; matter_id: string | null }
  type ContactRow = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }
  type MatterRow = { matter_id: string; client_name: string | null; relationship_status: string | null }
  const intakeById = new Map(((intakes.data ?? []) as IntakeRow[]).map(r => [r.id, r]))
  const contactById = new Map(((contacts.data ?? []) as ContactRow[]).map(r => [r.id, r]))
  const matterById = new Map(((matters.data ?? []) as MatterRow[]).map(r => [r.matter_id, r]))

  return rows.map(row => {
    let kind: SmsThreadKind = 'unknown'
    let name: string | null = null
    let href: string | null = null

    const contact = row.contact_id ? contactById.get(row.contact_id) : undefined
    const matter = row.matter_id ? matterById.get(row.matter_id) : undefined
    const intake = row.lead_id ? intakeById.get(row.lead_id) : undefined
    const hired = matter && (matter.relationship_status ?? 'hired') === 'hired'

    if (contact) {
      kind = 'contact'
      name = fullName(contact.preferred_name || contact.first_name, contact.last_name)
      href = `/admin/contacts?selected=${encodeURIComponent(contact.id)}`
    } else if (hired && matter) {
      kind = 'client'
      name = matter.client_name?.trim() || null
      href = `/admin/matters/${matter.matter_id}`
    } else if (intake) {
      kind = 'lead'
      name = intake.full_name?.trim() || fullName(intake.first_name, intake.last_name)
      href = `/admin/leads/${intake.id}`
    } else if (matter) {
      // A lead's opportunity matter with no lead link on the texts.
      kind = 'lead'
      name = matter.client_name?.trim() || null
      href = `/admin/matters/${matter.matter_id}`
    }

    return {
      phone: row.phone,
      phoneE164: row.phone_e164,
      name: name ?? (kind === 'unknown' ? null : row.recipient_name?.trim() || null),
      kind,
      href,
      leadId: row.lead_id,
      matterId: row.matter_id,
      contactId: row.contact_id,
      lastBody: row.last_body,
      lastDirection: row.last_direction,
      lastStatus: row.last_status,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count) || 0,
      optedOut: Boolean(row.opted_out),
    }
  })
}

export interface ListSmsThreadsOptions {
  filter?: SmsThreadFilter
  /** Threads whose last message is strictly older than this ISO timestamp. */
  cursor?: string | null
  limit?: number
}

export async function listSmsThreads({
  filter = 'all',
  cursor = null,
  limit = 50,
}: ListSmsThreadsOptions = {}): Promise<SmsThread[]> {
  let query = getAdminClient()
    .from('v_sms_threads')
    .select(THREAD_COLUMNS)
    .order('last_message_at', { ascending: false })
    .limit(limit)
  if (filter === 'unread') query = query.gt('unread_count', 0)
  if (filter === 'unknown') query = query.is('lead_id', null).is('matter_id', null).is('contact_id', null)
  if (cursor) query = query.lt('last_message_at', cursor)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return enrichThreads((data ?? []) as ThreadRow[])
}

export async function getSmsThreadSummary(phone: string): Promise<SmsThread | null> {
  const key = optOutPhoneKey(phone)
  if (!key) return null
  const { data, error } = await getAdminClient()
    .from('v_sms_threads')
    .select(THREAD_COLUMNS)
    .eq('phone', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const [thread] = await enrichThreads([data as ThreadRow])
  return thread ?? null
}

/**
 * Stored numbers come from Telnyx (E.164) or `normalizeSmsRecipient` (E.164),
 * but older rows may carry a bare 10- or 11-digit form, so match all three.
 */
export function phoneVariants(key: string): string[] {
  return [`+1${key}`, `1${key}`, key]
}

/** PostgREST filter selecting every message exchanged with this number. */
export function threadMessagesFilter(key: string): string {
  const list = phoneVariants(key).map(v => `"${v}"`).join(',')
  return `and(direction.eq.inbound,from_number.in.(${list})),and(direction.eq.outbound,to_number.in.(${list}))`
}

export async function getSmsThreadMessages(phone: string): Promise<SmsThreadMessage[]> {
  const key = optOutPhoneKey(phone)
  if (!key) return []
  const { data, error } = await getAdminClient()
    .from('sms_messages')
    .select('id, direction, body, status, error, actor_name, created_at')
    .or(threadMessagesFilter(key))
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{
    id: string
    direction: 'inbound' | 'outbound'
    body: string
    status: string
    error: string | null
    actor_name: string | null
    created_at: string
  }>)
    .reverse()
    .map(m => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      status: m.status,
      error: m.error,
      actorName: m.actor_name,
      createdAt: m.created_at,
    }))
}

export async function markSmsThreadRead(phone: string): Promise<number> {
  const key = optOutPhoneKey(phone)
  if (!key) return 0
  const { data, error } = await getAdminClient()
    .from('sms_messages')
    .update({ read_by_staff_at: new Date().toISOString() })
    .eq('direction', 'inbound')
    .in('from_number', phoneVariants(key))
    .is('read_by_staff_at', null)
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

export interface SmsThreadLink {
  leadId?: string | null
  matterId?: string | null
  contactId?: string | null
}

/** Attach every message with this number to a record, keeping links already set. */
export async function linkSmsThread(phone: string, link: SmsThreadLink): Promise<void> {
  const key = optOutPhoneKey(phone)
  if (!key) throw new Error('Invalid phone number')
  const admin = getAdminClient()
  const columns: Array<['lead_id' | 'matter_id' | 'contact_id', string | null | undefined]> = [
    ['lead_id', link.leadId],
    ['matter_id', link.matterId],
    ['contact_id', link.contactId],
  ]
  for (const [column, value] of columns) {
    if (!value) continue
    const { error } = await admin
      .from('sms_messages')
      .update({ [column]: value })
      .or(threadMessagesFilter(key))
      .is(column, null)
    if (error) throw new Error(error.message)
  }
}

/** Conversations with at least one unread inbound text. Drives the sidebar badge. */
export async function countUnreadSmsThreads(): Promise<number> {
  const { count, error } = await getAdminClient()
    .from('v_sms_threads')
    .select('phone', { count: 'exact', head: true })
    .gt('unread_count', 0)
  if (error) throw new Error(error.message)
  return count ?? 0
}
