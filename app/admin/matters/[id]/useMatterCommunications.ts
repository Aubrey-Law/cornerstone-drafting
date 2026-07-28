'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiRequest } from '@/lib/clientApi'
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

  useEffect(() => setEmailTo(initialEmailTo), [initialEmailTo])

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

  return {
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
