'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { apiRequest } from '@/lib/clientApi'
import { mergeCommunicationItems, type CommunicationItem } from '@/lib/comms/thread'
import { useMessagesRealtime } from '@/lib/messages/useMessagesRealtime'

export interface PortalMessage {
  id: string
  body: string
  sender_role: string
  created_at: string
  read_at: string | null
}
export interface SmsMessage {
  id: string
  direction: string
  recipient_role: string | null
  recipient_name: string | null
  body: string
  status: string
  from_number?: string | null
  to_number?: string | null
  created_at: string
  actor_name?: string | null
}

interface EmailSendResponse {
  provider?: string
}

interface CallItemRow {
  id: string
  direction: 'inbound' | 'outbound'
  status: string
  started_at: string
  duration_seconds: number | null
  summary: string | null
  firm_user_email: string | null
}

export function useMatterCommunications({
  matterId,
  token,
  initialEmailTo,
}: {
  matterId: string
  token: string | null
  initialEmailTo: string
}) {
  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([])
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalDraft, setPortalDraft] = useState('')
  const [portalSending, setPortalSending] = useState(false)
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [smsDraft, setSmsDraft] = useState('')
  const [smsRecipient, setSmsRecipient] = useState<'client' | 'spouse'>('client')
  const [smsSending, setSmsSending] = useState(false)
  const [emailTo, setEmailTo] = useState(initialEmailTo)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [calls, setCalls] = useState<CallItemRow[]>([])

  useEffect(() => setEmailTo(initialEmailTo), [initialEmailTo])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const rows = await apiRequest<unknown>(
          `/api/admin/matters/${matterId}/calls?limit=100`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (cancelled) return
        const list = Array.isArray(rows)
          ? rows
          : (rows as { calls?: unknown[] } | null)?.calls ?? []
        setCalls(Array.isArray(list) ? list as CallItemRow[] : [])
      } catch {
        // Calls stay out of the timeline if history is unavailable.
      }
    })()
    return () => { cancelled = true }
  }, [matterId, token])

  const loadPortalMessages = useCallback(async () => {
    if (!token) return
    setPortalLoading(true)
    try {
      const messages = await apiRequest<unknown>(
        `/api/messages?matter_id=${encodeURIComponent(matterId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      setPortalMessages(Array.isArray(messages) ? messages as PortalMessage[] : [])
    } catch {
      // The page remains usable if message history is temporarily unavailable.
    } finally {
      setPortalLoading(false)
    }
  }, [matterId, token])

  const loadSmsMessages = useCallback(async () => {
    if (!token) return
    setSmsLoading(true)
    try {
      const messages = await apiRequest<unknown>(
        `/api/admin/matters/${matterId}/sms-messages`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      setSmsMessages(Array.isArray(messages) ? messages as SmsMessage[] : [])
    } catch {
      // SMS history is non-blocking for the rest of the matter workspace.
    } finally {
      setSmsLoading(false)
    }
  }, [matterId, token])

  useEffect(() => {
    void loadPortalMessages()
    void loadSmsMessages()
  }, [loadPortalMessages, loadSmsMessages])

  const handlePortalMessageInsert = useCallback((message: PortalMessage) => {
    setPortalMessages(current => (
      current.some(row => row.id === message.id) ? current : [...current, message]
    ))
  }, [])

  useMessagesRealtime(matterId, handlePortalMessageInsert)

  async function sendPortalMessage() {
    if (!token || !portalDraft.trim()) return
    setPortalSending(true)
    try {
      await apiRequest('/api/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ matter_id: matterId, body: portalDraft.trim() }),
      }, 'Send failed')
      setPortalDraft('')
      toast.success('Message sent')
      await loadPortalMessages()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send message')
    } finally {
      setPortalSending(false)
    }
  }

  async function sendSms() {
    if (!token || !smsDraft.trim()) return
    setSmsSending(true)
    try {
      await apiRequest(`/api/admin/matters/${matterId}/send-sms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipient: smsRecipient, body: smsDraft.trim() }),
      }, 'SMS failed')
      setSmsDraft('')
      toast.success('Text sent')
      await loadSmsMessages()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send SMS')
    } finally {
      setSmsSending(false)
    }
  }

  async function sendEmail() {
    if (!token || !emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) return
    setEmailSending(true)
    try {
      const response = await apiRequest<EmailSendResponse>(`/api/admin/matters/${matterId}/send-email`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: emailTo.trim(),
          subject: emailSubject.trim(),
          text: emailBody.trim(),
        }),
      }, 'Email failed')
      setEmailSubject('')
      setEmailBody('')
      toast.success(response.provider === 'graph' ? 'Email sent via Outlook' : 'Email sent')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send email')
    } finally {
      setEmailSending(false)
    }
  }

  // One merged timeline over the arrays already fetched above — the tab's
  // interleaved view reads this; the per-channel arrays stay for callers that
  // still want a single channel.
  const items: CommunicationItem[] = useMemo(() => mergeCommunicationItems(
    portalMessages.map(m => ({
      id: m.id,
      channel: 'portal' as const,
      direction: m.sender_role === 'client' ? 'inbound' as const : 'outbound' as const,
      body: m.body,
      sender: m.sender_role === 'client' ? null : 'Firm',
      created_at: m.created_at,
    })),
    smsMessages.map(m => ({
      id: m.id,
      channel: 'sms' as const,
      direction: m.direction === 'inbound' ? 'inbound' as const : 'outbound' as const,
      body: m.body,
      meta: m.status || null,
      sender: m.direction === 'inbound' ? m.recipient_name : m.actor_name ?? 'Firm',
      created_at: m.created_at,
    })),
    calls.map(c => ({
      id: c.id,
      channel: 'call' as const,
      direction: c.direction,
      body: c.summary?.trim() || `${c.direction === 'inbound' ? 'Inbound' : 'Outbound'} call`,
      meta: [c.status, c.duration_seconds != null ? `${c.duration_seconds}s` : null]
        .filter(Boolean).join(' · ') || null,
      sender: c.direction === 'outbound' ? c.firm_user_email : null,
      created_at: c.started_at,
    })),
  ), [portalMessages, smsMessages, calls])

  /** Locked-composer send: same endpoints as the per-channel senders above. */
  const sendOnChannel = useCallback(async (channel: 'portal' | 'sms', body: string): Promise<boolean> => {
    if (!token || !body.trim()) return false
    try {
      if (channel === 'portal') {
        await apiRequest('/api/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ matter_id: matterId, body: body.trim() }),
        }, 'Send failed')
        toast.success('Message sent')
        await loadPortalMessages()
      } else {
        await apiRequest(`/api/admin/matters/${matterId}/send-sms`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: smsRecipient, body: body.trim() }),
        }, 'SMS failed')
        toast.success('Text sent')
        await loadSmsMessages()
      }
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send')
      return false
    }
  }, [token, matterId, smsRecipient, loadPortalMessages, loadSmsMessages])

  return {
    items,
    sendOnChannel,
    portalMessages,
    portalLoading,
    portalDraft,
    portalSending,
    smsMessages,
    smsLoading,
    smsDraft,
    smsRecipient,
    smsSending,
    emailTo,
    emailSubject,
    emailBody,
    emailSending,
    setPortalDraft,
    setSmsDraft,
    setSmsRecipient,
    setEmailTo,
    setEmailSubject,
    setEmailBody,
    sendPortalMessage,
    sendSms,
    sendEmail,
  }
}
