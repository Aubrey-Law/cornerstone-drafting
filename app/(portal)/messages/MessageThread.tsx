'use client'

import { useRef, useEffect, useState, useTransition } from 'react'
import { sendMessage, type Message } from './actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getFirmConfig } from '@/lib/firmConfig'
import { useMessagesRealtime } from '@/lib/messages/useMessagesRealtime'
import { Send } from 'lucide-react'

const firm = getFirmConfig()

interface Props {
  matterId: string
  messages: Message[]
  clientUserId: string
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export default function MessageThread({ matterId, messages: initial, clientUserId }: Props) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useMessagesRealtime(matterId, message => {
    setMessages(prev => {
      if (prev.some(row => row.id === message.id)) return prev
      return [...prev, message as Message]
    })
  })

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
        setMessages(prev => prev.map(m => (m.id === optimistic.id ? saved : m)))
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
    <div className="flex min-h-full flex-col">
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

        {messages.map((message) => {
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
                {message.body}
              </div>
              <span className="px-1 text-[11px] text-muted-foreground">
                {formatTime(message.created_at)}
              </span>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background px-4 py-3">
        <div className="flex max-w-2xl items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a message…"
            rows={2}
            className="flex-1 resize-none text-sm"
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
  )
}
