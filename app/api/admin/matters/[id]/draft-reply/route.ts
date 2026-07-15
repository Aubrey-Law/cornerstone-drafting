import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { logAiUsage } from '@/lib/aiUsage'
import { getAnthropicClient } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { loadMatterContext } from '@/lib/adminChat/engine'

export const maxDuration = 60

type Channel = 'portal' | 'sms' | 'email'

const CHANNEL_RULES: Record<Channel, string> = {
  portal:
    'Draft a client portal message. Friendly and plain-language, at most two short paragraphs, no subject line, no signature block (the portal shows the sender).',
  sms:
    'Draft a text message to the client. At most 300 characters, plain language, no greeting fluff, no links unless essential.',
  email:
    'Draft a plain-text email to the client. Start with the subject on its own first line formatted exactly as "Subject: ...", then a blank line, then the body: warm plain language, short paragraphs, one clear call to action, signed off as Scott.',
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: matterId } = await params

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
  const channel = body.channel as Channel
  if (!['portal', 'sms', 'email'].includes(channel)) {
    return NextResponse.json({ error: 'channel must be portal, sms, or email' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  const startedAt = Date.now()
  const model = await resolveFirmModel('assistant')
  let usageModel = model
  try {
    const context = await loadMatterContext(matterId)
    const anthropic = await getAnthropicClient()

    const instruction = [
      CHANNEL_RULES[channel],
      'Base the message on the matter context: pick the most useful follow-up for where this matter stands (missing intake, drafts ready for review, scheduling a signing, general check-in).',
      notes ? `The attorney says the message should cover: ${notes}` : '',
      'Do not invent facts, dates, fees, or legal conclusions. Mark anything the attorney must verify as [CONFIRM: ...]. Output only the message text — no commentary before or after.',
    ].filter(Boolean).join('\n')

    const response = await anthropic.messages.create({
      model,
      max_tokens: 700,
      system: [{ type: 'text' as const, text: context.systemPrompt, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user', content: instruction }],
    })
    if (response.model) usageModel = response.model

    const draft = response.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    void logAiUsage({
      route: 'admin/draft-reply',
      contextType: 'matter',
      matterId,
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
      contextType: 'matter',
      matterId,
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
