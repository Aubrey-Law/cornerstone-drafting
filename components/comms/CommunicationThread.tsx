'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Lock, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { linkifyText } from '@/lib/linkify'
import {
  CHANNEL_LABEL,
  mergeCommunicationItems,
  type CommChannel,
  type CommunicationItem,
} from '@/lib/comms/thread'

export type ThreadChannelFilter = 'all' | 'portal' | 'sms' | 'email'

export interface CommunicationThreadProps {
  items: CommunicationItem[]
  loading?: boolean
  recordType: 'matter' | 'lead' | 'contact'
  /** What a send logs to, e.g. "EP-2026-0148" or the client's name. */
  recordLabel: string
  recipientName: string
  recipientPhone?: string | null
  smsConfigured: boolean
  /** When set, the SMS composer is replaced with this explanation. */
  smsDisabledReason?: string | null
  /** Set false on matter surfaces that cannot send portal messages. */
  portalAvailable?: boolean
  channelFilter?: ThreadChannelFilter
  sending?: boolean
  /** Sends on the locked channel; resolve false to keep the draft on error. */
  onSend: (channel: 'portal' | 'sms', body: string) => Promise<boolean>
  /** Rendered instead of the plain composer when the locked channel is email. */
  emailComposer?: ReactNode
  /** Slot for DraftWithAiButton so both surfaces keep their own wiring. */
  renderDraftAi?: (
    channel: 'portal' | 'sms',
    notes: string,
    onDraft: (value: string) => void,
  ) => ReactNode
  className?: string
}

const FILTER_CHANNEL: Record<Exclude<ThreadChannelFilter, 'all'>, CommChannel> = {
  portal: 'portal',
  sms: 'sms',
  email: 'email',
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Merged timeline over every channel plus the locked-channel composer. Both
 * the matter Communications tab and the firm inbox render this — data loading
 * and send endpoints stay with the caller.
 */
export function CommunicationThread({
  items,
  loading = false,
  recordType,
  recordLabel,
  recipientName,
  portalAvailable = true,
  channelFilter = 'all',
  sending = false,
  onSend,
  emailComposer,
  renderDraftAi,
  className,
}: CommunicationThreadProps) {
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLOListElement>(null)

  const merged = useMemo(() => mergeCommunicationItems(items), [items])
  const visible = useMemo(
    () => (channelFilter === 'all'
      ? merged
      : merged.filter(item => item.channel === FILTER_CHANNEL[channelFilter])),
    [merged, channelFilter],
  )

  // SMS is historical only. Matter replies use the secure portal; an email
  // view (or a lead/contact with no portal) uses the existing email composer.
  const replyChannel: 'portal' | 'email' = recordType === 'matter' && portalAvailable && channelFilter !== 'email'
    ? 'portal' : 'email'

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [visible.length])

  async function send() {
    if (replyChannel === 'email' || sending || !draft.trim()) return
    const sent = await onSend(replyChannel, draft.trim())
    if (sent) setDraft('')
  }

  const composer = (() => {
    if (replyChannel === 'email') {
      return emailComposer ?? (
        <p className="text-xs text-muted-foreground">No email address on file.</p>
      )
    }
    return (
      <div className="flex flex-wrap items-end gap-2">
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={`Message ${recipientName} in the portal…`}
          rows={2}
          className="min-h-[60px] min-w-40 flex-1"
          aria-label={`Reply by ${CHANNEL_LABEL[replyChannel].toLowerCase()}`}
        />
        {renderDraftAi?.(replyChannel, draft, setDraft)}
        <Button
          type="button"
          size="sm"
          className="min-h-11 shrink-0 md:min-h-8"
          disabled={sending || !draft.trim()}
          onClick={() => void send()}
        >
          <Send className="h-3.5 w-3.5" />
          Send
        </Button>
      </div>
    )
  })()

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <ol
        ref={logRef}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        className="max-h-96 min-h-24 flex-1 space-y-2 overflow-y-auto rounded-md border border-border p-3"
      >
        {loading ? (
          <li className="text-xs text-muted-foreground">Loading…</li>
        ) : visible.length === 0 ? (
          <li className="text-xs text-muted-foreground">
            {channelFilter === 'all' ? 'No messages yet.' : `No ${channelFilter} messages yet.`}
          </li>
        ) : (
          visible.map(item => (
            <li
              key={`${item.channel}-${item.id}`}
              className={cn(
                'rounded-md px-2.5 py-2 text-xs',
                item.direction === 'inbound' ? 'bg-muted/50' : 'bg-primary/10',
              )}
            >
              <div className="mb-0.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                <span>
                  {CHANNEL_LABEL[item.channel]}
                  {' · '}
                  {item.sender ?? (item.direction === 'inbound' ? recipientName : 'Firm')}
                  {item.meta ? ` · ${item.meta}` : ''}
                </span>
                <time dateTime={item.created_at}>{TIME_FORMAT.format(new Date(item.created_at))}</time>
              </div>
              <p className="whitespace-pre-wrap">{linkifyText(item.body)}</p>
            </li>
          ))
        )}
      </ol>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary">Reply by {CHANNEL_LABEL[replyChannel].toLowerCase()}</Badge>
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3" aria-hidden />
            {replyChannel === 'portal' ? 'Secure client portal' : 'Email correspondence'}
          </span>
          <span aria-hidden>·</span>
          <span>Logs to {recordLabel}</span>
        </div>
        {composer}
      </div>
    </div>
  )
}
