'use client'

import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SetupBanner } from '@/components/SetupBanner'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import type { CommunicationChannel } from '@/lib/matterPageTabs'
import { CallsSection } from './calls'

type PortalMessage = {
  id: string
  body: string
  sender_role: string
  created_at: string
  read_at: string | null
}

type SmsMessage = {
  id: string
  direction: string
  recipient_role: string | null
  recipient_name: string | null
  body: string
  status: string
  created_at: string
}

export interface MatterMessagesSectionsProps {
  portalMessages: PortalMessage[]
  portalLoading: boolean
  portalDraft: string
  portalSending: boolean
  smsMessages: SmsMessage[]
  smsLoading: boolean
  smsDraft: string
  smsRecipient: 'client' | 'spouse'
  smsSending: boolean
  emailTo: string
  emailSubject: string
  emailBody: string
  emailSending: boolean
  twilioSmsEnabled: boolean
  emailSendEnabled: boolean
  setPortalDraft: (value: string) => void
  setSmsDraft: (value: string) => void
  setSmsRecipient: (value: 'client' | 'spouse') => void
  setEmailTo: (value: string) => void
  setEmailSubject: (value: string) => void
  setEmailBody: (value: string) => void
  onSendPortal: () => void
  onSendSms: () => void
  onSendEmail: () => void
}

export function PortalMessagesSection({
  portalMessages,
  portalLoading,
  portalDraft,
  portalSending,
  setPortalDraft,
  onSendPortal,
}: Pick<
  MatterMessagesSectionsProps,
  'portalMessages' | 'portalLoading' | 'portalDraft' | 'portalSending' | 'setPortalDraft' | 'onSendPortal'
>) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Portal messages</h3>
        <p className="text-xs text-muted-foreground">In-app thread with the client portal.</p>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
        {portalLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : portalMessages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No portal messages yet.</p>
        ) : (
          portalMessages.map(m => (
            <div
              key={m.id}
              className={`rounded-md px-2.5 py-2 text-xs ${m.sender_role === 'client' ? 'bg-muted/50' : 'bg-primary/10'}`}
            >
              <div className="mb-0.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                <span className="capitalize">{m.sender_role}</span>
                <span>{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={portalDraft}
          onChange={e => setPortalDraft(e.target.value)}
          placeholder="Write a portal message…"
          rows={2}
          className="min-h-[60px]"
        />
        <Button
          type="button"
          size="sm"
          className="shrink-0 self-end"
          disabled={portalSending || !portalDraft.trim()}
          onClick={onSendPortal}
        >
          <Send className="h-3.5 w-3.5" />
          Send
        </Button>
      </div>
    </section>
  )
}

export function SmsMessagesSection({
  smsMessages,
  smsLoading,
  smsDraft,
  smsRecipient,
  smsSending,
  twilioSmsEnabled,
  setSmsDraft,
  setSmsRecipient,
  onSendSms,
}: Pick<
  MatterMessagesSectionsProps,
  | 'smsMessages'
  | 'smsLoading'
  | 'smsDraft'
  | 'smsRecipient'
  | 'smsSending'
  | 'twilioSmsEnabled'
  | 'setSmsDraft'
  | 'setSmsRecipient'
  | 'onSendSms'
>) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">SMS</h3>
        <p className="text-xs text-muted-foreground">Text thread with the client or spouse.</p>
      </div>
      {!twilioSmsEnabled ? (
        <SetupBanner feature="SMS" detail="Add Twilio credentials in environment variables to text clients from this tab." />
      ) : (
        <>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
            {smsLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : smsMessages.length === 0 ? (
              <p className="text-xs text-muted-foreground">No texts yet.</p>
            ) : (
              smsMessages.map(m => (
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
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-36">
              <Label className="text-[11px]">To</Label>
              <Select value={smsRecipient} onValueChange={v => setSmsRecipient(v as 'client' | 'spouse')}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="spouse">Spouse</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={smsDraft}
              onChange={e => setSmsDraft(e.target.value.slice(0, MAX_SMS_BODY_LENGTH))}
              placeholder="Text message…"
              rows={2}
              className="min-h-[60px] flex-1"
            />
            <Button type="button" size="sm" className="shrink-0" disabled={smsSending || !smsDraft.trim()} onClick={onSendSms}>
              Send SMS
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

export function EmailMessagesSection({
  emailTo,
  emailSubject,
  emailBody,
  emailSending,
  emailSendEnabled,
  setEmailTo,
  setEmailSubject,
  setEmailBody,
  onSendEmail,
}: Pick<
  MatterMessagesSectionsProps,
  | 'emailTo'
  | 'emailSubject'
  | 'emailBody'
  | 'emailSending'
  | 'emailSendEnabled'
  | 'setEmailTo'
  | 'setEmailSubject'
  | 'setEmailBody'
  | 'onSendEmail'
>) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Email</h3>
        <p className="text-xs text-muted-foreground">Sends via Outlook when connected; otherwise Resend.</p>
      </div>
      {!emailSendEnabled ? (
        <SetupBanner feature="Email" detail="Connect Outlook in Settings or configure Resend to send from this tab." />
      ) : (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="email-to" className="text-[11px]">To</Label>
              <Input id="email-to" type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="email-subject" className="text-[11px]">Subject</Label>
              <Input id="email-subject" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
            </div>
          </div>
          <Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} placeholder="Plain-text email body…" rows={5} />
          <Button
            type="button"
            size="sm"
            disabled={emailSending || !emailTo.trim() || !emailSubject.trim() || !emailBody.trim()}
            onClick={onSendEmail}
          >
            {emailSending ? 'Sending…' : 'Send email'}
          </Button>
        </div>
      )}
    </section>
  )
}

export interface MatterCommunicationsTabProps extends MatterMessagesSectionsProps {
  matterId: string
  channel: CommunicationChannel
  onChannelChange: (channel: CommunicationChannel) => void
}

export function MatterCommunicationsTab({
  matterId,
  channel,
  onChannelChange,
  ...messageProps
}: MatterCommunicationsTabProps) {
  return (
    <TabsContent value="communications" className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Communications</h3>
        <p className="text-xs text-muted-foreground">
          Portal messages, SMS, email, and logged calls for this matter.
        </p>
      </div>
      <Tabs value={channel} onValueChange={v => onChannelChange(v as CommunicationChannel)} className="gap-4">
        <TabsList>
          <TabsTrigger value="portal">Portal</TabsTrigger>
          <TabsTrigger value="sms">SMS</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="calls">Calls</TabsTrigger>
        </TabsList>
        <TabsContent value="portal">
          <PortalMessagesSection {...messageProps} />
        </TabsContent>
        <TabsContent value="sms">
          <SmsMessagesSection {...messageProps} />
        </TabsContent>
        <TabsContent value="email">
          <EmailMessagesSection {...messageProps} />
        </TabsContent>
        <TabsContent value="calls">
          <CallsSection matterId={matterId} />
        </TabsContent>
      </Tabs>
    </TabsContent>
  )
}

// Legacy export kept for any external references
export type MatterMessagesTabProps = MatterMessagesSectionsProps

export function MatterMessagesTab(props: MatterMessagesSectionsProps) {
  return (
    <div className="space-y-8">
      <PortalMessagesSection {...props} />
      <SmsMessagesSection {...props} />
      <EmailMessagesSection {...props} />
    </div>
  )
}
