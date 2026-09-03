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
