import { NextResponse } from 'next/server'
import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { firmTodayKey } from '@/lib/firmDate'
import { appUrl } from '@/lib/urls'
import { formatFirmDate } from '@/lib/format'
import { MATTER_TASK_COLUMNS, type MatterTaskRow, type SlaNudgeTier } from '@/lib/slaTasks/types'

export const dynamic = 'force-dynamic'

type Kind = 'nudge' | 'escalation'

interface Pending {
  task: MatterTaskRow
  kind: Kind
  tier: SlaNudgeTier
}

interface MatterContact {
  matter_name: string | null
  client_name: string | null
  client_email: string | null
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, ch =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  )
}

/** Gentle and firm go to the client; internal is the attorney reminding herself. */
function recipientFor(tier: SlaNudgeTier, contact: MatterContact): string | null {
  return tier === 'internal' ? ADMIN_EMAIL : contact.client_email
}

function subjectFor(pending: Pending, contact: MatterContact, firmName: string): string {
  const who = contact.client_name || contact.matter_name || 'your matter'
  if (pending.tier === 'internal') {
    return `${pending.kind === 'escalation' ? 'Escalation' : 'Reminder'}: ${pending.task.name} — ${who}`
  }
  if (pending.tier === 'firm') {
    return `Second reminder from ${firmName}: ${pending.task.name}`
  }
  return `A quick reminder from ${firmName}: ${pending.task.name}`
}

function bodyFor(pending: Pending, contact: MatterContact, firmName: string): string {
  const due = formatFirmDate(`${pending.task.due_date}T12:00:00Z`)
  const name = escapeHtml(contact.client_name || 'there')
  const taskName = escapeHtml(pending.task.name)

  if (pending.tier === 'internal') {
    return `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <p><strong>${taskName}</strong> is due ${due} on ${escapeHtml(
        contact.client_name || contact.matter_name || 'an open matter',
      )}.</p>
      <p><a href="${appUrl(`/admin/matters/${pending.task.matter_id}?tab=sla`)}" style="color:#1a6b72">Open the matter plan →</a></p>
    </div>`
  }

  const nudge =
    pending.tier === 'firm'
      ? `We still need this to keep your plan on schedule. Its target date was ${due}.`
      : `Just a friendly nudge — this one is due ${due}.`

  return `<div style="font-family:sans-serif;font-size:14px;color:#222">
    <p>Hi ${name},</p>
    <p>${nudge}</p>
    <p><strong>${taskName}</strong></p>
    <p>If you have already taken care of it, please disregard this note.</p>
    <p>— ${escapeHtml(firmName)}</p>
  </div>`
}

/**
 * GET /api/cron/sla-task-nudges — weekday-morning pass over `matter_tasks`.
 *
 * Sends every nudge whose date has landed and that has not been sent, then the
 * same for escalations, and stamps the row so it never fires twice. A task that
 * is completed, skipped or blocked is not chased. Vercel supplies
 * `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const today = firmTodayKey()

  const [nudges, escalations] = await Promise.all([
    admin
      .from('matter_tasks')
      .select(MATTER_TASK_COLUMNS)
      .in('status', ['pending', 'active'])
      .not('nudge_date', 'is', null)
      .lte('nudge_date', today)
      .is('nudge_sent_at', null),
    admin
      .from('matter_tasks')
      .select(MATTER_TASK_COLUMNS)
      .in('status', ['pending', 'active'])
      .not('escalation_date', 'is', null)
      .lte('escalation_date', today)
      .is('escalation_sent_at', null),
  ])

  if (nudges.error || escalations.error) {
    const message = nudges.error?.message ?? escalations.error?.message ?? 'query failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const pending: Pending[] = [
    ...((nudges.data ?? []) as unknown as MatterTaskRow[]).map(task => ({
      task,
      kind: 'nudge' as const,
      tier: (task.nudge_tier ?? 'gentle') as SlaNudgeTier,
    })),
    ...((escalations.data ?? []) as unknown as MatterTaskRow[]).map(task => ({
      task,
      kind: 'escalation' as const,
      tier: (task.escalation_tier ?? 'firm') as SlaNudgeTier,
    })),
  ]

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 })
  }

  const matterIds = [...new Set(pending.map(item => item.task.matter_id))]
  const { data: matterRows, error: matterError } = await admin
    .from('v_matter_pipeline')
    .select('matter_id, matter_name, client_name, client_email')
    .in('matter_id', matterIds)
  if (matterError) return NextResponse.json({ error: matterError.message }, { status: 500 })

  const contacts = new Map<string, MatterContact>()
  for (const row of matterRows ?? []) {
    contacts.set(row.matter_id as string, {
      matter_name: (row.matter_name as string | null) ?? null,
      client_name: ((row.client_name as string | null) || null),
      client_email: ((row.client_email as string | null) || null),
    })
  }

  const firmName = getFirmConfig().firmName
  let sent = 0
  const skipped: string[] = []

  for (const item of pending) {
    const contact = contacts.get(item.task.matter_id)
    if (!contact) {
      skipped.push(`${item.task.id}: matter archived or not hired`)
      continue
    }
    const to = recipientFor(item.tier, contact)
    if (!to) {
      skipped.push(`${item.task.id}: no ${item.tier === 'internal' ? 'firm' : 'client'} address`)
      continue
    }

    const result = await sendEmail({
      category: item.tier === 'internal' ? 'sla_task_internal_reminder' : 'sla_task_nudge',
      to,
      subject: subjectFor(item, contact, firmName),
      html: bodyFor(item, contact, firmName),
    })

    if (!result.ok) {
      skipped.push(`${item.task.id}: send failed`)
      continue
    }

    // Stamp only after a successful send, so a transient mail failure retries
    // on the next run instead of silently swallowing the nudge.
    const stamp =
      item.kind === 'nudge'
        ? { nudge_sent_at: new Date().toISOString() }
        : { escalation_sent_at: new Date().toISOString() }
    const { error } = await admin.from('matter_tasks').update(stamp).eq('id', item.task.id)
    if (error) {
      skipped.push(`${item.task.id}: sent but not stamped (${error.message})`)
      continue
    }
    sent += 1
  }

  return NextResponse.json({ ok: true, sent, skipped: skipped.length, details: skipped })
}
