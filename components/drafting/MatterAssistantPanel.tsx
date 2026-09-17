'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Send, Sparkles, Square, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'
import { useConfirm } from '@/components/useConfirm'

interface MatterAssistantPanelProps {
  matterId: string
  documentIds?: string[]
  onClose?: () => void
}

interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  toolStatus?: string
  error?: string
}

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const part of parts) {
    if (!part.trim()) continue
    let event = 'message'
    let data = ''
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim()
      if (line.startsWith('data: ')) data = line.slice(6)
    }
    if (data) events.push({ event, data })
  }
  return { events, rest }
}

export function MatterAssistantPanel({ matterId, documentIds, onClose }: MatterAssistantPanelProps) {
  const { confirm, confirmDialog } = useConfirm()
  const token = useAccessToken()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadHistory = useCallback(async () => {
    if (!token) return
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assistant`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return
      setTurns(
        (body.turns ?? []).map((t: { role: string; content: string }) => ({
          role: t.role as 'user' | 'assistant',
          text: t.content,
        })),
      )
    } finally {
      setLoadingHistory(false)
    }
  }, [token, matterId])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    // Only follow the newest message when the reader is already at the bottom;
    // scrolling back during a stream used to be undone on the next delta.
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    if (distance > 160) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const clearHistory = async () => {
    if (!token || busy) return
    if (!(await confirm({
      title: 'Clear this matter’s assistant chat history?',
      body: 'The conversation is removed for everyone. Drafts and documents are not affected.',
      confirmLabel: 'Clear history',
      destructive: true,
    }))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assistant`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Could not clear history')
      setTurns([])
      toast.success('Chat cleared')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear chat')
    } finally {
      setBusy(false)
    }
  }

  const send = async (textOverride?: string) => {
    const message = (textOverride ?? input).trim()
    if (!token || !message || busy) return
    if (textOverride === undefined) setInput('')
    setTurns(prev => [
      ...prev,
      { role: 'user', text: message },
      { role: 'assistant', text: '', streaming: true },
    ])
    setBusy(true)
    let streamedText = ''
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assistant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ message, documentIds, stream: true }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Assistant failed')
      }

      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream') || !res.body) {
        const body = await res.json()
        setTurns(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', text: body.reply as string }
          return next
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseSseChunk(buffer)
        buffer = parsed.rest

        for (const evt of parsed.events) {
          if (evt.event === 'delta') {
            const payload = JSON.parse(evt.data) as { text?: string }
            if (payload.text) {
              streamedText += payload.text
              setTurns(prev => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') {
                  next[next.length - 1] = {
                    ...last,
                    text: last.text + payload.text,
                    streaming: true,
                  }
                }
                return next
              })
            }
          } else if (evt.event === 'tool') {
            const payload = JSON.parse(evt.data) as {
              phase?: 'start' | 'result'
              name?: string
              connector?: string
              ok?: boolean
            }
            setTurns(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role !== 'assistant') return prev
              let toolStatus = last.toolStatus ?? ''
              if (payload.phase === 'start' && payload.name) {
                toolStatus = `Calling ${payload.name}…`
              } else if (payload.phase === 'result') {
                toolStatus = payload.ok
                  ? `Used ${payload.connector ?? payload.name ?? 'tool'}`
                  : `Tool failed: ${payload.name ?? 'unknown'}`
              }
              next[next.length - 1] = { ...last, toolStatus }
              return next
            })
          } else if (evt.event === 'error') {
            const payload = JSON.parse(evt.data) as { message?: string }
            throw new Error(payload.message ?? 'Stream error')
          } else if (evt.event === 'done') {
            const payload = JSON.parse(evt.data) as {
              reply?: string
              toolsUsed?: Array<{ connector: string; tool: string; ok: boolean }>
            }
            setTurns(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') {
                next[next.length - 1] = {
                  role: 'assistant',
                  text: payload.reply ?? last.text,
                  streaming: false,
                }
              }
              return next
            })
            if (payload.toolsUsed && payload.toolsUsed.length > 0) {
              const names = payload.toolsUsed.map(t => `${t.connector}/${t.tool}`).join(', ')
              toast.message('MCP tools used', { description: names })
            }
          }
        }
      }

      setTurns(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          next[next.length - 1] = { ...last, streaming: false }
        }
        return next
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // User stopped generation: keep any partial text, drop an empty bubble.
        setTurns(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') {
            if (!streamedText) return next.slice(0, -1)
            next[next.length - 1] = { ...last, text: streamedText, streaming: false }
          }
          return next
        })
        return
      }
      const msg = e instanceof Error ? e.message : 'Assistant request failed'
      // Keep the user's message visible and mark the assistant turn as failed so
      // it can be retried, instead of silently dropping the pair.
      setTurns(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          next[next.length - 1] = { role: 'assistant', text: streamedText, streaming: false, error: msg }
        }
        return next
      })
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const retry = (turnIndex: number) => {
    const userTurn = turns[turnIndex - 1]
    if (!userTurn || userTurn.role !== 'user' || busy) return
    const message = userTurn.text
    setTurns(prev => prev.filter((_, i) => i !== turnIndex && i !== turnIndex - 1))
    void send(message)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {confirmDialog}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          Draft assistant
        </div>
        <div className="flex items-center gap-1">
          {turns.length > 0 ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={busy}
              onClick={() => void clearHistory()}
              aria-label="Clear chat history"
              title="Clear chat history"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onClose ? (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} aria-label="Close assistant">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loadingHistory ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
          </div>
        ) : turns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ask about fiduciaries, distribution ages, marker cleanup, or draft consistency. MCP connector
            tools are used automatically when configured in Settings.
          </p>
        ) : (
          turns.map((t, i) => (
            <div
              key={`${t.role}-${i}`}
              className={`rounded-md px-2.5 py-2 text-xs ${
                t.role === 'user' ? 'bg-secondary ml-6 whitespace-pre-wrap' : 'bg-muted mr-4'
              }`}
            >
              {t.toolStatus ? (
                <div className="mb-1 text-micro text-muted-foreground italic">{t.toolStatus}</div>
              ) : null}
              {t.role === 'assistant' ? <ChatMarkdown content={t.text} /> : t.text}
              {t.streaming ? (
                <span className="ml-0.5 inline-block animate-pulse text-muted-foreground">▍</span>
              ) : null}
              {t.role === 'assistant' && !t.streaming && t.text ? (
                <button
                  type="button"
                  aria-label="Copy message"
                  title="Copy message"
                  className="mt-1 inline-flex items-center gap-1 text-micro text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => {
                    void navigator.clipboard.writeText(t.text).then(() => {
                      setCopiedIndex(i)
                      window.setTimeout(() => setCopiedIndex(current => (current === i ? null : current)), 1500)
                    })
                  }}
                >
                  {copiedIndex === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedIndex === i ? 'Copied' : 'Copy'}
                </button>
              ) : null}
              {t.error ? (
                <div className="mt-1 flex items-center gap-2 text-micro text-destructive">
                  <span>{t.error}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-micro"
                    disabled={busy}
                    onClick={() => retry(i)}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-2">
        <textarea
          className="min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          placeholder="Ask the drafting assistant…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {busy ? (
          <Button
            size="icon"
            variant="outline"
            onClick={() => abortRef.current?.abort()}
            aria-label="Stop generating"
            title="Stop generating"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="icon" disabled={!input.trim()} onClick={() => void send()} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
