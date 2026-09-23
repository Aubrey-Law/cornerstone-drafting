import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { logAiUsage } from '@/lib/aiUsage'
import { getAnthropicClient } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { loadLeadContext, loadMatterContext } from '@/lib/adminChat/engine'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MAX_LEAD_SMS_BODY_LENGTH } from '@/lib/sms/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Channel = 'sms' | 'email'

const CHANNEL_RULES: Record<Channel, string> = {
  sms:
    'Draft a concise text message to this contact. At most 300 characters, plain text only, no markdown, no links unless essential, and no emojis.',
  email:
    'Draft a plain-text email to this contact. Start with the subject on its own first line formatted exactly as "Subject: ...", then a blank line, then the body. Keep the tone warm and concise, one clear call to action, and signed off as Scott.',
}

function normalizeEmailDraft(draft: string) {
  const raw = draft.trim()
  if (!raw) return 'Subject: Follow-up\n\n'
  const lines = raw.split(/\r?\n/)
  if (!/^Subject:/i.test(lines[0] ?? '')) return `Subject: Follow-up\n\n${raw}`
  const subject = lines[0].replace(/^Subject:\s*/i, '').trim() || 'Follow-up'
  const body = lines.slice(1).join('\n').replace(/^\n+/, '')
  return `Subject: ${subject}\n\n${body.trimStart()}`
}

function personName(row: {
  first_name?: string | null
  last_name?: string | null
  preferred_name?: string | null
  full_name?: string | null
}): string {
  const full = row.full_name?.trim()
  if (full) return full
  return [row.preferred_name?.trim() || row.first_name?.trim(), row.last_name?.trim()]
    .filter(Boolean).join(' ').trim()
}

/**
 * A related person is drafted with their household's context — a trustee's
 * message should know what stage the matter is at — but addressed to them,
 * not to the client. A contact with no household gets their own thread only.
 */
async function loadContactSystemPrompt(contactId: string): Promise<string | null> {
  const admin = getAdminClient()
  const { data: contact } = await admin
    .from('contacts')
    .select('id, first_name, last_name, preferred_name, relationship_type, relationship_label, client_intake_id')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) return null

  const name = personName(contact) || 'this contact'
  const role = contact.relationship_label?.trim() || contact.relationship_type?.trim() || 'contact'

  let household = ''
  if (contact.client_intake_id) {
    const { data: intake } = await admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, matter_id')
      .eq('id', contact.client_intake_id)
      .maybeSingle()

    if (intake) {
      const { data: matter } = intake.matter_id
        ? await admin.from('matters').select('id, relationship_status').eq('id', intake.matter_id).maybeSingle()
        : { data: null }

      try {
        const context = (matter && (matter.relationship_status ?? 'hired') === 'hired')
          ? await loadMatterContext(matter.id)
          : await loadLeadContext(intake.id)
        household = context.systemPrompt
      } catch {
        // Context is an enhancement; drafting still works without it.
      }
    }
  }

  const { data: messages } = await admin
    .from('sms_messages')
    .select('direction, body, created_at')
    .eq('contact_id', contactId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(10)

  const thread = (messages ?? []).length
    ? ['Recent texts with this contact (newest first):',
       ...(messages ?? []).map(m =>
         `- ${m.direction === 'inbound' ? name : 'Firm'}: ${String(m.body ?? '').slice(0, 300)}`)]
        .join('\n')
    : 'No prior texts with this contact.'

  return [
    household,
    `You are writing to ${name}, the ${role} on this record — NOT to the client.`,
    'Address them by their own name and do not disclose more about the client\'s matter than their role requires.',
    thread,
  ].filter(Boolean).join('\n\n')
}

/**
 * POST /api/admin/contacts/[id]/draft-reply
 *
 * AI drafting for the contact composers, matching the lead and matter routes.
 * The draft always lands in the editor for review — never sent directly.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: contactId } = await params
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
    const systemPrompt = await loadContactSystemPrompt(contactId)
    if (!systemPrompt) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const anthropic = await getAnthropicClient()
    const instruction = [
      CHANNEL_RULES[channel as Channel],
      notes ? `The attorney wants this message to cover: ${notes}` : '',
      'Do not invent facts, dates, fees, or legal conclusions. Mark anything the attorney must verify as [CONFIRM: ...]. Output only the message text — no commentary before or after.',
    ].filter(Boolean).join('\n')

    const response = await anthropic.messages.create({
      model,
      max_tokens: 700,
      system: [{
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      }],
      messages: [{ role: 'user', content: instruction }],
    })
    if (response.model) usageModel = response.model

    const drafted = response.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    const draft = channel === 'sms'
      ? drafted.slice(0, MAX_LEAD_SMS_BODY_LENGTH)
      : normalizeEmailDraft(drafted)

    void logAiUsage({
      route: 'admin/draft-reply',
      contextType: 'contact',
      matterId: contactId,
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
      contextType: 'contact',
      matterId: contactId,
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
