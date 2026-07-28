import { FIRM_TIMEZONE } from '@/lib/utils'

type DateValue = string | number | Date

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const COMPACT_CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function parsedDate(value: DateValue): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}
export function formatFirmDate(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const date = parsedDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', { ...options, timeZone: FIRM_TIMEZONE }).format(date)
    : ''
}

export function formatFirmDateTime(value: DateValue): string {
  const date = parsedDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: FIRM_TIMEZONE,
      }).format(date)
    : ''
}

export function formatUserLocalDateTime(value: DateValue): string {
  const date = parsedDate(value)
  return date
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : ''
}

export function formatCurrency(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : CURRENCY.format(value)
}

export function formatCompactCurrency(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '' : COMPACT_CURRENCY.format(value)
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
