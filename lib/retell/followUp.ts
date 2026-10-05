import type Anthropic from '@anthropic-ai/sdk'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'
import type { RetellCall } from './types'

/**
 * The receptionist's follow-up: what the firm does after the AI receptionist
 * hangs up. The call used to end in a summary email and nothing else; a
 * person then created the lead, booked the call, or sent the link by hand.
 *
 * Now the call's facts are read, the caller is matched to the firm's records,
 * and each next step is handed to the delegation dial as its own action: a
 * callback task, a new lead, a booked discovery call, or a scheduling link.
 * At Propose each waits as a card on Today; at Act and report it happens and
 * is listed. Legal judgment is never involved, so nothing here is capped
 * below the dial's ceilings.
 */

export interface CallerFacts {
  name: string | null
  email: string | null
  phone: string | null
  reason: string | null
  wantsAppointment: boolean
  /** ISO instant the caller asked for, when the call captured one. */
  requestedTimeIso: string | null
  /** The caller said they are already a client. */
  claimsExistingClient: boolean
}

export type CallerMatch =
  | { kind: 'matter'; id: string; name: string | null }
  | { kind: 'lead'; id: string; name: string | null }
  | { kind: 'contact'; id: string; name: string | null }
  | { kind: 'none' }

export interface ReceptionistPlanItem {
  actionKey: 'task.create' | 'lead.create' | 'appointment.book' | 'scheduling.link.send'
  summary: string
  payload: Record<string, unknown>
  recordType: 'lead' | 'matter' | 'firm'
  recordId?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DISCOVERY_CALL_KEY = 'discovery_call'

function text(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', 'yes', 'y'].includes(value.trim().toLowerCase())
  return false
}

function isoInFuture(value: unknown, now: number): string | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || ms <= now) return null
  return new Date(ms).toISOString()
}

/** Facts the Retell agent extracted itself, when it was configured to. */
export function extractCallerFactsFromAnalysis(call: RetellCall | null | undefined, now = Date.now()): CallerFacts | null {
  const data = call?.call_analysis?.custom_analysis_data
  if (!data || typeof data !== 'object') return null
  const email = text(data.caller_email, 320)?.toLowerCase() ?? null
  const facts: CallerFacts = {
    name: text(data.caller_name, 200),
    email: email && EMAIL_RE.test(email) ? email : null,
    phone: text(data.caller_phone, 50),
    reason: text(data.reason ?? data.call_reason, 500),
    wantsAppointment: bool(data.wants_appointment ?? data.wants_consultation),
    requestedTimeIso: isoInFuture(data.requested_time ?? data.requested_appointment_time, now),
    claimsExistingClient: bool(data.existing_client ?? data.is_existing_client),
  }
  if (!facts.name && !facts.email && !facts.reason && !facts.wantsAppointment) return null
  return facts
}

export const CALLER_FACTS_SYSTEM_PROMPT = `You read the summary and transcript of a phone call answered by a law firm's AI receptionist and extract what the firm needs to follow up.

Output ONLY one JSON object:
{
  "caller_name": string | null,
  "caller_email": string | null,
  "caller_phone": string | null,
  "reason": string | null,
  "wants_appointment": boolean,
  "requested_time": string | null,
  "existing_client": boolean
}

Rules: never invent a name, email or phone number that the caller did not say. "requested_time" is an ISO 8601 instant in the firm's timezone only when the caller named a specific day and time; otherwise null. "reason" is one plain sentence. "existing_client" is true only when the caller says they already work with the firm.`

