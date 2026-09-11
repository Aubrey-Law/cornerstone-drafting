import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizeSmsRecipient, sendProviderSmsMessage } from '@/lib/sms/provider'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { smsProvider } from '@/lib/communications/providers'
import { telnyxPhoneNumber } from '@/lib/telnyx/config'

export { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

export type SmsRecipientRole = 'client' | 'spouse' | 'other'

export interface SmsActor {
  id: string
  email: string | null
  name: string | null
}

export interface ResolvedSmsTarget {
  recipientName: string
  recipientRole: SmsRecipientRole
  phone: string | null
  /** Leads may retain their linked opportunity matter for thread provenance. */
  matterId: string | null
  leadId?: string | null
  /**
   * The `contacts` row this is addressed to, when the recipient is a related
   * person rather than the client of record. Owns the thread; any matterId /
   * leadId alongside it is inherited from their household so the matter tab
   * can still surface the message.
   */
  contactId?: string | null
}

export interface OutboundSmsResult {
  ok: true
  status: string
  providerMessageId: string
  smsMessage: Record<string, unknown>
  activity: Record<string, unknown> | null
}

export interface OutboundSmsFailure {
  ok: false
  error: string
  smsMessage?: Record<string, unknown>
  activity?: Record<string, unknown> | null
  status?: number
}

function publicSenderNumber(): string | null {
  if (smsProvider() === 'telnyx') return telnyxPhoneNumber()
  return (
    process.env.TWILIO_SMS_FROM?.trim() ||
    process.env.TWILIO_CALLER_ID?.trim() ||
    null
  )
}

export async function resolveMatterSmsTarget(
  matterId: string,
  recipient: 'client' | 'spouse',
): Promise<{ target: ResolvedSmsTarget | null; error: string | null }> {
  const admin = getAdminClient()
  // `v_matter_pipeline_all`, not `v_matter_pipeline`: the latter is hired-only,
  // but every lead now carries an opportunity matter and the SMS trigger
  // threads lead conversations under it — so replying to a lead from the inbox
  // failed with "Matter not found".
  const { data: matter, error } = await admin
    .from('v_matter_pipeline_all')
    .select('matter_id, client_name, client_phone, spouse_name, spouse_phone')
    .eq('matter_id', matterId)
    .maybeSingle()

  if (error) return { target: null, error: error.message }
  if (!matter) return { target: null, error: 'Matter not found' }

  if (recipient === 'spouse') {
    return {
      target: {
        recipientName: matter.spouse_name?.trim() || 'Spouse',
        recipientRole: 'spouse',
        phone: matter.spouse_phone,
        matterId,
      },
      error: null,
    }
  }

  return {
    target: {
      recipientName: matter.client_name?.trim() || 'Client',
      recipientRole: 'client',
      phone: matter.client_phone,
      matterId,
    },
    error: null,
  }
}

export async function resolveLeadSmsTarget(
  leadId: string,
  options: { includeLinkedMatter?: boolean } = {},
): Promise<{ target: ResolvedSmsTarget | null; error: string | null }> {
  const admin = getAdminClient()
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('id, first_name, last_name, full_name, phone, matter_id')
    .eq('id', leadId)
    .not('lead_status', 'is', null)
    .maybeSingle()

  if (error) return { target: null, error: error.message }
  if (!lead) return { target: null, error: 'Lead not found' }

  const name =
    lead.full_name?.trim() ||
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    'Lead'

  return {
    target: {
      recipientName: name,
      recipientRole: 'client',
      phone: lead.phone,
      matterId: options.includeLinkedMatter ? lead.matter_id ?? null : null,
      leadId,
    },
    error: null,
  }
}

/**
 * Text a related person — a trustee, an adult child, a referring professional —
 * rather than the client of record. Inherits the household's matter or lead so
 * the message still shows on that record, while `contactId` keeps it a thread
 * of its own.
 */
export async function resolveContactSmsTarget(
  contactId: string,
): Promise<{ target: ResolvedSmsTarget | null; error: string | null }> {
  const admin = getAdminClient()
  const { data: contact, error } = await admin
    .from('contacts')
    .select('id, first_name, last_name, preferred_name, phone, relationship_type, client_intake_id, deceased')
    .eq('id', contactId)
    .maybeSingle()

  if (error) return { target: null, error: error.message }
  if (!contact) return { target: null, error: 'Contact not found' }
  if (contact.deceased) return { target: null, error: 'This contact is marked deceased.' }

  const name =
    [contact.preferred_name?.trim() || contact.first_name?.trim(), contact.last_name?.trim()]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Contact'

  let matterId: string | null = null
  let leadId: string | null = null

  if (contact.client_intake_id) {
    const { data: intake } = await admin
      .from('client_intake')
      .select('id, matter_id')
      .eq('id', contact.client_intake_id)
      .maybeSingle()

    if (intake) {
      const { data: matter } = intake.matter_id
        ? await admin
            .from('matters')
            .select('id, relationship_status')
            .eq('id', intake.matter_id)
            .maybeSingle()
        : { data: null }

      // Same hired/lead split the rest of the app makes: a null status means a
      // matter-origin intake predating the lead pipeline, i.e. a client.
      if (matter && (matter.relationship_status ?? 'hired') === 'hired') matterId = matter.id
      else leadId = intake.id
    }
  }

  return {
    target: {
      recipientName: name,
      // 'spouse' has dedicated handling elsewhere; everyone else is 'other'.
      recipientRole: contact.relationship_type === 'spouse' ? 'spouse' : 'other',
      phone: contact.phone,
      matterId,
      leadId,
      contactId: contact.id,
    },
    error: null,
  }
}

export async function sendOutboundSms(
  target: ResolvedSmsTarget,
  body: string,
  actor: SmsActor,
): Promise<OutboundSmsResult | OutboundSmsFailure> {
  const trimmedBody = body.trim()
  if (!trimmedBody) {
    return { ok: false, error: 'body is required', status: 400 }
  }
  if (trimmedBody.length > MAX_SMS_BODY_LENGTH) {
    return {
      ok: false,
      error: `body must be ${MAX_SMS_BODY_LENGTH} characters or fewer`,
      status: 400,
    }
  }

  const to = normalizeSmsRecipient(target.phone)
  if (!to) {
    return {
      ok: false,
      error: `${target.recipientName} does not have a textable US phone number.`,
      status: 400,
    }
  }

  if (smsProvider() === 'none') return { ok: false, error: 'SMS delivery is disabled.', status: 409 }
  const admin = getAdminClient()
  const baseRow = {
    matter_id: target.matterId,
    lead_id: target.leadId ?? null,
    contact_id: target.contactId ?? null,
    direction: 'outbound',
    provider: smsProvider(),
    recipient_role: target.recipientRole,
    recipient_name: target.recipientName,
    to_number: to,
    from_number: publicSenderNumber(),
    body: trimmedBody,
    status: 'pending',
    actor_id: actor.id,
    actor_email: actor.email,
    actor_name: actor.name,
    raw_payload: {
      requested_recipient: target.recipientRole,
      requested_phone: target.phone,
      requested_contact_id: target.contactId ?? undefined,
    },
  }

  const { data: smsRow, error: insertError } = await admin
    .from('sms_messages')
    .insert(baseRow)
    .select()
    .single()

  if (insertError) {
    return { ok: false, error: insertError.message, status: 500 }
  }

  const result = await sendProviderSmsMessage({ to, body: trimmedBody })
  const nextStatus = result.ok ? result.status : 'failed'

  const updatePayload = result.ok
    ? {
        status: nextStatus,
        provider_message_id: result.providerMessageId,
        sent_at: new Date().toISOString(),
        error: null,
        raw_payload: {
          ...baseRow.raw_payload,
          [smsProvider()]: {
            id: result.providerMessageId,
            status: result.status,
          },
        },
      }
    : {
        status: nextStatus,
        error: result.error,
        raw_payload: {
          ...baseRow.raw_payload,
          error: result.error,
        },
      }

  const { data: updatedSmsRow } = await admin
    .from('sms_messages')
    .update(updatePayload)
    .eq('id', smsRow.id)
    .select()
    .single()

  const smsRecord = (updatedSmsRow ?? smsRow) as Record<string, unknown>
  let activity: Record<string, unknown> | null = null

  const title = result.ok
    ? `Text sent to ${target.recipientName}`
    : `Text failed to ${target.recipientName}`
  const detail = `To ${to}${result.ok ? '' : ` (${result.error})`}`

  // Three-way, not an either/or: a standalone contact has no matter_activity
  // and no lead_activity to write to (there is no contact_activity table).
  // That's fine — the sms_messages row is the record.
  if (target.leadId) {
    const { data: leadActivity, error: activityError } = await admin
      .from('lead_activity')
      .insert({
        lead_id: target.leadId,
        event_type: result.ok ? 'sms_sent' : 'sms_failed',
        title,
        detail,
        actor_id: actor.id,
      })
      .select()
      .single()
    if (activityError) {
      console.error('sendOutboundSms: failed to log lead activity', activityError)
    } else {
      activity = leadActivity as Record<string, unknown>
    }
  } else if (target.matterId) {
    const { data: matterActivity, error: activityError } = await admin
      .from('matter_activity')
      .insert({
        matter_id: target.matterId,
        event_type: 'sms_sent',
        actor_id: actor.id,
        actor_email: actor.email,
        actor_name: actor.name,
        title,
        detail,
        metadata: {
          sms_message_id: smsRow.id,
          recipient: target.recipientRole,
          to,
          status: nextStatus,
          provider_message_id: result.ok ? result.providerMessageId : undefined,
          error: result.ok ? undefined : result.error,
        },
      })
      .select()
      .single()

    if (activityError) {
      console.error('sendOutboundSms: failed to log matter activity', activityError)
    } else {
      activity = matterActivity as Record<string, unknown>
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      smsMessage: smsRecord,
      activity,
      status: 502,
    }
  }

  return {
    ok: true,
    status: result.status,
    providerMessageId: result.providerMessageId,
    smsMessage: smsRecord,
    activity,
  }
}
