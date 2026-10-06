'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Lock, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { linkifyText } from '@/lib/linkify'
import { MAX_LEAD_SMS_BODY_LENGTH, MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
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
  draft?: string
  onDraftChange?: (draft: string) => void
  /**
   * Reads the full text of an item that carries only a preview (an inbound
   * email filed from Gmail). Without it the preview is all that shows.
   */
  loadFullMessage?: (item: CommunicationItem) => Promise<string>
}

type Expansion = { state: 'loading' } | { state: 'ready'; text: string } | { state: 'error'; message: string }

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
 * Merged timeline over every channel plus the locked-channel composer. Record-level communication views render this; data loading
 * and send endpoints stay with the caller.
 */
export function CommunicationThread({
  items,
  loading = false,
  recordType,
  recordLabel,
  recipientName,
  recipientPhone,
  smsConfigured,
  smsDisabledReason = null,
  portalAvailable = true,
  channelFilter = 'all',
  sending = false,
  onSend,
  emailComposer,
  renderDraftAi,
  className,
  draft: controlledDraft,
  onDraftChange,
  loadFullMessage,
}: CommunicationThreadProps) {
  const [localDraft, setLocalDraft] = useState('')
  const draft = controlledDraft ?? localDraft
  const setDraft = onDraftChange ?? setLocalDraft
  const logRef = useRef<HTMLOListElement>(null)
  const [expansions, setExpansions] = useState<Record<string, Expansion>>({})

  async function expand(item: CommunicationItem) {
    if (!loadFullMessage) return
    const key = `${item.channel}-${item.id}`
    setExpansions(current => ({ ...current, [key]: { state: 'loading' } }))
    try {
      const text = await loadFullMessage(item)
      setExpansions(current => ({ ...current, [key]: { state: 'ready', text } }))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The message could not be read.'
      setExpansions(current => ({ ...current, [key]: { state: 'error', message } }))
    }
  }

  const merged = useMemo(() => mergeCommunicationItems(items), [items])
  const visible = useMemo(
    () => (channelFilter === 'all'
      ? merged
      : merged.filter(item => item.channel === FILTER_CHANNEL[channelFilter])),
    [merged, channelFilter],
  )

  // The SMS filter always replies by text. Otherwise a thread whose latest
  // inbound message was a text replies by text when texting is on; matters
  // fall back to the secure portal, and leads and contacts to email.
  const lastInbound = [...merged].reverse().find(item => item.direction === 'inbound')
  const replyChannel: 'portal' | 'sms' | 'email' =
    channelFilter === 'sms' || (channelFilter === 'all' && smsConfigured && lastInbound?.channel === 'sms')
      ? 'sms'
      : recordType === 'matter' && portalAvailable && channelFilter !== 'email'
        ? 'portal'
        : 'email'
  // Matters text over the full length; leads and one-off contacts are held to
  // the shorter single-segment limit.
  const smsLimit = recordType === 'matter' ? MAX_SMS_BODY_LENGTH : MAX_LEAD_SMS_BODY_LENGTH

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [visible.length])

  async function send() {
    if (replyChannel === 'email' || sending || !draft.trim()) return
    const sent = await onSend(replyChannel, draft.trim())
    if (sent) setDraft('')
  }

  // A notice in place of the composer means nothing can be sent here, so the
  // "Reply by …" line above it would promise a reply that isn't on offer.
  const smsNotice = replyChannel === 'sms' && (!smsConfigured || Boolean(smsDisabledReason) || !recipientPhone)

  const composer = (() => {
    if (replyChannel === 'email') {
      return emailComposer ?? (
        <p className="text-xs text-muted-foreground">No email address on file.</p>
      )
    }
    if (replyChannel === 'sms' && !smsConfigured) {
      return <p className="text-xs text-muted-foreground">Texting is turned off. This is message history only.</p>
    }
    if (replyChannel === 'sms' && smsDisabledReason) {
      return <p className="text-xs text-muted-foreground">{smsDisabledReason}</p>
    }
    if (replyChannel === 'sms' && !recipientPhone) {
      return <p className="text-xs text-muted-foreground">No phone number on file for {recipientName}.</p>
    }
    return (
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={e => setDraft(
            replyChannel === 'sms' ? e.target.value.slice(0, smsLimit) : e.target.value,
          )}
          placeholder={replyChannel === 'sms' ? `Text ${recipientName}…` : `Message ${recipientName} in the portal…`}
          rows={2}
          className="min-h-[60px] w-full"
          aria-label={`Reply by ${CHANNEL_LABEL[replyChannel].toLowerCase()}`}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {replyChannel === 'sms' && (
            <p className="mr-auto text-micro text-muted-foreground">{draft.length}/{smsLimit}</p>
          )}
          {renderDraftAi?.(replyChannel, draft, value => setDraft(
            replyChannel === 'sms' ? value.slice(0, smsLimit) : value,
          ))}
          <Button
            type="button"
            size="sm"
            className="min-h-11 shrink-0 md:min-h-8"
            disabled={sending || !draft.trim() || (replyChannel === 'sms' && draft.length > smsLimit)}
            onClick={() => void send()}
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
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
            {channelFilter === 'all'
              ? 'No messages yet.'
              : `No ${CHANNEL_LABEL[FILTER_CHANNEL[channelFilter]].toLowerCase()} messages yet.`}
          </li>
        ) : (
          visible.map(item => {
            const key = `${item.channel}-${item.id}`
            const expansion = expansions[key]
            return (
              <li
                key={key}
                // Received on the left, sent on the right: the two fills alone
                // were too close in tone to tell the client from the firm.
                className={cn(
                  'rounded-md px-2.5 py-2 text-xs',
                  item.direction === 'inbound'
                    ? 'mr-6 bg-muted sm:mr-16'
                    : 'ml-6 border border-border bg-background sm:ml-16',
                )}
              >
                <div className="mb-0.5 flex justify-between gap-2 text-micro text-muted-foreground">
                  <span>
                    {CHANNEL_LABEL[item.channel]}
                    {' · '}
                    {item.sender ?? (item.direction === 'inbound' ? recipientName : 'Firm')}
                    {item.meta ? ` · ${item.meta}` : ''}
                  </span>
                  <time dateTime={item.created_at} className="shrink-0 whitespace-nowrap">{TIME_FORMAT.format(new Date(item.created_at))}</time>
                </div>
                <p className="whitespace-pre-wrap">
                  {linkifyText(expansion?.state === 'ready' ? expansion.text : item.body)}
                </p>
                {expansion?.state === 'error' && (
                  <p role="alert" className="mt-1 text-micro text-destructive">{expansion.message}</p>
                )}
                {(item.body_href || item.links?.length) ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro">
                    {item.body_href && loadFullMessage && expansion?.state !== 'ready' && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-micro"
                        disabled={expansion?.state === 'loading'}
                        onClick={() => void expand(item)}
                      >
                        {expansion?.state === 'loading' ? 'Reading…' : 'Read full message'}
                      </Button>
                    )}
                    {item.links?.map(link => (
                      <a
                        key={link.href}
                        href={link.href}
                        className="text-primary underline-offset-2 hover:underline"
                        {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })
        )}
      </ol>

      <div className="space-y-2">
        {!smsNotice && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
            <Badge variant="secondary">Reply by {CHANNEL_LABEL[replyChannel].toLowerCase()}</Badge>
            {replyChannel === 'portal' && (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" aria-hidden />
                Secure client portal
              </span>
            )}
            <span>Logs to {recordLabel}</span>
          </div>
        )}
        {composer}
      </div>
    </div>
  )
}
