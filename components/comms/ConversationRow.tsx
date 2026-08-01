'use client'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  CHANNEL_LABEL,
  formatWaiting,
  formatWaitingLong,
  threadIsUnread,
  type InboxThread,
} from '@/lib/comms/thread'

interface ConversationRowProps {
  thread: InboxThread
  selected: boolean
  onSelect: () => void
}

const LAST_AT_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** One inbox list row. Purely presentational — the client owns selection. */
export function ConversationRow({ thread, selected, onSelect }: ConversationRowProps) {
  const unread = threadIsUnread(thread)
  const accessibleName = [
    thread.display_name,
    CHANNEL_LABEL[thread.last_channel].toLowerCase(),
    thread.waiting_since ? formatWaitingLong(thread.waiting_since) : null,
    unread ? 'unread' : null,
  ].filter(Boolean).join(', ')

  return (
    <li>
      <button
        type="button"
        id={`inbox-row-${thread.thread_key}`}
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={accessibleName}
        className={cn(
          'flex min-h-11 w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
          selected && 'bg-accent/60',
        )}
      >
        <span
          className={cn('mt-1.5 size-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
              {thread.display_name}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {thread.waiting_since
                ? formatWaiting(thread.waiting_since)
                : LAST_AT_FORMAT.format(new Date(thread.last_message_at))}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {CHANNEL_LABEL[thread.last_channel]}
            </Badge>
            {thread.matter_number && (
              <span className="truncate text-[11px] text-muted-foreground">{thread.matter_number}</span>
            )}
            {thread.record_type === 'lead' && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Lead</Badge>
            )}
            {unread && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                Unread{thread.unread_count > 0 ? ` · ${thread.unread_count}` : ''}
              </Badge>
            )}
          </span>
          {thread.last_preview && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {thread.last_direction === 'outbound' ? 'You: ' : ''}
              {thread.last_preview}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