/** The light model reads the call when the agent captured no structured fields. */
export async function extractCallerFactsWithModel(input: {
  summary: string | null
  transcript: string | null
  timezone: string
  now?: number
}): Promise<CallerFacts | null> {
  const body = [input.summary ? `Summary:\n${input.summary}` : null, input.transcript ? `Transcript:\n${input.transcript.slice(0, 12_000)}` : null]
    .filter(Boolean).join('\n\n')
  if (!body.trim()) return null
  const { callAnthropic } = await import('@/lib/anthropic')
  const { resolveFirmModel } = await import('@/lib/firmModels')
  const message = await callAnthropic({
    model: await resolveFirmModel('light'),
    max_tokens: 600,
    system: CALLER_FACTS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Firm timezone: ${input.timezone}. Today: ${new Date(input.now ?? Date.now()).toISOString()}.\n\n---BEGIN CALL---\n${body}\n---END CALL---` }],
  }, { route: 'webhooks/retell/follow-up', contextType: 'lead' })
  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text).join('').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  return extractCallerFactsFromAnalysis({ call_id: 'model', call_analysis: { custom_analysis_data: parsed } }, input.now)
}

function phoneDigits(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits.length === 10 ? digits : null
}

/** Who called: a client with a matter, a known lead, a contact, or nobody on file. */
export async function matchCaller(input: {
  phone: string | null
  email: string | null
  /** The matter the calls table's own phone match already found, if any. */
  matchedMatterId?: string | null
}): Promise<CallerMatch> {
  const admin = getAdminClient()
  if (input.matchedMatterId) {
    const { data } = await admin.from('matters').select('id, name').eq('id', input.matchedMatterId).maybeSingle()
    if (data) return { kind: 'matter', id: data.id, name: typeof data.name === 'string' ? data.name : null }
  }
  const digits = phoneDigits(input.phone)
  const stored = digits ? formatPhoneForStorage(digits) : null
  const email = input.email?.toLowerCase() ?? null
  const clauses = [
    email ? `email.eq.${email}` : null,
    stored ? `phone.eq.${stored}` : null,
    digits ? `phone.eq.${digits}` : null,
    digits ? `phone.eq.+1${digits}` : null,
  ].filter((clause): clause is string => Boolean(clause))
  if (!clauses.length) return { kind: 'none' }

  const { data: lead } = await admin.from('client_intake')
    .select('id, full_name, first_name, last_name')
    .or(clauses.join(','))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lead) {
    const name = lead.full_name ?? [lead.first_name, lead.last_name].filter(Boolean).join(' ') ?? null
    return { kind: 'lead', id: lead.id, name: name || null }
  }
  const { data: contact } = await admin.from('contacts')
    .select('id, full_name')
    .or(clauses.join(','))
    .limit(1)
    .maybeSingle()
  if (contact) return { kind: 'contact', id: contact.id, name: typeof contact.full_name === 'string' ? contact.full_name : null }
  return { kind: 'none' }
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/**
 * What to propose for one call. Pure, so the table of outcomes is testable:
 * a matched client gets a callback task; a lead or stranger who wants an
 * appointment gets it booked when they named a time, or the link when they
 * did not; a stranger with a name and email becomes a lead; anyone else
 * becomes a callback task so the call is never dropped.
 */
export function planReceptionistActions(input: {
  callId: string
  facts: CallerFacts | null
  match: CallerMatch
  fromNumber: string | null
  summary: string | null
  voicemail: boolean
  now?: number
}): ReceptionistPlanItem[] {
  const now = input.now ?? Date.now()
  const facts = input.facts
  const phone = facts?.phone ?? input.fromNumber
  const who = facts?.name ?? (input.match.kind !== 'none' ? input.match.name : null) ?? (phone ? formatPhoneDisplay(phone) : 'an unknown caller')
  const reason = facts?.reason ?? (input.voicemail ? 'left a voicemail' : null)
  const description = [
    input.voicemail ? 'Voicemail left with the receptionist.' : 'Answered by the AI receptionist.',
    phone ? `Phone: ${formatPhoneDisplay(phone)}` : null,
    facts?.email ? `Email: ${facts.email}` : null,
    input.summary ? `Summary: ${input.summary}` : null,
  ].filter(Boolean).join('\n')
  const tomorrow = new Date(now + 86_400_000).toISOString()
  const record = input.match.kind === 'matter'
    ? { recordType: 'matter' as const, recordId: input.match.id, matter_id: input.match.id, lead_id: null }
    : input.match.kind === 'lead'
      ? { recordType: 'lead' as const, recordId: input.match.id, matter_id: null, lead_id: input.match.id }
      : { recordType: 'firm' as const, recordId: undefined, matter_id: null, lead_id: null }

  const callback = (): ReceptionistPlanItem => ({
    actionKey: 'task.create',
    summary: `Return the call from ${who}${reason ? `: ${reason}` : ''}`,
    payload: {
      title: `Return call from ${who}${reason ? ` — ${reason}` : ''}`.slice(0, 300),
      description,
      priority: 'high',
      source: 'automation',
      task_type: 'single',
      matter_id: record.matter_id,
      lead_id: record.lead_id,
      due_at: tomorrow,
      estimate_minutes: 15,
    },
    recordType: record.recordType,
    recordId: record.recordId,
  })

  // An existing client's call is the attorney's to return, whatever was asked.
  if (input.match.kind === 'matter') return [callback()]

  const items: ReceptionistPlanItem[] = []
  // Booking needs a first and last name the registry can accept.
  const fullName = Boolean(facts?.name && /\s/.test(facts.name))
  const canBook = Boolean(facts?.wantsAppointment && facts.requestedTimeIso && fullName && facts.email)
  const canLink = Boolean(facts?.wantsAppointment && facts.email)

  if (canBook && facts) {
    const names = splitName(facts.name!)
    items.push({
      actionKey: 'appointment.book',
      summary: `Book a discovery call for ${facts.name} on ${new Date(facts.requestedTimeIso!).toISOString()}`,
      payload: {
        typeKey: DISCOVERY_CALL_KEY,
        startIso: facts.requestedTimeIso,
        firstName: names.firstName,
        lastName: names.lastName,
        email: facts.email,
        phone: phone ? formatPhoneForStorage(phone) : null,
        notes: reason ? `From the receptionist: ${reason}` : 'Booked from a receptionist call',
        leadId: input.match.kind === 'lead' ? input.match.id : null,
      },
      recordType: record.recordType,
      recordId: record.recordId,
    })
    return items
  }

  if (input.match.kind === 'none' && facts?.name && facts.email) {
    items.push({
      actionKey: 'lead.create',
      summary: `Create a lead for ${facts.name}${reason ? `: ${reason}` : ''}`,
      payload: {
        client_name: facts.name,
        client_email: facts.email,
        client_phone: phone ? formatPhoneForStorage(phone) : null,
        practice_area: 'EP',
      },
      recordType: 'firm',
    })
  }

  if (canLink && facts) {
    items.push({
      actionKey: 'scheduling.link.send',
      summary: `Send ${facts.name ?? facts.email} the discovery call booking link`,
      payload: {
        email: facts.email,
        name: facts.name,
        meetingTypeKey: DISCOVERY_CALL_KEY,
        leadId: input.match.kind === 'lead' ? input.match.id : null,
      },
      recordType: record.recordType,
      recordId: record.recordId,
    })
  }

  // A task needs a lead or matter to hang on. A stranger who left neither a
  // name and email nor a way to book is already in the summary email the
  // receptionist sends; there is nothing further to propose.
  if (!items.length && record.recordId) items.push(callback())
  return items
}

export interface ReceptionistFollowUpResult {
  skipped?: 'outbound' | 'no_summary' | 'no_actor' | 'not_finished'
  facts: CallerFacts | null
  match: CallerMatch['kind']
  outcomes: Array<{ actionKey: string; outcome: 'proposed' | 'observed' | 'done' | 'failed' | 'duplicate' }>
}

export async function runReceptionistFollowUp(input: {
  call: {
    external_call_id: string
    direction: 'inbound' | 'outbound'
    status: string
    from_number: string | null
    participant_number: string | null
    summary: string | null
    transcript: string | null
    raw_payload: Record<string, unknown> | null
    matter_id?: string | null
  }
  now?: number
}): Promise<ReceptionistFollowUpResult> {
  const { call } = input
  const now = input.now ?? Date.now()
  if (call.direction !== 'inbound') return { skipped: 'outbound', facts: null, match: 'none', outcomes: [] }
  if (call.status !== 'completed' && call.status !== 'voicemail') return { skipped: 'not_finished', facts: null, match: 'none', outcomes: [] }
  if (!call.summary?.trim()) return { skipped: 'no_summary', facts: null, match: 'none', outcomes: [] }

  const { resolveUnattendedActor } = await import('@/lib/actions/delegation')
  const actor = await resolveUnattendedActor()
  if (!actor) return { skipped: 'no_actor', facts: null, match: 'none', outcomes: [] }

  const retellCall = (call.raw_payload?.call ?? null) as RetellCall | null
  let facts = extractCallerFactsFromAnalysis(retellCall, now)
  if (!facts) {
    try {
      const { getSchedulingSettings } = await import('@/lib/appointments/settings')
      const timezone = (await getSchedulingSettings()).timezone
      facts = await extractCallerFactsWithModel({ summary: call.summary, transcript: call.transcript, timezone, now })
    } catch (error) {
      console.error('[retell] caller fact extraction failed', { callId: call.external_call_id, cause: error instanceof Error ? error.message : String(error) })
      facts = null
    }
  }
  const fromNumber = call.from_number ?? call.participant_number
  const match = await matchCaller({ phone: facts?.phone ?? fromNumber, email: facts?.email ?? null, matchedMatterId: call.matter_id ?? null })
  const plan = planReceptionistActions({
    callId: call.external_call_id,
    facts,
    match,
    fromNumber,
    summary: call.summary,
    voicemail: call.status === 'voicemail',
    now,
  })

  const { createActionProposal } = await import('@/lib/actions/server')
  const outcomes: ReceptionistFollowUpResult['outcomes'] = []
  for (const item of plan) {
    try {
      const created = await createActionProposal({
        actionKey: item.actionKey,
        displaySummary: item.summary,
        referencePayload: item.payload,
        recordType: item.recordType,
        recordId: item.recordId,
        source: 'automation',
        idempotencyKey: `receptionist:${call.external_call_id}:${item.actionKey}`,
        applyAutonomy: true,
      }, actor)
      outcomes.push({
        actionKey: item.actionKey,
        outcome: created.duplicate
          ? 'duplicate'
          : created.autonomy === 'observe'
            ? 'observed'
            : created.execution
              ? created.execution.status === 'succeeded' ? 'done' : 'failed'
              : 'proposed',
      })
    } catch (error) {
      console.error('[retell] follow-up action failed', { callId: call.external_call_id, actionKey: item.actionKey, cause: error instanceof Error ? error.message : String(error) })
      outcomes.push({ actionKey: item.actionKey, outcome: 'failed' })
    }
  }
  return { facts, match: match.kind, outcomes }
}
