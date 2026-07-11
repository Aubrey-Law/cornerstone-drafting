import { NextResponse } from 'next/server'
import { fetchTodayData } from '@/lib/queries/today'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { ADMIN_EMAIL } from '@/lib/supabaseAdmin'
import { appUrl } from '@/lib/urls'

export const dynamic = 'force-dynamic'

// GET /api/cron/daily-digest — morning summary of the Today queue, emailed to
// the attorney. Invoked by the Vercel cron in vercel.json; Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = await fetchTodayData()
  const items = [
    { count: today.atRisk.length, label: 'matter(s) overdue or at risk' },
    { count: today.unreadThreads.length, label: 'client message thread(s) unread' },
    { count: today.intakeReview.length, label: 'intake(s) ready for review' },
    { count: today.intakeToSend.length, label: 'matter(s) still need their intake sent' },
    { count: today.unassignedCallCount, label: 'call(s) not linked to a matter' },
  ].filter(item => item.count > 0)

  // Quiet day → no email. The digest only speaks when something needs the attorney.
  if (items.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'nothing waiting' })
  }

  const firm = getFirmConfig()
  const detailRows = [
    ...today.atRisk.slice(0, 5).map(row =>
      `<li><strong>${row.client_name ?? 'Unnamed matter'}</strong> — ${row.days_in_stage} days in ${row.current_stage.replace(/_/g, ' ')} (${row.health})</li>`),
    ...today.unreadThreads.slice(0, 5).map(thread =>
      `<li><strong>${thread.client_name ?? 'Unnamed matter'}</strong> — ${thread.unread_count} unread message${thread.unread_count === 1 ? '' : 's'}</li>`),
    ...today.intakeReview.slice(0, 5).map(m =>
      `<li><strong>${m.client_name ?? m.matter_name ?? 'Unnamed matter'}</strong> — intake submitted, ready to review</li>`),
  ].join('')

  const result = await sendEmail({
    category: 'daily_digest',
    to: ADMIN_EMAIL,
    subject: `Today at ${firm.firmName}: ${items.map(i => `${i.count} ${i.label}`).join(', ')}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <h2 style="margin:0 0 12px">Your day at a glance</h2>
      <ul>${items.map(i => `<li>${i.count} ${i.label}</li>`).join('')}</ul>
      ${detailRows ? `<h3 style="margin:16px 0 8px;font-size:14px">Top items</h3><ul>${detailRows}</ul>` : ''}
      <p><a href="${appUrl('/admin')}" style="color:#1a6b72">Open your Today page →</a></p>
    </div>`,
  })

  return NextResponse.json({ ok: result.ok, sent: result.ok, items })
}
