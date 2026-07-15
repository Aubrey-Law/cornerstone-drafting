'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'

function cacheKey() {
  return `cornerstone.dailyBrief.${new Date().toLocaleDateString('en-CA')}`
}

/**
 * AI daily briefing at the top of Today: one model call over the same pipeline
 * data the page already shows, cached per browser day so revisits are free.
 */
export function DailyBriefCard() {
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = sessionStorage.getItem(cacheKey())
        if (cached) {
          setBrief(cached)
          return
        }
      } catch { /* ignore */ }
    }
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/admin/daily-brief', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      const body = await response.json().catch(() => ({})) as { brief?: string; error?: string }
      if (!response.ok || !body.brief) throw new Error(body.error ?? 'Unable to generate briefing')
      setBrief(body.brief)
      try { sessionStorage.setItem(cacheKey(), body.brief) } catch { /* ignore */ }
    } catch (err) {
      setError((err as Error).message || 'Unable to generate briefing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void generate() }, [generate])

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">Daily briefing</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={loading}
          onClick={() => void generate(true)}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </header>
      <div className="px-4 py-3 text-sm">
        {loading && !brief ? (
          <p className="text-muted-foreground">Reading your pipeline…</p>
        ) : error ? (
          <p className="text-muted-foreground">{error}</p>
        ) : brief ? (
          <ChatMarkdown content={brief} />
        ) : null}
      </div>
    </section>
  )
}
