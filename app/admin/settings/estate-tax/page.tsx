import { getAdminClient } from '@/lib/supabaseAdmin'
import { todayIso } from '@/lib/estateTaxSchedules'
import { federalScheduleAsOf, massachusettsScheduleAsOf } from '@/lib/estateTax'
import {
  BUNDLED_SCHEDULES,
  estateTaxSchedulesSchema,
  mergeSchedules,
  type EstateTaxScheduleInput,
} from '@/lib/estateTaxSettings'
import { EstateTaxSchedulesClient } from './EstateTaxSchedulesClient'

export const dynamic = 'force-dynamic'

export default async function EstateTaxSettingsPage() {
  let configured: EstateTaxScheduleInput[] = []
  let errors: string[] = []

  try {
    const { data, error } = await getAdminClient()
      .from('firm_settings')
      .select('estate_tax_schedules')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const raw = (data as { estate_tax_schedules?: unknown } | null)?.estate_tax_schedules ?? []
    const parsed = estateTaxSchedulesSchema.safeParse(raw)
    if (parsed.success) configured = parsed.data
    else errors = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
  } catch (cause) {
    errors = [cause instanceof Error ? cause.message : 'Could not load estate tax schedules']
  }

  const merged = mergeSchedules(configured)
  const asOf = todayIso()

  return (
    <EstateTaxSchedulesClient
      initial={{
        configured,
        bundled: BUNDLED_SCHEDULES,
        errors,
        effective: {
          asOf,
          massachusetts: massachusettsScheduleAsOf(asOf, merged.massachusetts),
          federal: federalScheduleAsOf(asOf, merged.federal),
        },
      }}
    />
  )
}
