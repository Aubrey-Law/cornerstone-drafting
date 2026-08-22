import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { logAiUsage } from '@/lib/aiUsage'
import { getAnthropicClient } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { loadLeadContext } from '@/lib/adminChat/engine'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  computeLeadScore,
  leadScoreInputFromRow,
  scoringAppointmentAt,
  type LeadScore,
} from '@/lib/leads/score'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

/**
 * The AI half of hybrid lead scoring. The rule-based score is the number the UI
 * trusts; this endpoint asks Claude whether that number reads high or low given
 * everything the rules cannot see — the notes, the meeting history, the tone of
 * the last exchange — and returns a suggestion with its reasoning.
 *
 * The suggestion is advisory and is not persisted. The deterministic score stays
 * the sortable one, so an unavailable or wrong model degrades the page to
 * exactly what it showed before the button was pressed.
 */

export const maxDuration = 60

type ScoreInsight = {
  adjustedScore: number
  direction: 'raise' | 'lower' | 'confirm'
  rationale: string
  factors: string[]
}

function parseInsight(raw: string): ScoreInsight | null {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const value = parsed as Record<string, unknown>
  const score = Number(value.adjustedScore)
  if (!Number.isFinite(score)) return null

  const direction = value.direction
  if (direction !== 'raise' && direction !== 'lower' && direction !== 'confirm') return null

  return {
    adjustedScore: Math.min(100, Math.max(0, Math.round(score))),
    direction,
    rationale: typeof value.rationale === 'string' ? value.rationale.trim() : '',
    factors: Array.isArray(value.factors)
      ? value.factors.filter((factor): factor is string => typeof factor === 'string').slice(0, 6)
      : [],
  }
}

/** The deterministic score, recomputed here so the model never sets its own baseline. */
async function loadBaseScore(leadId: string): Promise<LeadScore> {
  const admin = getAdminClient()
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('*')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`client_intake: ${error.message}`)
  if (!lead) throw new Error('Lead not found')

  const matterId = (lead as { matter_id?: string | null }).matter_id ?? null
  let nextAppointmentAt: string | null = null
  if (matterId) {
    const { data: matter } = await admin
      .from('matters')
      .select('discovery_call_at, pmps_at')
      .eq('id', matterId)
      .maybeSingle()
    nextAppointmentAt = scoringAppointmentAt(matter?.discovery_call_at, matter?.pmps_at)
  }

  const { data: activity } = await admin
    .from('lead_activity')
    .select('created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)

  return computeLeadScore(leadScoreInputFromRow(lead as LeadDetailRecord, {
    lastTouchAt: activity?.[0]?.created_at ?? null,
    nextAppointmentAt,
  }))
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params
  const rl = await consumeRateLimit(
    { bucket: 'admin_score_insight', limit: 20, windowSeconds: 600 },
    auth.userId,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const startedAt = Date.now()
  const model = await resolveFirmModel('assistant')
  let usageModel = model

  try {
    const [baseScore, context] = await Promise.all([
      loadBaseScore(leadId),
      loadLeadContext(leadId),
    ])
    const anthropic = await getAnthropicClient()

    const breakdown = baseScore.components
      .map(component => `- ${component.label}: ${component.points}/${component.max} (${component.reason})`)
      .join('\n')

    const instruction = [
      'You are assessing how likely this estate-planning lead is to hire the firm.',
      `A rule-based model scored this lead ${baseScore.score}/100 (band: ${baseScore.band}) from these components:`,
      breakdown,
      'The rules can only see structured fields. Using the lead context above — the notes, meeting history, and recent activity — judge whether that score overstates or understates this lead.',
      'Weigh what the rules miss: stated intent and timelines, responsiveness, life events forcing a deadline, competing counsel, or signals the lead has gone quiet for a reason.',
      'Do not invent facts, dates, fees, or legal conclusions. If the context is too thin to justify a change, return direction "confirm".',
      'Reply with strict JSON and nothing else, in this exact shape:',
      '{"adjustedScore": <integer 0-100>, "direction": "raise" | "lower" | "confirm", "rationale": "<2-3 sentences>", "factors": ["<short phrase>", ...]}',
    ].join('\n')

    const response = await anthropic.messages.create({
      model,
      max_tokens: 500,
      system: [{
        type: 'text' as const,
        text: context.systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      }],
      messages: [{ role: 'user', content: instruction }],
    })
    if (response.model) usageModel = response.model

    const raw = response.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    void logAiUsage({
      route: 'admin/score-insight',
      contextType: 'lead',
      matterId: leadId,
      userId: auth.userId,
      model: usageModel,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - startedAt,
      success: true,
    })

    const insight = parseInsight(raw)
    if (!insight) {
      return NextResponse.json(
        { error: 'The model did not return a usable assessment.', detail: raw.slice(0, 500) },
        { status: 502 },
      )
    }

    return NextResponse.json({ baseScore, insight })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    void logAiUsage({
      route: 'admin/score-insight',
      contextType: 'lead',
      matterId: leadId,
      userId: auth.userId,
      model: usageModel,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: detail,
    })
    return NextResponse.json({ error: `Unable to assess this lead: ${detail}` }, { status: 500 })
  }
}
