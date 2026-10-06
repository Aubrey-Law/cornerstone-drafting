import { NextResponse } from 'next/server'
import { firmTodayKey } from '@/lib/firmDate'
import { isIsoDate } from './dates'
import { PayrollConflictError, PayrollUnavailableError } from './server'

/** Shared request parsing and error mapping for the payroll routes. */

export function yearParam(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get('year')
  if (raw === null) return Number(firmTodayKey().slice(0, 4))
  const year = Number(raw)
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function payrollFailure(error: unknown, fallback: string) {
  if (error instanceof PayrollUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 })
  if (error instanceof PayrollConflictError) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 })
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}

/** A non-negative integer count of cents, or undefined when absent. Throws on a bad value. */
export function centsField(body: Record<string, unknown>, key: string, { nullable = false, positive = false } = {}): number | null | undefined {
  if (!(key in body)) return undefined
  const value = body[key]
  if (value === null && nullable) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    throw new FieldError(`${key} must be a ${positive ? 'positive' : 'non-negative'} whole number of cents`)
  }
  return value
}

export function dateField(body: Record<string, unknown>, key: string, { nullable = true } = {}): string | null | undefined {
  if (!(key in body)) return undefined
  const value = body[key]
  if ((value === null || value === '') && nullable) return null
  if (!isIsoDate(value)) throw new FieldError(`${key} must be a date (YYYY-MM-DD)`)
  return value
}

export function textField(body: Record<string, unknown>, key: string, max = 500): string | null | undefined {
  if (!(key in body)) return undefined
  const value = body[key]
  if (value === null || value === '') return null
  if (typeof value !== 'string' || value.length > max) throw new FieldError(`${key} must be text of at most ${max} characters`)
  return value.trim() || null
}

export class FieldError extends Error {}
