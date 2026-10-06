import 'server-only'

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getFirmConfig } from '@/lib/firmConfig'
import { progressFromMatterDetails } from '@/lib/portal/progress'
import {
  coercePlanStatusDraft,
  describePlanStatus,
  isMatterStage,
  PLAN_STATUS_SYSTEM_PROMPT,
  type PlanStatusFacts,
} from '@/lib/portal/planStatus'
import { stageLabel, type MatterStage } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * Assembling the facts behind "where is my plan", drafting the update, and
 * publishing it. Every read is tolerant: a source that fails leaves its part
 * of the facts empty rather than taking the answer down.
 */

export interface PlanStatusMatter {
  id: string
  stage: MatterStage
  status: string | null
}

export async function loadPlanStatusFacts(matterId: string): Promise<{ matter: PlanStatusMatter; facts: PlanStatusFacts } | null> {
  const admin = getAdminClient()
  const { data: matter, error } = await admin
    .from('matters')
    .select('id, stage, status')
    .eq('id', matterId)
    .maybeSingle()
  if (error || !matter || !isMatterStage(matter.stage)) return null
  const stage = matter.stage

  const settled = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await promise
    } catch {
      return fallback
    }
  }

  const [details, lifecycle, funding, appointment, stageChangedAt] = await Promise.all([
    settled((async () => {
      const { data } = await admin.from('matter_details')
        .select('practice_area,intake_date,draft_sent_date,drafts_approved_date,execution_date,signing_date,pb_pr_appointment_date,pb_inventory_filed_date,pb_final_distribution_date,pb_estate_closed,pb_estate_closed_date')
        .eq('client_id', matterId).maybeSingle()
      return (data as MatterDetailsRow | null) ?? null
    })(), null),
    settled((async () => {
      const { loadMatterLifecycleContext } = await import('@/lib/lifecycle/server')
      const { matterOperationalBrief } = await import('@/lib/lifecycle/matter')
      const context = await loadMatterLifecycleContext(matterId)
      if (!context) return [] as string[]
      return matterOperationalBrief(context.matter, context.engagement, context.reviewFlags).clientFollowUp
    })(), [] as string[]),
    settled((async () => {
      const { loadFundingRows } = await import('@/lib/funding/repository')
      const { toFundingAssets } = await import('@/lib/funding/rollup')
      const { fundingSummary } = await import('@/lib/funding/model')
      const rows = await loadFundingRows(admin as unknown as Parameters<typeof loadFundingRows>[0], { matterId })
      if (rows.length === 0) return null
      const summary = fundingSummary(toFundingAssets(rows))
      return { total: summary.total, funded: summary.fundedCount, outstanding: summary.unfundedCount }
    })(), null),
    settled((async () => {
      const { fetchNextAppointment } = await import('@/lib/queries/portal')
      const next = await fetchNextAppointment(matterId)
      return next ? { startsAt: next.startTime, typeLabel: next.typeLabel } : null
    })(), null),
    settled((async () => {
      const { data } = await admin.from('matter_stage_history')
        .select('changed_at')
        .eq('matter_id', matterId)
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return typeof data?.changed_at === 'string' ? data.changed_at : null
    })(), null),
  ])

  const progress = progressFromMatterDetails(details)
  const firm = getFirmConfig()
  return {
    matter: { id: matter.id, stage, status: (matter.status as string | null) ?? null },
    facts: {
      stage,
      stageLabel: stageLabel(stage),
      track: progress.heading === 'Your probate matter' ? 'probate' : progress.heading === 'Your estate plan' ? 'estate-planning' : 'other',
      milestones: progress.milestones.map(m => ({ key: m.key, label: m.label, state: m.state })),
      nextAppointment: appointment,
      funding,
      clientFollowUp: lifecycle,
      stageChangedAt,
      firmName: firm.firmName,
      attorneyShortName: firm.attorneyShortName,
    },
  }
}

/**
 * The update as the light model would write it, held to the plain draft's
 * facts; the plain draft itself when the model is unavailable or strays.
 */
export async function draftPlanStatus(input: { facts: PlanStatusFacts; matterId: string; actorId: string }): Promise<{ body: string; model: string | null }> {
  const plain = describePlanStatus(input.facts)
  try {
    const { callAnthropic } = await import('@/lib/anthropic')
    const { resolveFirmModel } = await import('@/lib/firmModels')
    const model = await resolveFirmModel('light')
    const message = await callAnthropic({
      model,
      max_tokens: 600,
      system: PLAN_STATUS_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          `Firm: ${input.facts.firmName}. Stage: ${input.facts.stageLabel}.`,
          `Facts: ${JSON.stringify({
            milestones: input.facts.milestones,
            nextAppointment: input.facts.nextAppointment,
            funding: input.facts.funding,
            clientFollowUp: input.facts.clientFollowUp,
          })}`,
          `Plain draft: ${plain}`,
          'Return only the JSON object.',
        ].join('\n\n'),
      }],
    }, { route: 'portal/plan-status', matterId: input.matterId, userId: input.actorId, contextType: 'matter' })
    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text).join('').trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return { body: plain, model: null }
    return { body: coercePlanStatusDraft(JSON.parse(raw.slice(start, end + 1)), plain), model }
  } catch (error) {
    console.error('[portal] plan status draft failed; using the plain draft', { matterId: input.matterId, cause: error instanceof Error ? error.message : String(error) })
    return { body: plain, model: null }
  }
}

export interface PublishedPlanStatus {
  id: string
  stage: MatterStage | null
  body: string
  publishedAt: string
}

function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

/** The newest update the client was given, or null; a missing table reads as none. */
export async function fetchLatestPlanStatus(matterId: string, client: SupabaseClient = getAdminClient()): Promise<PublishedPlanStatus | null> {
  const { data, error } = await client
    .from('matter_status_updates')
    .select('id, stage, body, published_at')
    .eq('matter_id', matterId)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  if (!data) return null
  return {
    id: String(data.id),
    stage: isMatterStage(data.stage) ? data.stage : null,
    body: String(data.body),
    publishedAt: String(data.published_at),
  }
}

/**
 * Publish an approved update: a row on the record and a message in the
 * client's portal conversation, which emails the client the usual notice.
 */
export async function publishPlanStatus(
  input: { matterId: string; stage: MatterStage; body: string; facts: Record<string, unknown>; actorId: string; source: 'automation' | 'staff' },
  client: SupabaseClient = getAdminClient(),
): Promise<{ updateId: string; messageId: string | null }> {
  const { data: message, error: messageError } = await client
    .from('messages')
    .insert({ matter_id: input.matterId, sender_role: 'attorney', sender_id: input.actorId, body: input.body })
    .select('id')
    .single()
  if (messageError) throw new Error(messageError.message)
  const messageId = message ? String(message.id) : null

  const { data, error } = await client
    .from('matter_status_updates')
    .insert({
      matter_id: input.matterId,
      stage: input.stage,
      body: input.body,
      facts: input.facts,
      source: input.source,
      message_id: messageId,
      published_by: input.actorId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  try {
    const { notifyClientOfFirmMessage } = await import('@/lib/portalNotifications')
    await notifyClientOfFirmMessage(input.matterId)
  } catch (caught) {
    console.error('[portal] plan status notice failed', { matterId: input.matterId, cause: caught instanceof Error ? caught.message : String(caught) })
  }
  return { updateId: String(data.id), messageId }
}
