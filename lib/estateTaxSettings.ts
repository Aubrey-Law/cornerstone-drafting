import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BUNDLED_FEDERAL_SCHEDULES,
  BUNDLED_MA_SCHEDULES,
  type FederalEstateTaxSchedule,
  type MassachusettsEstateTaxSchedule,
} from '@/lib/estateTaxSchedules'

/**
 * Firm-configured estate tax schedules, overriding the bundled ones.
 *
 * The federal basic exclusion is indexed and changes most years. Shipping it as
 * a constant meant a figure went stale the moment the IRS published a new one
 * and stayed stale until someone deployed — so the attorney can now enter next
 * year's number without a release.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

const bracketSchema = z.object({
  from: z.number().min(0),
  upTo: z.number().positive().nullable(),
  base: z.number().min(0),
  rate: z.number().min(0).max(1),
})

const windowFields = {
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable(),
  source: z.string().min(1, 'Record the authority this figure comes from'),
}

export const massachusettsScheduleSchema = z.object({
  jurisdiction: z.literal('MA'),
  ...windowFields,
  exemption: z.number().min(0),
  credit: z.number().min(0),
  adjustment: z.number().min(0),
  brackets: z.array(bracketSchema).min(1),
})

export const federalScheduleSchema = z.object({
  jurisdiction: z.literal('US'),
  ...windowFields,
  exemption: z.number().min(0),
  rate: z.number().min(0).max(1),
})

export const estateTaxSchedulesSchema = z.array(
  z.discriminatedUnion('jurisdiction', [massachusettsScheduleSchema, federalScheduleSchema]),
)

export type EstateTaxScheduleInput = z.infer<typeof estateTaxSchedulesSchema>[number]

export interface EstateTaxSchedules {
  massachusetts: MassachusettsEstateTaxSchedule[]
  federal: FederalEstateTaxSchedule[]
}

export const BUNDLED_SCHEDULES: EstateTaxSchedules = {
  massachusetts: BUNDLED_MA_SCHEDULES,
  federal: BUNDLED_FEDERAL_SCHEDULES,
}

/**
 * Merges configured schedules over the bundled ones.
 *
 * A configured schedule replaces a bundled one with the same jurisdiction and
 * `effectiveFrom` — that is what makes correcting a figure possible, rather
 * than ending up with two schedules covering one date and the resolver picking
 * between them arbitrarily. Anything else is added.
 */
function upsertByEffectiveFrom<T extends { effectiveFrom: string }>(into: T[], schedule: T): void {
  const existing = into.findIndex(s => s.effectiveFrom === schedule.effectiveFrom)
  if (existing === -1) into.push(schedule)
  else into[existing] = schedule
}

export function mergeSchedules(
  configured: z.infer<typeof estateTaxSchedulesSchema>,
): EstateTaxSchedules {
  const massachusetts = [...BUNDLED_MA_SCHEDULES]
  const federal = [...BUNDLED_FEDERAL_SCHEDULES]

  // Split on the discriminant so each branch keeps its narrowed type. Sharing
  // one binding for both arrays loses that and needs a cast to compile, which
  // would be the one place a wrongly-shaped schedule could slip through.
  for (const schedule of configured) {
    if (schedule.jurisdiction === 'MA') upsertByEffectiveFrom(massachusetts, schedule)
    else upsertByEffectiveFrom(federal, schedule)
  }

  return { massachusetts, federal }
}

/**
 * Loads the firm's schedules, falling back to the bundled ones.
 *
 * Invalid stored JSON falls back rather than throwing: a malformed settings row
 * should not take down every page that shows an estate figure. It returns the
 * parse errors alongside so a settings screen can show what is wrong — silently
 * ignoring bad configuration is how someone comes to believe they entered a
 * figure that was never applied.
 */
export async function loadEstateTaxSchedules(
  admin: SupabaseClient,
): Promise<{ schedules: EstateTaxSchedules; errors: string[] }> {
  const { data, error } = await admin
    .from('firm_settings')
    .select('estate_tax_schedules')
    .eq('id', 1)
    .maybeSingle()

  if (error) return { schedules: BUNDLED_SCHEDULES, errors: [error.message] }

  const raw = (data as { estate_tax_schedules?: unknown } | null)?.estate_tax_schedules
  if (!raw || (Array.isArray(raw) && raw.length === 0)) {
    return { schedules: BUNDLED_SCHEDULES, errors: [] }
  }

  const parsed = estateTaxSchedulesSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      schedules: BUNDLED_SCHEDULES,
      errors: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
    }
  }

  return { schedules: mergeSchedules(parsed.data), errors: [] }
}

/**
 * Replaces the firm's configured schedules.
 *
 * The whole array is written at once rather than a row at a time. The editor
 * shows every schedule together and the resolver reads them together, so a
 * partial write would let the screen and the stored state disagree about which
 * figure is in force — which is the failure this whole feature exists to
 * prevent, arriving by a different door.
 */
export async function saveEstateTaxSchedules(
  admin: SupabaseClient,
  schedules: unknown,
  updatedBy: string | null,
): Promise<{ ok: true; schedules: EstateTaxScheduleInput[] } | { ok: false; errors: string[] }> {
  const parsed = estateTaxSchedulesSchema.safeParse(schedules)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
    }
  }

  const overlaps = findOverlaps(parsed.data)
  if (overlaps.length > 0) return { ok: false, errors: overlaps }

  const { error } = await admin
    .from('firm_settings')
    .update({
      estate_tax_schedules: parsed.data,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    })
    .eq('id', 1)

  if (error) return { ok: false, errors: [error.message] }
  return { ok: true, schedules: parsed.data }
}

/**
 * Rejects two schedules of one jurisdiction covering the same date.
 *
 * The resolver picks the latest `effectiveFrom` among those that match, so an
 * overlap does not throw — it silently prefers one figure over another, and
 * which one is a detail of the sort order rather than a decision anybody made.
 * Better to refuse the save and name the pair.
 */
function findOverlaps(schedules: EstateTaxScheduleInput[]): string[] {
  const errors: string[] = []

  for (const jurisdiction of ['MA', 'US'] as const) {
    const forJurisdiction = schedules
      .filter(schedule => schedule.jurisdiction === jurisdiction)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

    for (let i = 0; i < forJurisdiction.length; i += 1) {
      const current = forJurisdiction[i]
      if (current.effectiveTo !== null && current.effectiveTo < current.effectiveFrom) {
        errors.push(
          `${jurisdiction} schedule starting ${current.effectiveFrom} ends before it begins.`,
        )
      }
      const next = forJurisdiction[i + 1]
      if (!next) continue
      // An open-ended window swallows everything after it.
      if (current.effectiveTo === null || current.effectiveTo >= next.effectiveFrom) {
        errors.push(
          `Two ${jurisdiction} schedules cover ${next.effectiveFrom} — the one starting ${current.effectiveFrom} has not ended.`,
        )
      }
    }
  }

  return errors
}
