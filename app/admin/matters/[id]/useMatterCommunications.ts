'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiRequest } from '@/lib/clientApi'
import { mergeCommunicationItems, type CommunicationItem } from '@/lib/comms/thread'
import { formatLiveThread, type LiveEmailMessage } from '@/lib/comms/inboundEmail'
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

export function useMatterCommunications({ matterId, token, initialEmailTo, enabled = true }: {
  matterId: string; token: string | null; initialEmailTo: string; enabled?: boolean
}) {
  const identity = useRef(matterId)
  useEffect(() => { identity.current = matterId }, [matterId])
  const [history, setHistory] = useState<{ id: string; portal: PortalMessage[]; sms: SmsMessage[]; email: CommunicationItem[] }>({ id: matterId, portal: [], sms: [], email: [] })
  const [summary, setSummary] = useState<{ id: string; latest: PortalMessage | null; unread: number } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [smsLoading, setSmsLoading] = useState(false)
  const [portalSending, setPortalSending] = useState(false)
  const [portalDraft, setPortalDraft] = useState('')
  const [smsRecipient, setSmsRecipient] = useState<'client' | 'spouse'>('client')
  const [smsSending, setSmsSending] = useState(false)
  const [emailTo, setEmailTo] = useState(initialEmailTo)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const fetched = useRef<string | null>(null)
  const summaryGeneration = useRef(0)
  const historyGeneration = useRef(0)
  const portalMessages = useMemo(() => history.id === matterId ? history.portal : [], [history, matterId])
  const smsMessages = useMemo(() => history.id === matterId ? history.sms : [], [history, matterId])
  const emailItems = useMemo(() => history.id === matterId ? history.email : [], [history, matterId])

  useEffect(() => {
    setEmailTo(initialEmailTo)
    setPortalDraft('')
    setEmailSubject('')
    setEmailBody('')
    return () => { summaryGeneration.current += 1; historyGeneration.current += 1; fetched.current = null }
  }, [matterId, initialEmailTo])

  const loadSummary = useCallback(async () => {
    if (!token) return
    const generation = ++summaryGeneration.current
    try {
      const result = await apiRequest<{ latest: PortalMessage | null; unread: number }>(
        `/api/messages?matter_id=${encodeURIComponent(matterId)}&summary=1`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (identity.current === matterId && generation === summaryGeneration.current) {
        setSummary({ id: matterId, ...result })
      }
    } catch {
      if (identity.current === matterId) setReadError('Message counts are unavailable. Please retry.')
    }
  }, [matterId, token])

  const loadHistory = useCallback(async () => {
    if (!token) return
    const generation = ++historyGeneration.current
    fetched.current = matterId
    setPortalLoading(true); setSmsLoading(true); setReadError(null)
    // Sent email lives in email_log, tagged with the matter; without it the
    // Email filter could only ever say "No email messages yet".
    const [portal, sms, email] = await Promise.allSettled([
      apiRequest<PortalMessage[]>(`/api/messages?matter_id=${encodeURIComponent(matterId)}`, { headers: { Authorization: `Bearer ${token}` } }),
      apiRequest<SmsMessage[]>(`/api/admin/matters/${matterId}/sms-messages`, { headers: { Authorization: `Bearer ${token}` } }),
      apiRequest<CommunicationItem[]>(`/api/admin/comms/email-history?type=matter&id=${encodeURIComponent(matterId)}`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
    if (identity.current !== matterId || generation !== historyGeneration.current) return
    setHistory(previous => ({ id: matterId,
      portal: portal.status === 'fulfilled' ? portal.value : previous.id === matterId ? previous.portal : [],
      sms: sms.status === 'fulfilled' ? sms.value : previous.id === matterId ? previous.sms : [],
      email: email.status === 'fulfilled' && Array.isArray(email.value) ? email.value : previous.id === matterId ? previous.email : [],
    }))
    if (portal.status === 'rejected' || sms.status === 'rejected' || email.status === 'rejected') setReadError('Some message history is unavailable. Please retry.')
    setPortalLoading(false); setSmsLoading(false)
  }, [matterId, token])

  useEffect(() => { void loadSummary() }, [loadSummary])
  useEffect(() => { if (enabled && fetched.current !== matterId) void loadHistory() }, [enabled, matterId, loadHistory])
  const handleInsert = useCallback(() => { void loadSummary(); if (enabled) void loadHistory() }, [enabled, loadHistory, loadSummary])
  useMessagesRealtime(matterId, handleInsert, handleInsert)

  // This effect runs after displayed history commits. Inactive tabs never
  // acknowledge messages, and historical pages not fetched remain unread.
  useEffect(() => {
    if (!enabled || !token || history.id !== matterId) return
    const ids = history.portal.filter(row => row.sender_role === 'client' && !row.read_at).map(row => row.id)
    if (!ids.length) return
    let cancelled = false
    void apiRequest('/api/messages', {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ matter_id: matterId, message_ids: ids }),
    }).then(() => {
      if (cancelled || identity.current !== matterId) return
      setHistory(previous => ({ ...previous, portal: previous.portal.map(row => ids.includes(row.id) ? { ...row, read_at: new Date().toISOString() } : row) }))
      void loadSummary()
    }).catch(() => { if (!cancelled) setReadError('Messages could not be marked read. Please retry.') })
    return () => { cancelled = true }
  }, [enabled, history, matterId, token, loadSummary])

  const sendOnChannel = useCallback(async (channel: 'portal' | 'sms', body: string): Promise<boolean> => {
    if (!token || !body.trim()) return false
    const setSending = channel === 'sms' ? setSmsSending : setPortalSending
    setSending(true)
    try {
      if (channel === 'sms') {
        await apiRequest(`/api/admin/matters/${matterId}/send-sms`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: smsRecipient, body: body.trim() }),
        }, 'Text failed')
        toast.success('Text sent')
      } else {
        await apiRequest('/api/messages', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ matter_id: matterId, body: body.trim() }),
        }, 'Send failed')
        toast.success('Message sent')
      }
      await Promise.all([loadHistory(), loadSummary()])
      return true
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not send'); return false }
    finally { setSending(false) }
  }, [token, matterId, smsRecipient, loadHistory, loadSummary])
  const sendPortalMessage = async () => { if (await sendOnChannel('portal', portalDraft)) setPortalDraft('') }
  async function sendEmail() {
    if (!token || !emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) return
    setEmailSending(true)
    try {
      await apiRequest(`/api/admin/matters/${matterId}/send-email`, {
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
      toast.success('Email sent')
      if (enabled) void loadHistory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send email')
    } finally {
      setEmailSending(false)
    }
  }

  // A filed inbound email carries Gmail's preview; the full text is read live
  // from the mailbox when asked for, as on the lead and contact cards.
  const loadFullMessage = useCallback(async (item: CommunicationItem): Promise<string> => {
    if (!token || !item.body_href) throw new Error('The message could not be read.')
    const result = await apiRequest<{ messages: LiveEmailMessage[]; gone?: boolean }>(
      item.body_href,
      { headers: { Authorization: `Bearer ${token}` } },
      'The message could not be read from Gmail',
    )
    return formatLiveThread(result.messages ?? [])
  }, [token])

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
    emailItems,
  ), [portalMessages, smsMessages, emailItems])

  return {
    items, sendOnChannel, loadFullMessage, portalMessages, portalLoading, portalDraft, portalSending,
    smsMessages, smsLoading, smsRecipient, smsSending,
    emailTo, emailSubject, emailBody, emailSending,
    setPortalDraft, setSmsRecipient, setEmailTo, setEmailSubject, setEmailBody,
    sendPortalMessage, sendEmail, readError,
    retry: async () => { setReadError(null); await Promise.all([loadSummary(), ...(enabled ? [loadHistory()] : [])]) },
    unreadPortalCount: summary?.id === matterId ? summary.unread : 0,
    lastPortalMessage: summary?.id === matterId ? summary.latest : null,
  }
}
