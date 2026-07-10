'use server'

import { createServerSupabase } from '@/lib/supabaseServer'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { ADMIN_EMAIL } from '@/lib/supabaseAdmin'
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
    .select('status')
    .eq('id', matterId)
    .maybeSingle()
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

  return data as Message
}
