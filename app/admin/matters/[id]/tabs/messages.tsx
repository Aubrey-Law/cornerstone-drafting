'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResizableTextarea } from '@/components/ui/drag-resize'
import { TabsContent } from '@/components/ui/tabs'
import { FilterChip } from '@/components/FilterChip'
import { SetupBanner } from '@/components/SetupBanner'
import { DraftWithAiButton } from '@/components/matter/DraftWithAiButton'
import { CommunicationThread } from '@/components/comms/CommunicationThread'
import type { CommunicationItem } from '@/lib/comms/thread'
import type { CommunicationChannel } from '@/lib/matterPageTabs'

export interface SchedulingActionsProps {
  onSendSchedulingLink: () => void
  onBookForClient: () => void
}

export interface MatterMessagesSectionsProps {
  portalDraft?: string
  setPortalDraft?: (draft: string) => void
  portalLoading: boolean
  smsLoading: boolean
  smsRecipient: 'client' | 'spouse'
  portalSending: boolean
  smsSending: boolean
  emailTo: string
  emailSubject: string
  emailBody: string
  emailSending: boolean
  smsEnabled: boolean
  emailSendEnabled: boolean
  setSmsRecipient: (value: 'client' | 'spouse') => void
  setEmailTo: (value: string) => void
  setEmailSubject: (value: string) => void
  setEmailBody: (value: string) => void
  onSendEmail: () => void
}

export function EmailMessagesSection({
  matterId,
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
> & { matterId?: string }) {
  // "Subject: ..." first line from the AI draft fills the subject field.
  function applyEmailDraft(draft: string) {
    const match = draft.match(/^Subject:\s*(.+)\n+([\s\S]*)$/)
    if (match) {
      setEmailSubject(match[1].trim())
      setEmailBody(match[2].trim())
    } else {
      setEmailBody(draft.trim())
    }
  }
  return (
    <section className="space-y-3">
      {!emailSendEnabled ? (
        <SetupBanner feature="Email" detail="Connect Outlook in Settings or configure Resend to send from this tab." />
      ) : (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="email-to" className="text-micro">To</Label>
              <Input id="email-to" type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="email-subject" className="text-micro">Subject</Label>
              <Input id="email-subject" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
            </div>
          </div>
          <ResizableTextarea
            handleLabel="Resize email body"
            value={emailBody}
            onChange={e => setEmailBody(e.target.value)}
            placeholder="Plain-text email body…"
            rows={5}
          />
          <div className="flex flex-wrap gap-2">
            {matterId && (
              <DraftWithAiButton matterId={matterId} channel="email" notes={emailBody} onDraft={applyEmailDraft} />
            )}
            <Button
              type="button"
              size="sm"
              disabled={emailSending || !emailTo.trim() || !emailSubject.trim() || !emailBody.trim()}
              onClick={onSendEmail}
            >
              {emailSending ? 'Sending…' : 'Send email'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

const CHANNEL_CHIPS: Array<{ key: CommunicationChannel; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'portal', label: 'Portal' },
  { key: 'sms', label: 'SMS history' },
  { key: 'email', label: 'Email' },
]

export interface MatterCommunicationsTabProps extends MatterMessagesSectionsProps, SchedulingActionsProps {
  matterId: string
  channel: CommunicationChannel
  onChannelChange: (channel: CommunicationChannel) => void
  items: CommunicationItem[]
  clientName: string
  clientPhone: string | null
  /** What sends log to — matter number when assigned, else the client name. */
  recordLabel: string
  onSendOnChannel: (channel: 'portal' | 'sms', body: string) => Promise<boolean>
}

export function MatterCommunicationsTab({
  matterId,
  channel,
  onChannelChange,
  onSendSchedulingLink,
  onBookForClient,
  items,
  clientName,
  clientPhone,
  recordLabel,
  onSendOnChannel,
  ...messageProps
}: MatterCommunicationsTabProps) {
  const {
    portalLoading,
    smsLoading,
    portalSending,
    smsSending,
    smsEnabled,
  } = messageProps

  return (
    <TabsContent value="communications" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Portal messages</h3>
          <p className="text-xs text-muted-foreground">
            Secure portal messages and correspondence history for this matter.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onSendSchedulingLink}>
            Send scheduling link
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onBookForClient}>
            Book for client…
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {CHANNEL_CHIPS.map(chip => (
            <FilterChip
              key={chip.key}
              selected={channel === chip.key}
              onClick={() => onChannelChange(chip.key)}
            >
              {chip.label}
            </FilterChip>
          ))}
        </div>

      </div>

      <CommunicationThread
        draft={messageProps.portalDraft}
        onDraftChange={messageProps.setPortalDraft}
        items={items}
        loading={portalLoading || smsLoading}
        recordType="matter"
        recordLabel={recordLabel}
        recipientName={clientName}
        recipientPhone={clientPhone}
        smsConfigured={smsEnabled}
        channelFilter={channel}
        sending={portalSending || smsSending}
        onSend={onSendOnChannel}
        emailComposer={<EmailMessagesSection matterId={matterId} {...messageProps} />}
        renderDraftAi={(replyChannel, notes, onDraft) => (
          <DraftWithAiButton
            matterId={matterId}
            channel={replyChannel}
            notes={notes}
            onDraft={onDraft}
          />
        )}
      />
    </TabsContent>
  )
}
