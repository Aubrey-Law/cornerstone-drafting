'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/FilterChip'
import { ManualEmailComposer } from '@/components/rail/RailEmailPane'
import { DraftWithAiButton } from '@/components/matter/DraftWithAiButton'
import { openStaffSoftphone } from '@/app/admin/components/softphoneEvents'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { MAX_LEAD_SMS_BODY_LENGTH } from '@/lib/sms/constants'
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
}

/**
 * Merged SMS / email timeline for a lead or matter record, self-fetching
 * so it can drop into the lead Communications tab or the contact side panel.
 * Renders the shared `CommunicationThread` — the inbox and matter tab use the
 * same timeline and composer.
 */
export function RecordCommunicationsCard({
  record,
  recipientName,
  recipientEmail,
  recipientPhone,
  smsEnabled,
  smsRecipientRole = 'client',
  smsSendable = true,
  smsDisabledReason,
  defaultChannel,
}: RecordCommunicationsCardProps) {
  const token = useAccessToken()
  const [channel, setChannel] = useState<ThreadChannelFilter>(
    defaultChannel && defaultChannel !== 'sms' ? defaultChannel : 'all',
  )
  const [messages, setMessages] = useState<SmsMessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const recordBase = `/api/admin/${record.type === 'matter' ? 'matters' : record.type === 'lead' ? 'leads' : 'contacts'}/${record.id}`
  // AI drafting reads a lead or matter for context; a bare contact has none.
  const smsDraftRoute = record.type === 'lead' ? `/api/admin/leads/${record.id}/draft-reply` : undefined

  const loadMessages = useCallback(async () => {
    if (!token) return
    try {
      const smsRows = await apiRequest<SmsMessageRow[]>(`${recordBase}/sms-messages`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => [])
      setMessages(Array.isArray(smsRows) ? smsRows : [])
    } finally {
      setLoading(false)
    }
  }, [token, recordBase])

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
  ), [messages, recipientName])

  const sendSms = useCallback(async (_channel: 'portal' | 'sms', body: string): Promise<boolean> => {
    if (!token || !body.trim()) return false
    if (record.type !== 'matter' && body.length > MAX_LEAD_SMS_BODY_LENGTH) {
      toast.error(`Message must be ${MAX_LEAD_SMS_BODY_LENGTH} characters or fewer`)
      return false
    }
    setSending(true)
    try {
      const payload = record.type === 'matter'
        ? { recipient: smsRecipientRole, body: body.trim() }
        : { body: body.trim() }
      await apiRequest(`${recordBase}/send-sms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 'Could not send text')
      toast.success('Text sent')
      await loadMessages()
      return true
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not send text')
      return false
    } finally {
      setSending(false)
    }
  }, [token, record.type, smsRecipientRole, recordBase, loadMessages])

  const chips: Array<{ key: ThreadChannelFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'sms', label: 'SMS' },
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
            onClick={() => openStaffSoftphone({ number: recipientPhone })}
          >
            <Phone className="h-3.5 w-3.5" />
            Call {recipientName.split(' ')[0] || 'contact'}
          </Button>
        )}
      </div>

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
        sending={sending}
        onSend={sendSms}
        renderDraftAi={(replyChannel, notes, onDraft) => (
          record.type === 'matter' ? (
            <DraftWithAiButton matterId={record.id} channel={replyChannel} notes={notes} onDraft={onDraft} />
          ) : record.type === 'lead' ? (
            <DraftWithAiButton
              apiPath={smsDraftRoute}
              channel={replyChannel}
              notes={notes}
              maxChars={MAX_LEAD_SMS_BODY_LENGTH}
              onDraft={onDraft}
            />
          ) : null
        )}
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
              onSent={() => { toast.success('Email sent') }}
            />
          </div>
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">No email address on file.</p>
        )}
      />
    </div>
  )
}
