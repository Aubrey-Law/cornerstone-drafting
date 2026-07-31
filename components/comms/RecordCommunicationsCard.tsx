'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SetupBanner } from '@/components/SetupBanner'
import { CallList } from '@/components/calls/CallList'
import { ManualEmailComposer } from '@/components/rail/RailEmailPane'
import { openStaffSoftphone } from '@/app/admin/components/softphoneEvents'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

export interface CommsRecord {
  type: 'lead' | 'matter'
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
  defaultChannel?: 'sms' | 'email' | 'calls'
}

/**
 * SMS / email / call history for a lead or matter record, self-fetching so it
 * can drop into the lead Communications tab or the contact side panel. Matter
 * portal messages stay on the matter page — this covers the outward channels.
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
  defaultChannel = 'sms',
}: RecordCommunicationsCardProps) {
  const token = useAccessToken()
  const [channel, setChannel] = useState<'sms' | 'email' | 'calls'>(defaultChannel)
  const [messages, setMessages] = useState<SmsMessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const recordBase = record.type === 'matter'
    ? `/api/admin/matters/${record.id}`
    : `/api/admin/leads/${record.id}`

  const loadMessages = useCallback(async () => {
    if (!token) return
    try {
      const rows = await apiRequest<SmsMessageRow[]>(`${recordBase}/sms-messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setMessages(Array.isArray(rows) ? rows : [])
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [token, recordBase])

  useEffect(() => {
    setLoading(true)
    void loadMessages()
  }, [loadMessages])

  async function sendSms() {
    if (!token || !draft.trim()) return
    setSending(true)
    try {
      const body = record.type === 'matter'
        ? { recipient: smsRecipientRole, body: draft.trim() }
        : { body: draft.trim() }
      await apiRequest(`${recordBase}/send-sms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 'Could not send text')
      setDraft('')
      toast.success('Text sent')
      await loadMessages()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not send text')
    } finally {
      setSending(false)
    }
  }

  return (
    <Tabs value={channel} onValueChange={value => setChannel(value as typeof channel)} className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="sms">SMS</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="calls">Calls</TabsTrigger>
        </TabsList>
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

      <TabsContent value="sms" className="space-y-3">
        {!smsEnabled ? (
          <SetupBanner feature="SMS" detail="Configure the selected SMS provider in environment variables to text from here." />
        ) : (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : messages.length === 0 ? (
                <p className="text-xs text-muted-foreground">No texts yet.</p>
              ) : (
                messages.map(m => (
                  <div
                    key={m.id}
                    className={`rounded-md px-2.5 py-2 text-xs ${m.direction === 'inbound' ? 'bg-muted/50' : 'bg-primary/10'}`}
                  >
                    <div className="mb-0.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>
                        {m.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                        {m.recipient_name ? ` · ${m.recipient_name}` : ''}
                        {m.status ? ` · ${m.status}` : ''}
                      </span>
                      <span>{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))
              )}
            </div>
            {smsSendable ? (
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value.slice(0, MAX_SMS_BODY_LENGTH))}
                  placeholder={recipientPhone ? `Text ${recipientName}…` : 'No phone number on file'}
                  rows={2}
                  className="min-h-[60px] flex-1"
                  disabled={!recipientPhone && record.type === 'lead'}
                />
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  disabled={sending || !draft.trim()}
                  onClick={() => void sendSms()}
                >
                  Send SMS
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {smsDisabledReason ?? 'Texting is not available for this contact.'}
              </p>
            )}
          </>
        )}
      </TabsContent>

      <TabsContent value="email">
        {recipientEmail ? (
          <div className="rounded-md border border-border">
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
      </TabsContent>

      <TabsContent value="calls">
        {record.type === 'matter'
          ? <CallList matterId={record.id} limit={25} />
          : <CallList leadId={record.id} limit={25} />}
      </TabsContent>
    </Tabs>
  )
}
