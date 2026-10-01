import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import { fetchDueTasks } from '@/lib/queries/tasks'
import { taskDueGroup } from '@/lib/tasks/types'
import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { appUrl } from '@/lib/urls'
import { runSystemAutomation } from '@/lib/automations/control'

export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FIRM_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date())
  const value = (type: string) => parts.find(part => part.type === type)?.value
  if (value('weekday') !== 'Sun' || Number(value('hour')) !== 18) {
    return NextResponse.json({ ok: true, sent: false, reason: 'outside Sunday 18:00 firm time' })
  }

  const to = new Date()
  const from = new Date(to.getTime() - 7 * 86_400_000)
  const admin = getAdminClient()
  const [appointmentsResult, stagesResult, tasks] = await Promise.all([
    admin.from('appointments').select('status, linked_matter_id').gte('start_time', from.toISOString()).lt('start_time', to.toISOString()),
    admin.from('matter_activity').select('matter_id').eq('event_type', 'stage_changed').gte('created_at', from.toISOString()),
    // What slipped is by definition already due, so read the due window
    // rather than an arbitrary 500 of every open task.
    fetchDueTasks(to.toISOString()),
  ])
  const appointments = appointmentsResult.data ?? []
  const slipped = tasks.filter(task => taskDueGroup(task) === 'overdue').slice(0, 8)
  const summary = {
    meetings: appointments.filter(row => row.status === 'scheduled').length,
    noShows: appointments.filter(row => row.status === 'no_show').length,
    advanced: new Set((stagesResult.data ?? []).map(row => row.matter_id)).size,
  }
  const result = await sendEmail({
    category: 'daily_digest',
    to: ADMIN_EMAIL,
    subject: `Calendar week in review: ${summary.meetings} meetings, ${summary.advanced} matters advanced`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <h2 style="margin:0 0 12px">Last week in review</h2>
      <ul>
        <li>${summary.meetings} meetings held</li>
        <li>${summary.noShows} no-shows</li>
        <li>${summary.advanced} matters advanced</li>
      </ul>
      ${slipped.length ? `<h3>What slipped</h3><ul>${slipped.map(task => `<li>${task.title}</li>`).join('')}</ul>` : '<p>Nothing slipped.</p>'}
      <p><a href="${appUrl('/admin/calendar')}" style="color:#1a6b72">Open calendar plan →</a></p>
    </div>`,
  })
  return NextResponse.json({ ok: result.ok, sent: result.ok, summary })
}

export async function GET(req: Request) {
  return runSystemAutomation('calendar-week-review', req, () => handle(req), { leaseSeconds: 120 })
}
