'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, RefreshCw, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { firmTodayKey } from '@/lib/firmDate'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'

function cacheKey() {
  return `cornerstone.dailyBrief.${firmTodayKey()}`
}

function firstLine(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim()
    if (line) return line
  }
  return markdown
}

/**
 * AI daily briefing in the Today rail: one model call over the same pipeline
 * data the page already shows, cached per firm day in localStorage so a second
 * tab (or a reload) doesn't re-bill the model.
 */
export function DailyBriefCard() {
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const generate = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = localStorage.getItem(cacheKey())
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
      try { localStorage.setItem(cacheKey(), body.brief) } catch { /* ignore */ }
    } catch (err) {
      setError((err as Error).message || 'Unable to generate briefing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void generate() }, [generate])

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
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
      <div className="px-3 py-2.5 text-sm">
        {loading && !brief ? (
          <p className="text-muted-foreground">Reading your pipeline…</p>
        ) : error ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void generate(true)}>
              Retry
            </Button>
          </div>
        ) : brief ? (
          <div>
            {expanded ? <ChatMarkdown content={brief} /> : (
              <p className="truncate text-muted-foreground">{firstLine(brief)}</p>
            )}
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(prev => !prev)}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden />
              {expanded ? 'Show less' : 'Show more'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
