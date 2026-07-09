import type { SupabaseClient } from '@supabase/supabase-js'
import { practiceAreaMatterCode } from '@/lib/practiceArea'

export type MatterCode = 'EP' | 'EPLP' | 'PR'

/** Format a matter number, e.g. formatMatterNumber(2026, 'EP', 1) -> "2026-EP-001". */
export function formatMatterNumber(year: number, code: MatterCode, seq: number): string {
  return `${year}-${code}-${String(seq).padStart(3, '0')}`
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
  value: string | null
): Promise<Record<string, unknown> | null> {
  const next = value === '' ? null : value

  // Update the canonical column and confirm a row actually matched. Without the
  // row-count check a bad matterId would silently no-op here while the
  // matter_details upsert below still "succeeds" — the value would show
  // optimistically and then vanish on reload (the read pulls matters.matter_number).
  const { data: matterRows, error: matterErr } = await admin
    .from('matters')
    .update({ matter_number: next })
    .eq('id', matterId)
    .select('id')
  if (matterErr) throw new Error(matterErr.message)
  if (!matterRows || matterRows.length === 0) {
    throw new Error(`No matter found for id "${matterId}" — matter number not saved`)
  }

  // Upsert (not update) so the copy persists even when no matter_details row
  // exists yet — a plain update would silently no-op in that case.
  const { data, error: detailsErr } = await admin
    .from('matter_details')
    .upsert(
      { client_id: matterId, matter_number: next },
      { onConflict: 'client_id' }
    )
    .select()
    .single()
  if (detailsErr) throw new Error(detailsErr.message)

  return data
}

/**
 * Allocate the next sequential matter number for a (year, practice area):
 *   "2026-EP-001", "2026-EP-002", ...
 * Reads the current max sequence for the "YYYY-CODE-" prefix and increments.
 * The matter_number unique index is the source of truth: on a collision (a
 * concurrent allocation took the same NNN) we bump and retry.
 */
export async function generateUniqueMatterNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  input: GenerateMatterNumberInput
): Promise<string> {
  const code = practiceAreaMatterCode(input.practiceArea)
  const prefix = `${input.year}-${code}-`

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
    const candidate = formatMatterNumber(input.year, code, maxSeq + attempt)
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
