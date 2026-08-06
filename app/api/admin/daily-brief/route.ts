import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { logAiUsage } from '@/lib/aiUsage'
import { getAnthropicClient } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { getFirmConfig } from '@/lib/firmConfig'
import { fetchTodayData } from '@/lib/queries/today'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import { stageLabel, type MatterStage } from '@/types/database'

export const maxDuration = 60

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await consumeRateLimit(
    { bucket: 'admin_daily_brief', limit: 10, windowSeconds: 600 },
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
    const today = await fetchTodayData()
    const firm = getFirmConfig()

    const facts = [
      `Active matters: ${today.activeMatterCount}`,
      `Overdue / at-risk (worst first): ${today.atRisk.slice(0, 8).map(row =>
        `${row.client_name ?? 'Unnamed'} (${engineStageLabel(row.current_stage)}, ${row.days_over_sla && row.days_over_sla > 0 ? `${row.days_over_sla}d over SLA` : `${row.days_in_stage}d in stage`}, ball in ${row.owner === 'client' ? 'client' : 'attorney'} court) [link: ${row.entity === 'lead' ? `/admin/crm/opportunities/${row.id}` : `/admin/matters/${row.id}`}]`,
      ).join('; ') || 'none'}`,
      `Unread client messages: ${today.unreadThreads.map(thread =>
        `${thread.client_name ?? 'Unnamed'} (${thread.unread_count}) [link: /admin/matters/${thread.matter_id}?tab=communications]`,
      ).join('; ') || 'none'}`,
      `Intakes ready for review: ${today.intakeReview.map(matter =>
        `${matter.client_name ?? matter.matter_name ?? 'Unnamed'} (${stageLabel(matter.stage as MatterStage)}) [link: /admin/drafting/${matter.matter_id}]`,
      ).join('; ') || 'none'}`,
      `Intakes still to send: ${today.intakeToSend.map(matter =>
        `${matter.client_name ?? matter.matter_name ?? 'Unnamed'} [link: /admin/matters/${matter.matter_id}]`,
      ).join('; ') || 'none'}`,
    ].join('\n')

    const anthropic = await getAnthropicClient()
    const response = await anthropic.messages.create({
      model,
      max_tokens: 600,
      system:
        `You are the practice assistant for ${firm.attorneyShortName}, a solo Massachusetts estate planning attorney at ${firm.firmName}. ` +
        'Write a short daily briefing in Markdown from the pipeline facts provided. Rules: 3-6 bullet points max, most urgent first; each bullet is one concrete action with the client name as a Markdown link using the [link: ...] path provided; plain confident language; no preamble, no headings, no sign-off. If nothing needs attention, say so in one friendly line and suggest one proactive step.',
      messages: [{ role: 'user', content: `Today's pipeline facts:\n${facts}` }],
    })
    if (response.model) usageModel = response.model

    const brief = response.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    void logAiUsage({
      route: 'admin/daily-brief',
      contextType: 'general',
      userId: auth.userId,
      model: usageModel,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - startedAt,
      success: true,
    })

    return NextResponse.json({ brief })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    void logAiUsage({
      route: 'admin/daily-brief',
      contextType: 'general',
      userId: auth.userId,
      model: usageModel,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: detail,
    })
    return NextResponse.json({ error: `Unable to generate briefing: ${detail}` }, { status: 500 })
  }
}
