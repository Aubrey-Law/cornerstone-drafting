'use client'

import { useState } from 'react'
import { Loader2, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'

interface MatterAssistantPanelProps {
  matterId: string
  documentIds?: string[]
  onClose?: () => void
}

interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export function MatterAssistantPanel({ matterId, documentIds, onClose }: MatterAssistantPanelProps) {
  const token = useAccessToken()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<ChatTurn[]>([])

  const send = async () => {
    if (!token || !input.trim() || busy) return
    const message = input.trim()
    setInput('')
    setTurns(prev => [...prev, { role: 'user', text: message }])
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assistant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, documentIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Assistant failed')
      setTurns(prev => [...prev, { role: 'assistant', text: body.reply as string }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Assistant request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          Draft assistant
        </div>
        {onClose ? (
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close assistant">
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ask about fiduciaries, distribution ages, marker cleanup, or draft consistency for this matter.
          </p>
        ) : (
          turns.map((t, i) => (
            <div
              key={`${t.role}-${i}`}
              className={`rounded-md px-2.5 py-2 text-xs whitespace-pre-wrap ${
                t.role === 'user' ? 'bg-accent/60 ml-6' : 'bg-muted mr-4'
              }`}
            >
              {t.text}
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
        <Button size="icon" disabled={busy || !input.trim()} onClick={() => void send()} aria-label="Send">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
