import { appUrl } from '@/lib/urls'
import { canEnrollMarketingProfile, type CampaignKind, type MarketingRecordKind } from '@/lib/crm/campaignPolicy'
import { mailgunConfigured, sendMailgunCampaignBatch, unsubscribeTokenHash } from '@/lib/crm/mailgunCampaigns'
import { getAdminClient } from '@/lib/supabaseAdmin'

type ClaimedDelivery = { id: string }

export type CampaignDispatchResult = {
  claimed: number
  sent: number
  suppressed: number
  uncertain: number
}

function withUnsubscribe(body: string, html: boolean) {
  const link = '%recipient.unsubscribe_url%'
  return html
    ? `${body}<p style="margin-top:24px;font-size:12px"><a href="${link}">Unsubscribe from marketing emails</a></p>`
    : `${body}\n\nUnsubscribe from marketing emails: ${link}`
}

export async function dispatchDueCampaignDeliveries(campaignId?: string, limit = 250): Promise<CampaignDispatchResult> {
  if (!mailgunConfigured()) throw new Error('Mailgun campaign delivery is not configured.')
  const admin = getAdminClient()
  const { data: claimed, error: claimError } = await admin.rpc('claim_crm_campaign_deliveries', {
    p_campaign_id: campaignId ?? null,
    p_limit: limit,
  })
  if (claimError) throw new Error(claimError.message)
  const ids = (claimed as ClaimedDelivery[] | null ?? []).map(row => row.id)
  if (!ids.length) return { claimed: 0, sent: 0, suppressed: 0, uncertain: 0 }

  const { data: deliveries, error: deliveriesError } = await admin
    .from('cornerstone_crm_campaign_deliveries')
    .select('id, campaign_id, campaign_recipient_id, step_id, delivery_token')
    .in('id', ids)
  if (deliveriesError) throw new Error(deliveriesError.message)

  const recipientIds = [...new Set((deliveries ?? []).map(row => row.campaign_recipient_id))]
  const stepIds = [...new Set((deliveries ?? []).map(row => row.step_id))]
  const campaignIds = [...new Set((deliveries ?? []).map(row => row.campaign_id))]
  const [{ data: recipients }, { data: steps }, { data: campaigns }] = await Promise.all([
    admin.from('cornerstone_crm_campaign_recipients').select('id, person_id, snapshot_email').in('id', recipientIds),
    admin.from('cornerstone_crm_campaign_steps').select('id, subject, body_text, body_html').in('id', stepIds),
    admin.from('cornerstone_crm_campaigns').select('id, type').in('id', campaignIds),
  ])
  const recipientsById = new Map((recipients ?? []).map(row => [row.id, row]))
  const peopleIds = [...new Set((recipients ?? []).map(row => row.person_id))]
  const { data: people } = await admin
    .from('v_cornerstone_crm_people')
    .select('id, marketing_status, cornerstone_matter_id')
    .in('id', peopleIds)
  const peopleById = new Map((people ?? []).map(row => [row.id, row]))
  const stepsById = new Map((steps ?? []).map(row => [row.id, row]))
  const campaignsById = new Map((campaigns ?? []).map(row => [row.id, row]))

  const suppressIds: string[] = []
  const groups = new Map<string, Array<{ id: string; recipientId: string; email: string; token: string }>>()
  for (const delivery of deliveries ?? []) {
    const recipient = recipientsById.get(delivery.campaign_recipient_id)
    const person = recipient ? peopleById.get(recipient.person_id) : null
    const snapshotEmail = recipient?.snapshot_email ?? null
    const campaign = campaignsById.get(delivery.campaign_id)
    const step = stepsById.get(delivery.step_id)
    const recordKind: MarketingRecordKind = person?.cornerstone_matter_id ? 'client' : 'lead'
    if (!person || !campaign || !step || !canEnrollMarketingProfile({
      marketingStatus: person.marketing_status,
      recordKind,
      email: snapshotEmail,
    }, campaign.type as CampaignKind)) {
      suppressIds.push(delivery.id)
      continue
    }
    const list = groups.get(delivery.step_id) ?? []
    list.push({ id: delivery.id, recipientId: delivery.campaign_recipient_id, email: snapshotEmail!.trim(), token: delivery.delivery_token })
    groups.set(delivery.step_id, list)
  }
  if (suppressIds.length) {
    await admin.from('cornerstone_crm_campaign_deliveries').update({
      provider_status: 'failed',
      error_code: 'consent_or_eligibility_changed',
      last_event_at: new Date().toISOString(),
    }).in('id', suppressIds)
  }

  let sent = 0
  let uncertain = 0
  for (const [stepId, group] of groups) {
    const step = stepsById.get(stepId)!
    for (let start = 0; start < group.length; start += 1000) {
      const batch = group.slice(start, start + 1000)
      const { data: dispatch } = await admin.from('cornerstone_crm_campaign_dispatches').insert({
        campaign_id: (deliveries ?? []).find(row => row.step_id === stepId)?.campaign_id,
        attempted_count: batch.length,
      }).select('id').single()
      try {
        const response = await sendMailgunCampaignBatch({
          subject: step.subject,
          html: withUnsubscribe(step.body_html, true),
          text: withUnsubscribe(step.body_text, false),
          tag: 'cornerstone-campaign',
          recipients: batch.map(row => ({
            email: row.email,
            deliveryToken: row.token,
            unsubscribeUrl: appUrl(`/api/unsubscribe/${row.token}`),
          })),
        })
        const now = new Date().toISOString()
        await Promise.all([
          admin.from('cornerstone_crm_campaign_deliveries').update({
            provider_status: 'sent',
            provider_message_id: response.messageId,
            last_event_at: now,
          }).in('id', batch.map(row => row.id)),
          admin.from('cornerstone_crm_campaign_recipients').update({
            provider_status: 'sent',
            provider_message_id: response.messageId,
            last_event_at: now,
          }).in('id', batch.map(row => row.recipientId)),
          dispatch ? admin.from('cornerstone_crm_campaign_dispatches').update({
            status: 'completed',
            provider_message_id: response.messageId,
            accepted_count: batch.length,
            completed_at: now,
          }).eq('id', dispatch.id) : Promise.resolve(),
        ])
        sent += batch.length
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 200) : 'mailgun_submission_failed'
        await Promise.all([
          admin.from('cornerstone_crm_campaign_deliveries').update({
            provider_status: 'unknown',
            error_code: message,
            last_event_at: new Date().toISOString(),
          }).in('id', batch.map(row => row.id)),
          dispatch ? admin.from('cornerstone_crm_campaign_dispatches').update({
            status: 'failed',
            failed_count: batch.length,
            error_message: message,
            completed_at: new Date().toISOString(),
          }).eq('id', dispatch.id) : Promise.resolve(),
        ])
        uncertain += batch.length
      }
    }
  }
  return { claimed: ids.length, sent, suppressed: suppressIds.length, uncertain }
}

export async function suppressCampaignDeliveryByToken(
  token: string,
  status: 'bounced' | 'complaint' | 'unsubscribed',
): Promise<boolean> {
  const admin = getAdminClient()
  const { data: delivery } = await admin
    .from('cornerstone_crm_campaign_deliveries')
    .select('id, campaign_recipient_id')
    .eq('delivery_token_hash', unsubscribeTokenHash(token))
    .maybeSingle()
  if (!delivery) return false

  const { data: recipient } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('person_id')
    .eq('id', delivery.campaign_recipient_id)
    .maybeSingle()
  const now = new Date().toISOString()
  await admin.from('cornerstone_crm_campaign_deliveries').update({
    provider_status: status,
    last_event_at: now,
  }).eq('id', delivery.id)
  if (recipient?.person_id) {
    await admin.from('cornerstone_crm_people').update({
      marketing_status: 'opted_out',
      campaign_opt_out: true,
      unsubscribed_at: now,
    }).eq('id', recipient.person_id)
  }
  return true
}
