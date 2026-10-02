import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmDateKey } from '@/lib/firmDate'
import { applySlaAnchor, applySlaGates } from '@/lib/slaTasks/generate'
import { syncEngagementSignedDetails } from '@/lib/engagement/signedDate'
import { isDateKey } from '@/lib/slaTasks/schedule'
import type { SlaClockAnchor } from '@/lib/slaTasks/types'

type Params = { params: Promise<{ id: string }> }

/**
 * The dates the pre-engagement clock hangs off, plus the fit decision that gates
 * everything after the discovery call.
 *
 * `anchor` names the clock a field feeds, so setting it can re-date the tasks
 * waiting on it. `recommendations_sent_at` has no anchor: it drives the
 * post-recommendation nudge policy, not any task's offsets.
 */
const ANCHOR_FIELDS = {
  discoveryCallAt: { column: 'discovery_call_at', anchor: 'discovery_call' as SlaClockAnchor },
  pmpsAt: { column: 'pmps_at', anchor: 'pmps' as SlaClockAnchor },
  engagementSignedAt: { column: 'engagement_signed_at', anchor: 'engagement' as SlaClockAnchor },
  recommendationsSentAt: { column: 'recommendations_sent_at', anchor: null },
} as const

type AnchorField = keyof typeof ANCHOR_FIELDS

const FIT_DECISIONS = ['fit', 'not_a_fit'] as const

/**
 * PATCH /api/admin/matters/[id]/sla-anchors
 *
 * Body: any of discoveryCallAt | pmpsAt | engagementSignedAt | recommendationsSentAt
 * as a YYYY-MM-DD string or null, and/or fitDecision as fit | not_a_fit | null.
 *
 * Setting a date does two things: it records what happened, and it dates the
 * tasks that were waiting on it. Those are one action from the user's side, so
 * they are one request — a date saved without replaying its anchor would leave
 * the plan looking unchanged and the clock still stopped.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const { id: rawId } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 })

  const patch: Record<string, string | null> = {}
  const anchorsToApply: { anchor: SlaClockAnchor; date: string }[] = []

  for (const [key, config] of Object.entries(ANCHOR_FIELDS) as [
    AnchorField,
    (typeof ANCHOR_FIELDS)[AnchorField],
  ][]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    const raw = body[key]
    if (raw === null || raw === '') {
      patch[config.column] = null
      continue
    }
    if (typeof raw !== 'string' || !isDateKey(raw)) {
      return NextResponse.json({ error: `${key} must be a date (YYYY-MM-DD) or null` }, { status: 400 })
    }
    // Stored as a timestamp; midday keeps the firm-timezone formatter from
    // rolling a bare calendar day back to the day before.
    patch[config.column] = `${raw}T12:00:00Z`
    if (config.anchor) anchorsToApply.push({ anchor: config.anchor, date: raw })
  }

  if (Object.prototype.hasOwnProperty.call(body, 'fitDecision')) {
    const fit = body.fitDecision
    if (fit === null || fit === '') {
      patch.fit_decision = null
      patch.fit_decided_at = null
    } else if (typeof fit === 'string' && (FIT_DECISIONS as readonly string[]).includes(fit)) {
      patch.fit_decision = fit
      patch.fit_decided_at = new Date().toISOString()
    } else {
      return NextResponse.json({ error: 'fitDecision must be fit, not_a_fit or null' }, { status: 400 })
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    // Leads included: the discovery call and the PMPS are pre-engagement dates
    // by definition, recorded against an opportunity's matters row long before
    // anything is hired. Resolving hired-only answered "Matter not found" to
    // every attempt to set one from the lead page.
    const matterId = await resolveMatterId(rawId, admin, { includeLeads: true }).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!matterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    const { data: existing, error: readError } = await admin
      .from('matters')
      .select('id')
      .eq('id', matterId)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    if (!existing) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    const { error: updateError } = await admin.from('matters').update(patch).eq('id', matterId)
    if (updateError) throw new Error(updateError.message)

    // The engagement date is not only a clock: it is the matter's engagement
    // status and the lead's copy of it. Syncing only the clock would leave the
    // Dates panel blank after an attorney recorded the date here.
    if (Object.prototype.hasOwnProperty.call(patch, 'engagement_signed_at')) {
      const { error: detailsError } = await syncEngagementSignedDetails(
        admin,
        matterId,
        patch.engagement_signed_at,
      )
      if (detailsError) throw new Error(detailsError)
    }

    let rescheduled = 0
    for (const { anchor, date } of anchorsToApply) {
      const result = await applySlaAnchor(admin, matterId, anchor, date)
      if (!result.ok) {
        console.warn('[sla-anchors] reschedule skipped', matterId, anchor, result.error)
        continue
      }
      rescheduled += result.updated
    }

    // The fit decision is a gate, not a date: opening it schedules the
    // post-discovery sequence from the dates already set, and closing it takes
    // those dates back off. Without this the choice was saved and nothing on
    // the plan moved.
    if (Object.prototype.hasOwnProperty.call(patch, 'fit_decision')) {
      const result = await applySlaGates(admin, matterId)
      if (result.ok) rescheduled += result.updated
      else console.warn('[sla-anchors] gate reschedule skipped', matterId, result.error)
    }

    const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null
    await admin.from('matter_activity').insert({
      matter_id: matterId,
      event_type: 'sla_anchor_set',
      title: 'Key dates updated',
      detail:
        rescheduled > 0
          ? `${rescheduled} task${rescheduled === 1 ? '' : 's'} rescheduled`
          : 'No tasks needed rescheduling',
      metadata: { ...patch, rescheduled },
      actor_id: userId,
      actor_email: user?.email ?? null,
      actor_name: actorName,
    })

    const { data: fresh } = await admin
      .from('matters')
      .select('discovery_call_at, pmps_at, recommendations_sent_at, engagement_signed_at, fit_decision')
      .eq('id', matterId)
      .maybeSingle()

    return NextResponse.json({
      matterId,
      rescheduled,
      anchors: {
        discoveryCallAt: firmDateKey(fresh?.discovery_call_at ?? null),
        pmpsAt: firmDateKey(fresh?.pmps_at ?? null),
        recommendationsSentAt: firmDateKey(fresh?.recommendations_sent_at ?? null),
        engagementSignedAt: firmDateKey(fresh?.engagement_signed_at ?? null),
        fitDecision: fresh?.fit_decision ?? null,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not update the key dates' },
      { status: 500 },
    )
  }
}
