'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/FilterChip'
import { ManualEmailComposer } from '@/components/rail/RailEmailPane'
import { openExternalPhone } from '@/lib/clientPhone'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { mergeCommunicationItems, type CommunicationItem } from '@/lib/comms/thread'
import { CommunicationThread, type ThreadChannelFilter } from './CommunicationThread'

export interface CommsRecord {
  /**
   * 'contact' scopes the thread to one person in the contact book rather than
   * to a household's lead or matter — so a trustee sees their own messages,
   * not the client's.
   */
  type: 'lead' | 'matter' | 'contact'
  id: string
}

interface SmsMessageRow {
  id: string
  direction: string
  recipient_name: string | null
  body: string
  status: string | null
  created_at: string
}

export interface RecordCommunicationsCardProps {
  record: CommsRecord
  recipientName: string
  recipientEmail: string | null
  recipientPhone: string | null
  smsEnabled: boolean
  /** Matter threads text a role, not a number. Ignored for lead threads. */
  smsRecipientRole?: 'client' | 'spouse'
  /** When false, the SMS composer is replaced with this explanation. */
  smsSendable?: boolean
  smsDisabledReason?: string
  defaultChannel?: 'sms' | 'email'
  onClientContact?: () => void | Promise<void>
}

/**
 * Merged SMS / email timeline for a lead or matter record, self-fetching
 * so it can drop into the lead Communications tab or the contact side panel.
 * Renders the shared `CommunicationThread` — the inbox and matter tab use the
 * same timeline and composer.
 */
export function RecordCommunicationsCard(props: RecordCommunicationsCardProps) {
  return <RecordCommunicationsContent key={`${props.record.type}:${props.record.id}`} {...props} />
}

function RecordCommunicationsContent({
  record,
  recipientName,
  recipientEmail,
  recipientPhone,
  smsEnabled,
  smsSendable = true,
  smsDisabledReason,
  defaultChannel,
  onClientContact,
}: RecordCommunicationsCardProps) {
  const token = useAccessToken()
  const [channel, setChannel] = useState<ThreadChannelFilter>(
    defaultChannel && defaultChannel !== 'sms' ? defaultChannel : 'all',
  )
  const [messages, setMessages] = useState<SmsMessageRow[]>([])
  const [emails, setEmails] = useState<CommunicationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)

  const recordBase = `/api/admin/${record.type === 'matter' ? 'matters' : record.type === 'lead' ? 'leads' : 'contacts'}/${record.id}`

  const loadMessages = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setReadError(null)
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [smsResult, emailResult] = await Promise.allSettled([
        apiRequest<SmsMessageRow[]>(`${recordBase}/sms-messages`, { headers }),
        apiRequest<CommunicationItem[]>(`/api/admin/comms/email-history?type=${record.type}&id=${record.id}`, { headers }),
      ])
      if (smsResult.status === 'fulfilled') setMessages(Array.isArray(smsResult.value) ? smsResult.value : [])
      if (emailResult.status === 'fulfilled') setEmails(Array.isArray(emailResult.value) ? emailResult.value : [])
      if (smsResult.status === 'rejected' || emailResult.status === 'rejected') {
        setReadError(`${smsResult.status === 'rejected' ? 'SMS' : ''}${smsResult.status === 'rejected' && emailResult.status === 'rejected' ? ' and ' : ''}${emailResult.status === 'rejected' ? 'Email' : ''} history is unavailable. Please retry.`)
      }
    } catch {
      setReadError('Message history is unavailable. Please retry.')
    } finally {
      setLoading(false)
    }
  }, [token, recordBase, record.type, record.id])

  useEffect(() => {
    setLoading(true)
    void loadMessages()
  }, [loadMessages])

  const items: CommunicationItem[] = useMemo(() => mergeCommunicationItems(
    messages.map(m => ({
      id: m.id,
      channel: 'sms' as const,
      direction: m.direction === 'inbound' ? 'inbound' as const : 'outbound' as const,
      body: m.body,
      meta: m.status ?? null,
      sender: m.direction === 'inbound' ? recipientName : m.recipient_name ? `To ${m.recipient_name}` : 'Firm',
      created_at: m.created_at,
    })),
    emails,
  ), [messages, emails, recipientName])

  const chips: Array<{ key: ThreadChannelFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'sms', label: 'SMS history' },
    { key: 'email', label: 'Email' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {chips.map(chip => (
            <FilterChip key={chip.key} selected={channel === chip.key} onClick={() => setChannel(chip.key)}>
              {chip.label}
            </FilterChip>
          ))}
        </div>
        {recipientPhone && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => openExternalPhone({ number: recipientPhone })}
          >
            <Phone className="h-3.5 w-3.5" />
            Call {recipientName.split(' ')[0] || 'contact'}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Client messages: SMS history and recorded outbound email. Inbound email is not included. Internal notes are in Notes.</p>
      {readError && <p role="alert">{readError} <Button variant="link" onClick={() => void loadMessages()}>Retry history</Button></p>}
      <CommunicationThread
        items={items}
        loading={loading}
        recordType={record.type}
        recordLabel={recipientName}
        recipientName={recipientName}
        recipientPhone={recipientPhone}
        smsConfigured={smsEnabled}
        smsDisabledReason={smsSendable ? null : smsDisabledReason ?? 'Texting is not available for this contact.'}
        portalAvailable={false}
        channelFilter={channel}
        onSend={async () => false}
        emailComposer={recipientEmail ? (
          <div className="rounded-md border border-border">
            {/* A seed so the recipient shows at once — the composer fetches the
                matter's documents and extra addresses on top of it. */}
            <ManualEmailComposer
              embedded
              recordOverride={{ type: record.type, id: record.id }}
              initialContext={{
                recordType: record.type,
                recordId: record.id,
                recipientName,
                recipientEmail,
                spouseName: null,
                spouseEmail: null,
                alternateEmails: [],
                documents: [],
              }}
              onSent={async () => {
                toast.success('Email processed; see history for delivery status')
                await loadMessages()
                await onClientContact?.()
              }}
            />
          </div>
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">No email address on file.</p>
        )}
      />
    </div>
  )
}
