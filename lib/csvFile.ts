/**
 * CSV text for the exports the admin surfaces hand a reader.
 *
 * Kept in one place so the leads export, the matters export and anything that
 * follows escape the same way. Deliberately not used by the accounting export
 * (`app/api/admin/billing/export`): that file is read by bookkeeping software
 * and its negative amounts must stay bare numbers, not quote-prefixed text.
 */

export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  // A leading =, +, - or @ makes a spreadsheet read the cell as a formula, so
  // quote-and-prefix those: a phone number like +1 617 555 0100 is text.
  const escaped = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped
}

export function toCsvText(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')
}

/** `<prefix>-<label>-<yyyy-mm-dd>.csv`, e.g. cornerstone-leads-open-2026-08-30.csv */
export function csvFilename(prefix: string, label: string, today = new Date()): string {
  const date = today.toISOString().slice(0, 10)
  const middle = label && label !== 'all' ? `${label}-` : 'all-'
  return `cornerstone-${prefix}-${middle}${date}.csv`
}
