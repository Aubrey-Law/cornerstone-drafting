import { csvFilename, toCsvText } from '@/lib/csvFile'
import type { LeadListParams } from '@/lib/leads/listParams'

/**
 * The shape of a lead export — the contact fields the attorney asks for when
 * they want "a list of leads": name, email, phone.
 *
 * Pure so both the CSV download route and the assistant's `export_leads` tool
 * build the same rows from the same source columns, and so the formatting is
 * testable without a database.
 */

export interface LeadExportSourceRow {
  id?: string | null
  display_name?: string | null
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
}

export interface LeadExportRow {
  id: string
  name: string
  email: string
  phone: string
}

/** Hard ceiling on one export, so a hand-edited `limit` cannot ask for everything. */
export const LEAD_EXPORT_MAX_ROWS = 2000

/** Rows returned when the caller does not ask for a specific count. */
export const LEAD_EXPORT_DEFAULT_ROWS = 500

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The display name, in the same order `v_lead_list.display_name` resolves it:
 * the stored full name, else first and last together, else the email. A lead
 * with none of those still exports — with an empty name rather than a
 * fabricated one.
 */
export function leadExportName(row: LeadExportSourceRow): string {
  return (
    trimmed(row.display_name)
    || trimmed(row.full_name)
    || [trimmed(row.first_name), trimmed(row.last_name)].filter(Boolean).join(' ')
    || trimmed(row.email)
  )
}

export function toLeadExportRow(row: LeadExportSourceRow): LeadExportRow {
  return {
    id: trimmed(row.id),
    name: leadExportName(row),
    email: trimmed(row.email),
    phone: trimmed(row.phone),
  }
}

export function clampLeadExportLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return LEAD_EXPORT_DEFAULT_ROWS
  return Math.max(1, Math.min(LEAD_EXPORT_MAX_ROWS, Math.floor(numeric)))
}

export const LEAD_EXPORT_HEADERS = ['Name', 'Email', 'Phone']

export function leadExportCsv(rows: LeadExportRow[]): string {
  return toCsvText(LEAD_EXPORT_HEADERS, rows.map(row => [row.name, row.email, row.phone]))
}

export function leadExportFilename(status: string, today = new Date()): string {
  return csvFilename('leads', status, today)
}

/**
 * The export route's URL for a given selection.
 *
 * One definition, so the leads page's Export button and the assistant's
 * `export_leads` tool hand back the same link for the same filters.
 */
export function leadExportUrl(params: LeadListParams): string {
  const query = new URLSearchParams({ status: params.status, sort: params.sort })
  if (params.card) query.set('card', params.card)
  if (params.search) query.set('search', params.search)
  if (params.practice && params.practice !== 'all') query.set('practice', params.practice)
  if (params.progress !== 'all') query.set('progress', params.progress)
  return `/api/admin/leads/export?${query.toString()}`
}
