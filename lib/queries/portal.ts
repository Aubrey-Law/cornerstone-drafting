import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { firmTodayKey } from '@/lib/firmDate'
import { adjustedInvoiceBalance, type InvoiceBalanceAdjustment } from '@/lib/billing/invoices'
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

/** One invoice as the client sees it. Drafts and voids never appear. */
export interface PortalInvoice {
  id: string
  number: string
  issueDate: string | null
  dueDate: string | null
  subtotalCents: number
  collectedCents: number
  balanceCents: number
  overdue: boolean
  paid: boolean
  paymentLink: string | null
  /** The rendered invoice, when one was produced. */
  documentId: string | null
}

export interface PortalAccount {
  invoices: PortalInvoice[]
  balanceCents: number
  /** Soonest due date with money still owed, or null when nothing is open. */
  nextDueDate: string | null
}

/**
 * What the client owes, and the invoices behind it.
 *
 * Only issued, non-void invoices are ever returned: a draft is the firm's
 * working copy and must not be visible to the client, and a void invoice is
 * not a bill. That filter is applied here as well as in RLS, because this read
 * deliberately uses the admin client per the trust model above.
 */
export async function fetchPortalAccount(
  matterId: string,
  today = firmTodayKey(),
): Promise<PortalAccount> {
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('invoices')
    .select('id, number, issue_date, due_date, subtotal_cents, payment_link, pdf_document_id, docx_document_id, status, kind')
    .eq('matter_id', matterId)
    .not('issued_at', 'is', null)
    .neq('status', 'void')
    .order('issue_date', { ascending: false })

  if (error) {
    console.error('fetchPortalAccount error:', error)
    return { invoices: [], balanceCents: 0, nextDueDate: null }
  }

  type Row = {
    id: string
    number: string | null
    issue_date: string | null
    due_date: string | null
    subtotal_cents: number
    payment_link: string | null
    pdf_document_id: string | null
    docx_document_id: string | null
    status: string
    kind: string
  }
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return { invoices: [], balanceCents: 0, nextDueDate: null }

  const [paymentResult, adjustmentResult] = await Promise.all([
    admin.from('billing_payments').select('invoice_id, amount').in('invoice_id', rows.map(row => row.id)),
    admin.from('billing_adjustments').select('invoice_id, amount_cents, balance_effect, status')
      .in('invoice_id', rows.map(row => row.id)),
  ])
  if (paymentResult.error) {
    console.error('fetchPortalAccount payments error:', paymentResult.error)
  }

  const collected = new Map<string, number>()
  for (const payment of (paymentResult.data ?? []) as { invoice_id: string; amount: number }[]) {
    collected.set(payment.invoice_id, (collected.get(payment.invoice_id) ?? 0) + payment.amount)
  }

  const invoices: PortalInvoice[] = rows.map(row => {
    const collectedCents = collected.get(row.id) ?? 0
    const balanceCents = row.kind === 'credit_note' ? 0 : adjustedInvoiceBalance(
      row.subtotal_cents,
      collectedCents,
      adjustmentResult.error
        ? []
        : (adjustmentResult.data as Array<InvoiceBalanceAdjustment & { status: string }>)
            .filter(item => item.invoice_id === row.id && item.status === 'posted'),
    )
    return {
      id: row.id,
      number: row.number ?? '',
      issueDate: row.issue_date,
      dueDate: row.due_date,
      subtotalCents: row.subtotal_cents,
      collectedCents,
      balanceCents,
      overdue: balanceCents > 0 && Boolean(row.due_date) && today > row.due_date!,
      paid: balanceCents === 0,
      paymentLink: row.payment_link,
      documentId: row.pdf_document_id ?? row.docx_document_id,
    }
  })

  const open = invoices.filter(invoice => invoice.balanceCents > 0 && invoice.dueDate)
  return {
    invoices,
    balanceCents: invoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0),
    nextDueDate: open.length > 0
      ? open.map(invoice => invoice.dueDate!).sort()[0]
      : null,
  }
}
