import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { estateTaxSchedulesSchema, saveEstateTaxSchedules, BUNDLED_SCHEDULES } from '@/lib/estateTaxSettings'
import { federalScheduleAsOf, massachusettsScheduleAsOf } from '@/lib/estateTax'
import { mergeSchedules } from '@/lib/estateTaxSettings'
import { todayIso } from '@/lib/estateTaxSchedules'

/**
 * The firm's estate tax schedules.
 *
 * GET returns what is stored, what ships bundled, and — the part the screen
 * actually leads with — which schedule is in force today, or that none is. The
 * resolution happens here rather than in the browser so the page cannot show a
 * different answer from the one the app uses.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data, error } = await getAdminClient()
      .from('firm_settings')
      .select('estate_tax_schedules')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const raw = (data as { estate_tax_schedules?: unknown } | null)?.estate_tax_schedules ?? []
    const parsed = estateTaxSchedulesSchema.safeParse(raw)
    const configured = parsed.success ? parsed.data : []
    const errors = parsed.success
      ? []
      : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)

    const merged = mergeSchedules(configured)
    const asOf = todayIso()

    return NextResponse.json({
      configured,
      bundled: BUNDLED_SCHEDULES,
      errors,
      effective: {
        asOf,
        massachusetts: massachusettsScheduleAsOf(asOf, merged.massachusetts),
        federal: federalScheduleAsOf(asOf, merged.federal),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load estate tax schedules' },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { schedules?: unknown }
  const result = await saveEstateTaxSchedules(getAdminClient(), body.schedules ?? [], auth.userId)

  // Invalid figures and overlapping windows are both the caller's to fix, so
  // they read as 400 rather than as a server fault.
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 })

  const merged = mergeSchedules(result.schedules)
  const asOf = todayIso()
  return NextResponse.json({
    configured: result.schedules,
    effective: {
      asOf,
      massachusetts: massachusettsScheduleAsOf(asOf, merged.massachusetts),
      federal: federalScheduleAsOf(asOf, merged.federal),
    },
  })
}
