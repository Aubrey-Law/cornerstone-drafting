'use client'

import { useEffect, useState } from 'react'
import { Briefcase, ChevronDown, Globe, UserRound } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** What a chat is pointed at. Mirrors assistant_chats.context_type. */
export type AssistantContext =
  | { type: 'general' }
  | { type: 'matter' | 'lead'; id: string; label: string }

interface RecordMatch {
  id: string
  type: 'matter' | 'lead'
  label: string
  matter_number: string | null
  client_name: string | null
  client_email: string | null
}

interface AssistantContextPickerProps {
  context: AssistantContext
  onChange: (context: AssistantContext) => void
  disabled?: boolean
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export function contextLabel(context: AssistantContext) {
  return context.type === 'general' ? 'General' : context.label
}

/**
 * Lets the attorney say which matter or lead a chat is about.
 *
 * Every Assistant-page chat used to be general, because nothing offered a
 * choice; the matter prompt, the design-sheet tools and the matter-scoped
 * workflows all sat unused there. The search is the assistant's own record
 * search, so the picker and the model resolve a name the same way.
 */
export function AssistantContextPicker({ context, onChange, disabled }: AssistantContextPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<RecordMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const term = query.trim()
    if (term.length < 2) {
      setMatches([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      setError(null)
      try {
        const response = await fetch(`/api/admin/assistant/records?query=${encodeURIComponent(term)}`, {
          headers: await authHeaders(),
          cache: 'no-store',
        })
        const body = await response.json().catch(() => ({})) as { records?: RecordMatch[]; error?: string }
        if (cancelled) return
        if (response.ok) setMatches(body.records ?? [])
        else setError(body.error ?? 'Search failed')
      } catch {
        if (!cancelled) setError('Search failed')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query])

  function pick(next: AssistantContext) {
    onChange(next)
    setOpen(false)
    setQuery('')
    setMatches([])
  }

  const Icon = context.type === 'general' ? Globe : context.type === 'lead' ? UserRound : Briefcase

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Which matter or lead this chat is about"
        className="max-w-72 gap-1.5"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{contextLabel(context)}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>What is this chat about?</DialogTitle>
            <DialogDescription>
              Point the chat at a matter or lead and the assistant loads that record — intake, design sheet, notes — before answering.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search clients, matters, or emails…"
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {error && <p className="p-3 text-sm text-destructive">{error}</p>}
            {!error && searching && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
            {!error && !searching && query.trim().length >= 2 && matches.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No matters or leads match.</p>
            )}
            {!error && matches.length > 0 && (
              <ul className="divide-y divide-border">
                {matches.map(match => (
                  <li key={match.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => pick({ type: match.type, id: match.id, label: match.label })}
                    >
                      {match.type === 'lead'
                        ? <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        : <Briefcase className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{match.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[match.type === 'lead' ? 'Lead' : match.matter_number ? `#${match.matter_number}` : 'Matter', match.client_name, match.client_email]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={context.type === 'general'}
              onClick={() => pick({ type: 'general' })}
            >
              <Globe className="h-3.5 w-3.5" /> General chat
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
