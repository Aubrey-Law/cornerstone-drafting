'use server'

import { after } from 'next/server'

import { createServerSupabase } from '@/lib/supabaseServer'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { readMessageHistory, type MessageCursor, type MessageHistoryPage } from '@/lib/messages/history'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { appUrl } from '@/lib/urls'

export interface Message {
  id: string
  matter_id: string
  sender_role: 'attorney' | 'client' | 'admin' | 'staff'
  sender_id: string
  body: string
  created_at: string
  read_at: string | null
}

export async function sendMessage(matterId: string, body: string): Promise<Message> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const { data: matterStatus } = await supabase
    .from('matters')
    .select('status, relationship_status')
    .eq('id', matterId)
    .maybeSingle()
  if (!matterStatus || matterStatus.relationship_status !== 'hired') {
    throw new Error('This matter is not available for portal messaging.')
  }
  if (matterStatus?.status === 'closed') {
    throw new Error('This matter is closed and no longer accepts new messages.')
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      matter_id: matterId,
      sender_role: 'client',
      sender_id: user.id,
      body: body.trim(),
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  // Persistence is the send boundary. Keep the existing best-effort alert in
  // the request lifetime without making the client wait for the email provider.
  try {
    after(async () => {
      try {
        const firm = getFirmConfig()
        const clientName =
          (user.user_metadata?.full_name as string | undefined) ??
          user.email ??
          'A client'
        const preview = body.trim().length > 200 ? body.trim().slice(0, 200) + '…' : body.trim()

        const matterLink = appUrl(`/admin/matters/${matterId}?tab=communications&channel=portal`)

        await sendEmail({
          category: 'message_alert',
          to: ADMIN_EMAIL,
          subject: `New message from ${clientName}`,
          html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
            <h2 style="margin:0 0 12px">New portal message</h2>
            <p><strong>${clientName}</strong> sent a message:</p>
            <blockquote style="margin:12px 0;padding:12px;background:#f8fafc;border-left:3px solid #94a3b8">${preview}</blockquote>
            <p><a href="${matterLink}" style="color:#1a6b72">View in Communications →</a></p>
          </div>`,
          replyTo: user.email ?? undefined,
          from: `${firm.attorneyShortName} <${firm.email}>`,
        })
      } catch (err) {
        console.error('Failed to send attorney message notification:', err)
      }
    })
  } catch (err) {
    console.error('Failed to schedule attorney message notification:', err)
  }

  return data as Message
}

/** Every history/read action establishes ownership again; cursor/IDs confer no access. */
export async function loadOlderMessages(matterId: string, before: MessageCursor): Promise<MessageHistoryPage> {
  const supabase = await requirePortalMessageMatter(matterId)
  return readMessageHistory(supabase, matterId, before)
}

async function requirePortalMessageMatter(matterId: string) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const matter = await getMatterForUser(supabase, user.id)
  if (!matter || matter.id !== matterId) throw new Error('Matter access required')
  return supabase
}

export async function acknowledgeMessages(matterId: string, ids: string[]): Promise<void> {
  if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid message IDs')
  await requirePortalMessageMatter(matterId)
  if (!ids.length) return
  const { error } = await getAdminClient().from('messages').update({ read_at: new Date().toISOString() })
    .eq('matter_id', matterId).neq('sender_role', 'client').is('read_at', null).in('id', ids)
  if (error) throw new Error('Could not mark displayed messages read')
}
