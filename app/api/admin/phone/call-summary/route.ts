import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { callAnthropic, PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Body {
  direction?: 'inbound' | 'outbound'
  durationSeconds?: number
  participantName?: string
  outcome?: string
  notes?: string
  matterId?: string | null
  leadId?: string | null
  /** Open items from the call briefing, so the summary can reference them. */
  openItems?: string[]
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

/**
 * POST /api/admin/phone/call-summary
 *
 * Drafts the wrap-up note for a finished call. The softphone shows the wrap-up
 * form immediately and fills the textarea when this returns — a failure here
 * degrades to an empty textarea, never a blocked save.
 */
export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const rl = await consumeRateLimit(
    { bucket: 'admin_call_summary', limit: 30, windowSeconds: 600 },
    userId ?? 'anon',
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const direction = body.direction === 'inbound' ? 'inbound' : 'outbound'
  const durationSeconds =
    typeof body.durationSeconds === 'number' && body.durationSeconds >= 0
      ? Math.round(body.durationSeconds)
      : 0
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const openItems = Array.isArray(body.openItems)
    ? body.openItems.filter((item): item is string => typeof item === 'string').slice(0, 6)
    : []

  const facts = [
    `Direction: ${direction}`,
    `Duration: ${formatDuration(durationSeconds)}`,
    body.participantName ? `Other party: ${body.participantName}` : null,
    body.outcome ? `Outcome: ${body.outcome}` : null,
    openItems.length ? `Open items on this record before the call: ${openItems.join('; ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const response = await callAnthropic(
      {
        model: await resolveFirmModel('assistant'),
        max_tokens: 400,
        system: `You write short call notes for a Massachusetts estate planning firm's matter file. Two to four sentences, past tense, plain language, no greeting or sign-off, no bullet list. Record only what the attorney's notes state — never infer what was discussed, never restate the open items as if they were covered, and never give legal advice. If the attorney left no notes, write a single factual line about the call itself. ${PROMPT_INJECTION_GUARDRAIL}`,
        messages: [
          {
            role: 'user',
            content: `${facts}\n${quoteUserContent('attorney_notes', notes)}`,
          },
        ],
      },
      {
        route: 'admin/phone/call-summary',
        userId,
        contextType: body.matterId ? 'matter' : 'lead',
        matterId: body.matterId ?? null,
      },
    )

    const draft = response.content
      .map(part => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()

    return NextResponse.json({ draft })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not draft the call summary' },
      { status: 502 },
    )
  }
}
