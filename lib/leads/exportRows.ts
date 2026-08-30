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

function cell(value: string): string {
  // A leading =, +, - or @ makes a spreadsheet read the cell as a formula, so
  // quote-and-prefix those: a phone number like +1 617 555 0100 is text.
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped
}

export function leadExportCsv(rows: LeadExportRow[]): string {
  const lines = [['Name', 'Email', 'Phone'].join(',')]
  for (const row of rows) {
    lines.push([cell(row.name), cell(row.email), cell(row.phone)].join(','))
  }
  return lines.join('\n')
}

export function leadExportFilename(status: string, today = new Date()): string {
  const date = today.toISOString().slice(0, 10)
  const label = status && status !== 'all' ? status : 'all'
  return `cornerstone-leads-${label}-${date}.csv`
}
