import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { portalUrl } from '@/lib/urls'

/**
 * Client-facing "something new in your portal" notices. Both helpers are
 * fire-and-forget: they log failures instead of throwing so a notification
 * problem can never fail the share/message action itself.
 */

async function fetchMatterClient(matterId: string): Promise<{ name: string | null; email: string } | null> {
  const { data, error } = await getAdminClient()
    .from('v_matter_pipeline')
    .select('client_name, client_email')
    .eq('matter_id', matterId)
    .maybeSingle()
  if (error || !data?.client_email) return null
  return { name: (data.client_name as string | null) ?? null, email: data.client_email as string }
}

function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'there'
}

/** True when this category already emailed this address recently (batch shares → one notice). */
async function recentlyNotified(category: string, toEmail: string, windowMinutes: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
  const { data, error } = await getAdminClient()
    .from('email_log')
    .select('id')
    .eq('category', category)
    .eq('to_email', toEmail)
    .eq('status', 'sent')
    .gte('sent_at', since)
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

export async function notifyClientOfSharedDocument(matterId: string, documentName: string): Promise<void> {
  try {
    const client = await fetchMatterClient(matterId)
    if (!client) return
    if (await recentlyNotified('document_shared_notice', client.email, 30)) return

    const firm = getFirmConfig()
    const link = portalUrl('/documents')
    await sendEmail({
      category: 'document_shared_notice',
      to: client.email,
      subject: `A document is ready for you — ${firm.firmName}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <p>Hi ${firstName(client.name)},</p>
        <p>We shared a document with you: <strong>${documentName}</strong>.</p>
        <p>You can view it any time in your secure portal.</p>
        <p><a href="${link}" style="color:#1a6b72">View your documents →</a></p>
      </div>`,
      from: `${firm.attorneyShortName} <${firm.email}>`,
    })
  } catch (err) {
    console.error('notifyClientOfSharedDocument failed:', err)
  }
}

/**
 * The firm asked for a document. Several requests in one sitting send one
 * notice; a list sent in one step passes its size as `count`, and the notice
 * says how many items there are instead of naming only the first.
 */
export async function notifyClientOfDocumentRequest(matterId: string, title: string, count = 1): Promise<void> {
  try {
    const client = await fetchMatterClient(matterId)
    if (!client) return
    if (await recentlyNotified('document_request_notice', client.email, 30)) return

    const firm = getFirmConfig()
    const link = portalUrl('/documents#requests')
    const safeTitle = title.replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]!)
    await sendEmail({
      category: 'document_request_notice',
      to: client.email,
      subject: count > 1
        ? `We need some documents from you — ${firm.firmName}`
        : `We need a document from you — ${firm.firmName}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <p>Hi ${firstName(client.name)},</p>
        ${count > 1
          ? `<p>We have put together a list of ${count} documents we need to move your matter along, starting with <strong>${safeTitle}</strong>. You do not need to send them all at once.</p>`
          : `<p>We have asked for something to move your matter along: <strong>${safeTitle}</strong>.</p>`}
        <p>You can upload ${count > 1 ? 'each one' : 'it'} any time from your secure portal, where the full list of what we need is kept up to date.</p>
        <p><a href="${link}" style="color:#1a6b72">See what we need →</a></p>
      </div>`,
      from: `${firm.attorneyShortName} <${firm.email}>`,
    })
  } catch (err) {
    console.error('notifyClientOfDocumentRequest failed:', err)
  }
}

export async function notifyClientOfFirmMessage(matterId: string): Promise<void> {
  try {
    const client = await fetchMatterClient(matterId)
    if (!client) return
    if (await recentlyNotified('portal_message_notice', client.email, 30)) return

    const firm = getFirmConfig()
    const link = portalUrl('/messages')
    await sendEmail({
      category: 'portal_message_notice',
      to: client.email,
      subject: `New message from ${firm.firmName}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <p>Hi ${firstName(client.name)},</p>
        <p>You have a new message from ${firm.firmName} in your secure portal.</p>
        <p><a href="${link}" style="color:#1a6b72">Read and reply →</a></p>
      </div>`,
      from: `${firm.attorneyShortName} <${firm.email}>`,
    })
  } catch (err) {
    console.error('notifyClientOfFirmMessage failed:', err)
  }
}
