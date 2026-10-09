'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { mergeTargetHref, type MergeTarget } from '@/lib/matters/mergeTargets'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<string, string> = {
  lead: 'Lead',
  hired: 'Matter',
  lost: 'Lost lead',
  declined: 'Declined lead',
}

function targetLabel(target: MergeTarget): string {
  return [STATUS_LABEL[target.relationshipStatus] ?? target.relationshipStatus, target.matterNumber, target.email]
    .filter(Boolean)
    .join(' · ')
}

/** Turn `{"lead_notes.lead_id": 3}` into "3 lead notes". */
function describeRows(rows: Record<string, number>): string {
  const byTable = new Map<string, number>()
  for (const [key, count] of Object.entries(rows)) {
    const table = key.replace(/^public\./, '').split('.')[0].replace(/_/g, ' ')
    byTable.set(table, (byTable.get(table) ?? 0) + count)
  }
  return [...byTable].map(([table, count]) => `${count} ${table}`).join(', ')
}

/**
 * Merge this lead or matter into another one.
 *
 * The current record is the one that goes away: it is archived (never
 * deleted) and its notes, messages, documents, tasks and billing move onto the
 * record picked here.
 */
export function MergeRecordDialog({
  matterId,
  recordLabel,
  open,
  onOpenChange,
}: {
  /** The matter id of the record being merged away (a lead's matter id). */
  matterId: string
  /** "lead" or "matter", for the copy. */
  recordLabel: 'lead' | 'matter'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const token = useAccessToken()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<MergeTarget[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<MergeTarget | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery(''); setTargets([]); setSelected(null); setError(null)
    }
  }, [open])

  // With an empty box, the server proposes records sharing this client's email.
  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    const handle = window.setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/admin/matters/${matterId}/merge?q=${encodeURIComponent(query.trim())}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Search failed')
        if (!cancelled) { setTargets(json.targets ?? []); setError(null) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => { cancelled = true; window.clearTimeout(handle) }
  }, [open, token, matterId, query])

  async function merge() {
    if (!selected || !token || merging) return
    setMerging(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/merge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ intoMatterId: selected.id, reason: `Merged duplicate ${recordLabel}` }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Merge failed')
      const moved = describeRows(json.rowsMoved ?? {})
      const left = describeRows(json.rowsLeft ?? {})
      toast.success(`Merged into ${selected.name}`, {
        description: [
          moved ? `Moved ${moved}.` : 'Nothing needed moving.',
          left ? `Kept on the archived ${recordLabel}: ${left}.` : '',
        ].filter(Boolean).join(' '),
      })
      onOpenChange(false)
      router.push(mergeTargetHref(selected))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
      setMerging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!merging) onOpenChange(value) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge this {recordLabel} into another</DialogTitle>
          <DialogDescription>
            Pick the lead or matter to keep. This {recordLabel} is archived, not deleted, and its notes,
            messages, documents, tasks and billing move onto the one you keep.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          If either record uses a saved questionnaire version, both records must share the same intake
          to merge. Estate-planning and college-prep intakes cannot be merged.
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={event => { setQuery(event.target.value); setSelected(null) }}
            placeholder="Search by name, email or matter number"
            className="pl-8"
            aria-label="Search leads and matters"
          />
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label="Leads and matters">
          {searching && targets.length === 0 && (
            <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </p>
          )}
          {!searching && targets.length === 0 && (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {query.trim() ? 'No open leads or matters match.' : 'No other record shares this client’s email. Search above.'}
            </p>
          )}
          {targets.map(target => (
            <button
              key={target.id}
              type="button"
              role="option"
              aria-selected={selected?.id === target.id}
              onClick={() => setSelected(target)}
              className={cn(
                'flex w-full flex-col items-start rounded-md border px-3 py-2 text-left text-sm transition-colors',
                selected?.id === target.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
              )}
            >
              <span className="font-medium">{target.name}</span>
              <span className="text-xs text-muted-foreground">
                {targetLabel(target)}{target.createdAt ? ` · Opened ${target.createdAt.slice(0, 10)}` : ''}
              </span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="space-y-2 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
              This {recordLabel} <ArrowRight className="h-3.5 w-3.5" aria-label="merges into" /> {selected.name}
            </p>
            <p className="flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" />
              <span>
                The kept record’s design sheet, fiduciaries and details win. If it has no design sheet,
                this {recordLabel}’s moves over. Anything that would clash stays readable on the archived {recordLabel}.
              </span>
            </p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={merging}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void merge()} disabled={!selected || merging}>
            {merging ? 'Merging…' : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
