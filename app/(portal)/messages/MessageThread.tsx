'use client'

import { useCallback, useRef, useEffect, useMemo, useState, useTransition } from 'react'
import { sendMessage, loadOlderMessages, loadRecentMessages, acknowledgeMessages, type Message } from './actions'
import { Button } from '@/components/ui/button'
import { ResizableTextarea } from '@/components/ui/drag-resize'
import { cn } from '@/lib/utils'
import { getFirmConfig } from '@/lib/firmConfig'
import { useMessagesRealtime, type RealtimeMessageRow } from '@/lib/messages/useMessagesRealtime'
import { linkifyText } from '@/lib/linkify'
import { MessageSquare, Send } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PortalPageHeader } from '../PortalPageHeader'

import type { MessageCursor } from '@/lib/messages/history'

const firm = getFirmConfig()

interface Props {
  matterId: string
  messages: Message[]
  clientUserId: string
  older?: MessageCursor | null
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

export default function MessageThread({ matterId, messages: initial, clientUserId, older: initialOlder = null }: Props) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const [draft, setDraft] = useState('')
  const [older, setOlder] = useState(initialOlder)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [readRetry, setReadRetry] = useState(0)
  const acknowledged = useRef(new Set<string>())
  const loadingHistory = useRef(false)
  useEffect(() => {
    const ids = messages.filter(m => m.sender_role !== 'client' && !m.read_at && !acknowledged.current.has(m.id)).slice(0, 50).map(m => m.id)
    if (!ids.length) return
    ids.forEach(id => acknowledged.current.add(id))
    void acknowledgeMessages(matterId, ids).then(() => setReadError(null)).catch(() => {
      ids.forEach(id => acknowledged.current.delete(id))
      setReadError('Read status could not be saved.')
    })
  }, [messages, matterId, readRetry])
  async function loadOlder() {
    if (!older || loadingOlder) return
    setLoadingOlder(true); setHistoryError(null); loadingHistory.current = true
    try {
      const page = await loadOlderMessages(matterId, older)
      setMessages(current => [...page.messages.filter(row => !current.some(existing => existing.id === row.id)), ...current])
      setOlder(page.older)
    } catch { loadingHistory.current = false; setHistoryError('Older messages could not be loaded. Please retry.') }
    finally { setLoadingOlder(false) }
  }
  const [sendError, setSendError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageGroups = useMemo(() => groupMessagesByCalendarDay(messages), [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  useEffect(() => {
    if (loadingHistory.current) { loadingHistory.current = false; return }
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

  const handleRealtimeReconnect = useCallback(async () => {
    try {
      const page = await loadRecentMessages(matterId)
      setMessages(current => {
        const merged = new Map(current.map(message => [message.id, message]))
        for (const message of page.messages) merged.set(message.id, message)
        return [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      })
      setHistoryError(null)
    } catch {
      setHistoryError('Messages sent while reconnecting could not be loaded. Please retry.')
    }
  }, [matterId])

  useMessagesRealtime(matterId, handleRealtimeInsert, handleRealtimeReconnect)

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
        // resolves because the database commits before the response returns.
        // Mapping the optimistic row onto `saved` in that case produced a
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
    <div className="mx-auto flex h-full max-w-4xl flex-col px-4 py-8">
      <PortalPageHeader
        title="Messages"
        description={`A secure conversation with ${firm.firmName}.`}
      />
      <div
        data-testid="message-column"
        className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
      >
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
        {older && <Button variant="outline" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Loading…' : 'Load older messages'}</Button>}
        {historyError && <p role="alert">{historyError}</p>}
        {readError && <p role="alert">{readError} <button className="underline" onClick={() => setReadRetry(n => n + 1)}>Retry</button></p>}
        {messages.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            className="py-10"
            title="No messages yet"
            description={`Send a message to ${firm.firmName} below.`}
          />
        )}

        {messageGroups.map(group => (
          <div key={group.dayKey} className="space-y-5">
            <div
              role="separator"
              aria-label={formatDayLabel(group.messages[0].created_at)}
              className="flex items-center gap-3"
            >
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="text-micro font-medium text-muted-foreground">
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
                  <span className="px-1 text-micro font-medium text-muted-foreground">
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
                  <span className="px-1 text-micro text-muted-foreground">
                    {formatTime(message.created_at)}
                  </span>
                </div>
              )
            })}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border bg-card px-4 py-3">
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
            aria-label="Send message"
            onClick={handleSend}
            disabled={!draft.trim() || isPending}
            className="shrink-0 gap-1.5"
          >
            <Send className="h-4 w-4" />
            Send
          </Button>
        </div>
        <p className="mt-1.5 text-micro text-muted-foreground">
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
