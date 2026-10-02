import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { appUrl } from '@/lib/urls'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { DEFAULT_WORK_PREFERENCES } from '@/lib/work/types'
import { fetchDailyPlan } from '@/lib/work/plans'
import { buildMorningBrief } from '@/lib/work/morningBrief'
import { firmTodayKey } from '@/lib/firmDate'
import { runSystemAutomation } from '@/lib/automations/control'

export const dynamic = 'force-dynamic'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

// GET /api/cron/daily-digest — a deterministic summary of the same canonical
// work graph as Today. It does not ask an LLM to select or reorder obligations.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: digestRecipient } = await getAdminClient().from('users')
    .select('id').eq('email', ADMIN_EMAIL).in('role', ['admin', 'attorney']).maybeSingle()
  const actorId = digestRecipient?.id ?? null
  const [graph, preferences, stored] = await Promise.all([
    fetchWorkGraphForUser(actorId),
    actorId ? fetchWorkPreferences(actorId) : Promise.resolve(DEFAULT_WORK_PREFERENCES),
    actorId ? fetchDailyPlan(actorId, firmTodayKey()) : Promise.resolve(null),
  ])
  const plan = createDailyPlanPreview({
    items: graph.items,
    appointments: graph.appointments,
    preferences,
  })
  const brief = buildMorningBrief(plan, stored)
  const actionable = [...brief.mustDo, ...brief.communication, ...brief.suggested]
  if (actionable.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'nothing waiting' })
  }

  const firm = getFirmConfig()
  const headline = [
    brief.mustDo.length ? `${brief.mustDo.length} must do` : null,
    brief.communication.length ? `${brief.communication.length} repl${brief.communication.length === 1 ? 'y' : 'ies'}` : null,
    plan.overload ? `${plan.overloadMinutes} minutes over capacity` : null,
  ].filter(Boolean).join(', ')
  const detailRows = actionable.slice(0, 8).map(item => {
    const reasons = item.priorityReasons.slice(0, 2).map(reason => reason.label).join(' · ')
    return `<li><strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(item.record.name)}${reasons ? ` (${escapeHtml(reasons)})` : ''}</li>`
  }).join('')
  const result = await sendEmail({
    category: 'daily_digest',
    to: ADMIN_EMAIL,
    subject: `Today at ${firm.firmName}: ${headline || `${actionable.length} items`}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <h2 style="margin:0 0 12px">Your deterministic daily plan</h2>
      <p>${brief.usesCommittedAgenda ? 'Using your committed agenda.' : 'Using your current draft plan.'}</p>
      <p><strong>${escapeHtml(headline || `${actionable.length} actionable items`)}</strong></p>
      ${brief.now ? `<p><strong>Start with:</strong> ${escapeHtml(brief.now.title)} — ${escapeHtml(brief.now.record.name)}</p>` : ''}
      ${plan.overload ? `<p style="color:#991b1b">Critical work exceeds available capacity. Defer, delegate, or reschedule specific work in Today.</p>` : ''}
      <h3 style="margin:16px 0 8px;font-size:14px">Top items</h3><ol>${detailRows}</ol>
      ${graph.sourceErrors.length ? `<p>Some sources need a refresh: ${escapeHtml(graph.sourceErrors.join(', '))}.</p>` : ''}
      <p><a href="${appUrl('/admin')}" style="color:#1a6b72">Open the Daily Command Center →</a></p>
    </div>`,
  })

  return NextResponse.json({
    ok: result.ok,
    sent: result.ok,
    mustDo: brief.mustDo.length,
    communication: brief.communication.length,
    overload: plan.overload,
  })
}

export async function GET(req: Request) {
  return runSystemAutomation('daily-digest', req, () => handle(req), { leaseSeconds: 180 })
}
