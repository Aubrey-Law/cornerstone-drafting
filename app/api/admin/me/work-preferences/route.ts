import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchWorkPreferences } from '@/lib/work/server'

function integer(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`)
  }
  return parsed
}

function time(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) throw new Error(`${label} is invalid`)
  return value
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ preferences: await fetchWorkPreferences(auth.userId) })
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json() as Record<string, unknown>
    const row = {
      user_id: auth.userId,
      max_must_do: integer(body.maxMustDo, 1, 10, 'Must-do limit'),
      focus_capacity_minutes: integer(body.focusCapacityMinutes, 30, 720, 'Focus capacity'),
      interruption_buffer_percent: integer(body.interruptionBufferPercent, 0, 60, 'Interruption buffer'),
      focus_block_minutes: integer(body.focusBlockMinutes, 15, 120, 'Focus block'),
      max_focus_block_minutes: integer(body.maxFocusBlockMinutes, 15, 180, 'Maximum focus block'),
      admin_batch_minutes: integer(body.adminBatchMinutes, 15, 30, 'Admin batch'),
      workday_start: time(body.workdayStart, 'Workday start'),
      workday_end: time(body.workdayEnd, 'Workday end'),
    }
    if (![15, 30].includes(row.admin_batch_minutes)) throw new Error('Admin batch must be 15 or 30 minutes')
    if (row.focus_block_minutes > row.max_focus_block_minutes) throw new Error('Focus block cannot exceed its maximum')
    if (row.workday_end <= row.workday_start) throw new Error('Workday end must be after its start')
    const { error } = await getAdminClient().from('user_work_preferences')
      .upsert(row, { onConflict: 'user_id' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ preferences: await fetchWorkPreferences(auth.userId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid preferences' }, { status: 400 })
  }
}
