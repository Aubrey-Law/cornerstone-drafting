'use client'

import { useCallback, useRef, useEffect, useMemo, useState, useTransition } from 'react'
import { sendMessage, type Message } from './actions'
import { Button } from '@/components/ui/button'
import { ResizableTextarea } from '@/components/ui/drag-resize'
import { cn } from '@/lib/utils'
import { getFirmConfig } from '@/lib/firmConfig'
import { useMessagesRealtime, type RealtimeMessageRow } from '@/lib/messages/useMessagesRealtime'
import { linkifyText } from '@/lib/linkify'
import { Send } from 'lucide-react'

const firm = getFirmConfig()

interface Props {
  matterId: string
  messages: Message[]
  clientUserId: string
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase()
}

function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (calendarDayKey(date) === calendarDayKey(now)) return 'Today'

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (calendarDayKey(date) === calendarDayKey(yesterday)) return 'Yesterday'

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function groupMessagesByCalendarDay(messages: Message[]): Array<{
  dayKey: string
  messages: Message[]
}> {
  return messages.reduce<Array<{ dayKey: string; messages: Message[] }>>((groups, message) => {
    const dayKey = calendarDayKey(new Date(message.created_at))
    const current = groups[groups.length - 1]
    if (current?.dayKey === dayKey) {
      current.messages.push(message)
    } else {
      groups.push({ dayKey, messages: [message] })
    }
    return groups
  }, [])
}

export default function MessageThread({ matterId, messages: initial, clientUserId }: Props) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageGroups = useMemo(() => groupMessagesByCalendarDay(messages), [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Must be referentially stable: useMessagesRealtime re-subscribes whenever the
  // handler identity changes, so an inline arrow tore down and recreated the
  // websocket channel on every render — including every keystroke in the draft —
  // and inserts arriving during the gap were lost with no refetch.
  const handleRealtimeInsert = useCallback((message: RealtimeMessageRow) => {
    setMessages(prev => {
      if (prev.some(row => row.id === message.id)) return prev
      return [...prev, message as Message]
    })
  }, [])

  useMessagesRealtime(matterId, handleRealtimeInsert)

  function handleSend() {
    const trimmed = draft.trim()
    if (!trimmed || isPending) return
    setSendError(null)

    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      matter_id: matterId,
      sender_role: 'client',
      sender_id: clientUserId,
      body: trimmed,
      created_at: new Date().toISOString(),
      read_at: new Date().toISOString(),
    }

    setMessages(prev => [...prev, optimistic])
    setDraft('')

    startTransition(async () => {
      try {
        const saved = await sendMessage(matterId, trimmed)
        // The realtime echo of this same insert often arrives before the action
        // resolves (it commits mid-action, which then also sends a notification
        // email). Mapping the optimistic row onto `saved` in that case produced a
        // second bubble with a duplicate React key, so drop the placeholder and
        // only append when the echo has not already landed.
        setMessages(prev => {
          const withoutOptimistic = prev.filter(m => m.id !== optimistic.id)
          if (withoutOptimistic.some(m => m.id === saved.id)) return withoutOptimistic
          return [...withoutOptimistic, saved]
        })
      } catch (err) {
        console.error('Failed to send message:', err)
        setMessages(prev => prev.filter(m => m.id !== optimistic.id))
        setDraft(trimmed)
        setSendError('Message not sent. Please try again.')
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="min-h-full bg-background">
      <div
        data-testid="message-column"
        className="mx-auto flex min-h-full w-full max-w-3xl flex-col border-x border-border/60"
      >
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="text-base font-semibold text-foreground">Messages</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{firm.firmName}</p>
      </div>

      <div className="flex-1 space-y-5 px-4 py-6">
        {messages.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No messages yet. Send a message to {firm.firmName} below.
          </p>
        )}

        {messageGroups.map(group => (
          <div key={group.dayKey} className="space-y-5">
            <div
              role="separator"
              aria-label={formatDayLabel(group.messages[0].created_at)}
              className="flex items-center gap-3"
            >
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="text-[11px] font-medium text-muted-foreground">
                {formatDayLabel(group.messages[0].created_at)}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>

            {group.messages.map((message) => {
              const isClient = message.sender_id === clientUserId
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex flex-col gap-1',
                    isClient ? 'items-end' : 'items-start',
                  )}
                >
                  <span className="px-1 text-[11px] font-medium text-muted-foreground">
                    {isClient ? 'You' : firm.firmName}
                  </span>
                  <div
                    className={cn(
                      'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                      isClient
                        ? 'rounded-br-sm bg-primary text-primary-foreground'
                        : 'rounded-bl-sm bg-muted text-foreground',
                    )}
                  >
                    {linkifyText(message.body)}
                  </div>
                  <span className="px-1 text-[11px] text-muted-foreground">
                    {formatTime(message.created_at)}
                  </span>
                </div>
              )
            })}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background px-4 py-3">
        <div className="flex items-end gap-2">
          <ResizableTextarea
            handleLabel="Resize the message box"
            handleEdge="top"
            containerClassName="flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a message…"
            rows={2}
            className="resize-none text-base md:text-sm"
            disabled={isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!draft.trim() || isPending}
            size="icon"
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}+Enter to send
        </p>
        {sendError && (
          <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
            {sendError}
          </p>
        )}
      </div>
      </div>
    </div>
  )
}
