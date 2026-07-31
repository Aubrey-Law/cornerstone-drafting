import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { logAiUsage } from '@/lib/aiUsage'
import { getAnthropicClient } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { loadLeadContext } from '@/lib/adminChat/engine'
import { MAX_LEAD_SMS_BODY_LENGTH } from '@/lib/sms/constants'

type Channel = 'sms' | 'email'

const CHANNEL_RULES: Record<Channel, string> = {
  sms:
    'Draft a concise text message to this lead. At most 300 characters, plain text only, no markdown, no links unless essential, and no emojis.',
  email:
    'Draft a plain-text email to this lead. Start with the subject on its own first line formatted exactly as "Subject: ...", then a blank line, then the body. Keep the tone warm and concise, one clear call to action, and signed off as Scott.',
}

function normalizeEmailDraft(draft: string) {
  const raw = draft.trim()
  if (!raw) return 'Subject: Follow-up\n\n'

  const lines = raw.split(/\r?\n/)
  if (!/^Subject:/i.test(lines[0] ?? '')) {
    return `Subject: Follow-up\n\n${raw}`
  }

  const subject = lines[0].replace(/^Subject:\s*/i, '').trim() || 'Follow-up'
  const body = lines.slice(1).join('\n').replace(/^\n+/, '')
  return `Subject: ${subject}\n\n${body.trimStart()}`
}

function normalizeSmsDraft(draft: string) {
  return draft.trim().slice(0, MAX_LEAD_SMS_BODY_LENGTH)
}

export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params
  const rl = await consumeRateLimit(
    { bucket: 'admin_draft_reply', limit: 30, windowSeconds: 600 },
    auth.userId,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await req.json().catch(() => ({})) as { channel?: unknown; notes?: unknown }
  const channel = body.channel
  if (channel !== 'sms' && channel !== 'email') {
    return NextResponse.json({ error: 'channel must be email or sms' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  const startedAt = Date.now()
  const model = await resolveFirmModel('assistant')
  let usageModel = model

  try {
    const context = await loadLeadContext(leadId)
    const anthropic = await getAnthropicClient()

    const instruction = [
      CHANNEL_RULES[channel],
      'Base the message on the lead context: pick the most useful follow-up for where this lead stands (intake status, recent notes, documents, engagement stage).',
      notes ? `The attorney wants this message to cover: ${notes}` : '',
      'Do not invent facts, dates, fees, or legal conclusions. Mark anything the attorney must verify as [CONFIRM: ...]. Output only the message text — no commentary before or after.',
    ].filter(Boolean).join('\n')

    const response = await anthropic.messages.create({
      model,
      max_tokens: 700,
      system: [{
        type: 'text' as const,
        text: context.systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      }],
      messages: [{ role: 'user', content: instruction }],
    })
    if (response.model) usageModel = response.model

    const drafted = response.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    const draft = channel === 'sms' ? normalizeSmsDraft(drafted) : normalizeEmailDraft(drafted)

    void logAiUsage({
      route: 'admin/draft-reply',
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

    return NextResponse.json({ draft })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    void logAiUsage({
      route: 'admin/draft-reply',
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
    return NextResponse.json({ error: `Unable to draft: ${detail}` }, { status: 500 })
  }
}
