import type { SupabaseClient } from '@supabase/supabase-js'
import { practiceAreaMatterCode } from '@/lib/practiceArea'

export type MatterCode = 'EP' | 'EPLP' | 'PR'

/** Format a matter number, e.g. formatMatterNumber(2026, 'EP', 1) -> "2026-EP-001". */
export function formatMatterNumber(year: number, code: MatterCode, seq: number): string {
  return `${year}-${code}-${String(seq).padStart(3, '0')}`
}

/** Slug for client last name in matter numbers, e.g. "Mary O'Brien" -> "OBrien". */
export function clientNameMatterSlug(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? '').trim()
  if (!trimmed) return 'Client'
  const parts = trimmed.split(/\s+/)
  const last = parts[parts.length - 1] ?? parts[0] ?? 'Client'
  const slug = last.replace(/[^a-zA-Z0-9]/g, '')
  return slug || 'Client'
}

export function matterNumberPrefix(year: number, code: MatterCode, clientSlug: string): string {
  return `${year}-${code}-${clientSlug}-`
}

/** Format with client name, e.g. "2026-EP-Smith-001". */
export function formatMatterNumberWithClient(
  year: number,
  code: MatterCode,
  clientSlug: string,
  seq: number,
): string {
  return `${matterNumberPrefix(year, code, clientSlug)}${String(seq).padStart(3, '0')}`
}

/**
 * Extract the numeric sequence from a matter number given its `YYYY-CODE-`
 * prefix. Returns null when the value doesn't match the prefix or the tail
 * isn't a plain integer (e.g. legacy "2026-EP-Aubrey").
 */
export function parseMatterSeq(matterNumber: string, prefix: string): number | null {
  if (!matterNumber.startsWith(prefix)) return null
  const tail = matterNumber.slice(prefix.length)
  if (!/^\d+$/.test(tail)) return null
  return Number.parseInt(tail, 10)
}

interface GenerateMatterNumberInput {
  year: number
  practiceArea: unknown
  clientLastName?: string | null
  clientFirstName?: string | null
}

interface SetMatterNumberOptions {
  manual?: boolean
}

/**
 * Persist a matter number to BOTH tables it lives on:
 *   - `matters.matter_number` — the canonical home (carries the UNIQUE index)
 *   - `matter_details.matter_number` — a denormalized copy other surfaces read
 *
 * Writing only one leaves the two drifted (the original cause of stale matter
 * numbers on the details card), so every write path funnels through here.
 * Returns the upserted matter_details row. Throws on DB error.
 */
export async function setMatterNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  matterId: string,
  value: string | null,
  options?: SetMatterNumberOptions,
): Promise<Record<string, unknown> | null> {
  const next = value === '' ? null : value
  const matterUpdate: { matter_number: string | null; matter_number_manual?: boolean } = {
    matter_number: next,
  }
  if (options?.manual !== undefined) {
    matterUpdate.matter_number_manual = options.manual
  }

  const { data: matterRows, error: matterErr } = await admin
    .from('matters')
    .update(matterUpdate)
    .eq('id', matterId)
    .select('id')
  if (matterErr) throw new Error(matterErr.message)
  if (!matterRows || matterRows.length === 0) {
    throw new Error(`No matter found for id "${matterId}" — matter number not saved`)
  }

  const { data, error: detailsErr } = await admin
    .from('matter_details')
    .upsert(
      { client_id: matterId, matter_number: next },
      { onConflict: 'client_id' },
    )
    .select()
    .single()
  if (detailsErr) throw new Error(detailsErr.message)

  return data
}

/**
 * Allocate the next sequential matter number for a (year, practice area, client):
 *   "2026-EP-Smith-001", "2026-EP-Smith-002", ...
 * Reads the current max sequence for the "YYYY-CODE-LastName-" prefix and increments.
 * The matter_number unique index is the source of truth: on a collision (a
 * concurrent allocation took the same NNN) we bump and retry.
 */
export async function generateUniqueMatterNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  input: GenerateMatterNumberInput,
): Promise<string> {
  const code = practiceAreaMatterCode(input.practiceArea)
  const clientSlug = clientNameMatterSlug(input.clientLastName || input.clientFirstName)
  const prefix = matterNumberPrefix(input.year, code, clientSlug)

  const { data: rows, error } = await admin
    .from('matters')
    .select('matter_number')
    .like('matter_number', `${prefix}%`)
  if (error) throw new Error(`matter_number lookup failed: ${error.message}`)

  let maxSeq = 0
  for (const row of (rows ?? []) as { matter_number: string | null }[]) {
    const seq = row.matter_number ? parseMatterSeq(row.matter_number, prefix) : null
    if (seq !== null && seq > maxSeq) maxSeq = seq
  }

  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = formatMatterNumberWithClient(input.year, code, clientSlug, maxSeq + attempt)
    const { data: clash, error: clashErr } = await admin
      .from('matters')
      .select('id')
      .eq('matter_number', candidate)
      .maybeSingle()
    if (clashErr) throw new Error(`matter_number lookup failed: ${clashErr.message}`)
    if (!clash) return candidate
  }
  throw new Error(`Could not allocate a unique matter number for "${prefix}"`)
}
