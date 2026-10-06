import { SETTING_FIELDS } from './defaults'
import { MICROS } from './money'
import type { PayrollSettings } from './types'

const TEXT_LIMITS: Partial<Record<keyof PayrollSettings, number>> = {
  employerName: 200, employerEin: 20, employeeName: 200, employeeAddress: 500, employeeSsnLast4: 4,
}

/** Validate a settings body; returns an error message or the merged settings. */
export function mergeSettings(base: PayrollSettings, body: Record<string, unknown>): PayrollSettings | string {
  const next: PayrollSettings = { ...base }
  for (const field of SETTING_FIELDS) {
    if (!(field.key in body)) continue
    const value = body[field.key]
    if (field.kind === 'centsOrNull' && value === null) {
      (next as unknown as Record<string, unknown>)[field.key] = null
      continue
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return `${field.label} must be a non-negative whole number`
    if (field.kind === 'rate' && value > MICROS) return `${field.label} must be between 0% and 100%`
    if (field.kind === 'count' && (value < 1 || value > 53)) return `${field.label} must be between 1 and 53`
    ;(next as unknown as Record<string, unknown>)[field.key] = value
  }
  for (const [key, max] of Object.entries(TEXT_LIMITS) as [keyof PayrollSettings, number][]) {
    if (!(key in body)) continue
    const value = body[key]
    if (typeof value !== 'string' || value.length > max) return `${key} must be text of at most ${max} characters`
    ;(next as unknown as Record<string, unknown>)[key] = value.trim()
  }
  if (next.employeeSsnLast4 && !/^\d{4}$/.test(next.employeeSsnLast4)) return 'Only the last four digits of the SSN are stored'
  if ('ratesConfirmed' in body) next.ratesConfirmedAt = body.ratesConfirmed ? new Date().toISOString() : null
  return next
}
