/**
 * What ⌘K can find, and where each hit goes.
 *
 * The row-shaping is split out from the hook so it can be asserted against
 * fixture rows rather than through a rendered palette and a live database.
 */

export type SearchKind = 'matter' | 'contact' | 'task' | 'invoice'

export interface SearchHit {
  kind: SearchKind
  id: string
  /** The line a person scans for. */
  label: string
  /** Right-aligned context — a stage, a status, a phone number. */
  detail?: string | null
  href: string
}

/**
 * PostgREST reads `%` and `,` inside an `or()` filter as syntax, so a query
 * containing either would either match everything or fail to parse. Both are
 * dropped rather than escaped: neither is worth searching for, and a filter a
 * person can break by typing a comma is worse than one that ignores it.
 */
export function sanitizeTerm(term: string): string {
  // Runs are collapsed rather than left behind: a dropped character turns
  // "50%, draft" into "50  draft", and `%50  draft%` matches no text that a
  // person would call a match.
  return term.replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface MatterRow {
  matter_id: string
  matter_name: string | null
  client_name: string | null
  stage: string | null
}

export function matterHit(row: MatterRow): SearchHit {
  return {
    kind: 'matter',
    id: row.matter_id,
    label: row.client_name || row.matter_name || 'Untitled matter',
    detail: row.stage,
    href: `/admin/matters/${row.matter_id}`,
  }
}

export interface ContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
}

export function contactName(row: ContactRow): string {
  // The preferred name replaces the first name rather than joining it — a
  // contact called Robert who goes by Bob is "Bob Smith", not "Bob Robert Smith".
  const first = row.preferred_name?.trim() || row.first_name?.trim() || ''
  const last = row.last_name?.trim() || ''
  return [first, last].filter(Boolean).join(' ') || 'Unnamed contact'
}

export function contactHit(row: ContactRow): SearchHit {
  return {
    kind: 'contact',
    id: row.id,
    label: contactName(row),
    detail: row.email || row.phone,
    // The contacts table already deep-links by id; the softphone uses the same
    // parameter, so this needs no new route.
    href: `/admin/contacts?selected=${encodeURIComponent(row.id)}`,
  }
}

export interface TaskRow {
  id: string
  title: string | null
  status: string | null
  matter_id: string | null
}

export function taskHit(row: TaskRow): SearchHit {
  return {
    kind: 'task',
    id: row.id,
    label: row.title?.trim() || 'Untitled task',
    detail: row.status,
    href: `/admin/tasks?focus=${encodeURIComponent(row.id)}`,
  }
}

export interface InvoiceRow {
  id: string
  number: string | null
  status: string | null
  bill_to_name: string | null
}

export function invoiceHit(row: InvoiceRow): SearchHit {
  const number = row.number?.trim()
  return {
    kind: 'invoice',
    id: row.id,
    label: number ? `Invoice ${number}` : 'Draft invoice',
    detail: row.bill_to_name || row.status,
    href: `/admin/billing/invoices/${row.id}`,
  }
}

export interface RecentMatterRow {
  matter_id: string
  title: string
  client_name: string | null
}

export function recentHit(row: RecentMatterRow): SearchHit {
  return {
    kind: 'matter',
    id: row.matter_id,
    label: row.title || row.client_name || 'Untitled matter',
    href: `/admin/matters/${row.matter_id}`,
  }
}
