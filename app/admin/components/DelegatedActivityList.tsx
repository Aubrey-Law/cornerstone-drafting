'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { DelegatedActivityItem, ObservedActivityItem } from '@/lib/actions/delegation'

function when(iso: string) {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** The list half of the "Done for you" card: each delegated action with its undo. */
export function DelegatedActivityList({ done, observed }: { done: DelegatedActivityItem[]; observed: ObservedActivityItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState(done)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function undo(item: DelegatedActivityItem) {
    if (!item.executionId) return
    setUndoing(item.executionId)
    try {
      const res = await fetch(`/api/admin/actions/executions/${item.executionId}/undo`, { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not undo')
      setItems(current => current.map(entry => entry.executionId === item.executionId
        ? { ...entry, status: 'undone', undoneAt: new Date().toISOString(), undoable: false }
        : entry))
      toast.success(`Undone: ${item.summary}`)
      startTransition(() => router.refresh())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not undo')
    } finally {
      setUndoing(null)
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {items.length ? (
        <ul className="space-y-2">
          {items.map(item => (
            <li key={item.proposalId} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={item.status === 'undone' ? 'line-through opacity-60' : undefined}>
                  <span className="font-medium">{item.label}.</span> {item.summary}
                </p>
                <p className="text-xs text-muted-foreground">
                  {when(item.createdAt)}
                  {item.status === 'failed' ? ` · failed${item.errorSummary ? `: ${item.errorSummary}` : ''}` : ''}
                  {item.status === 'undone' ? ' · undone' : ''}
                  {item.href ? <> · <Link href={item.href} className="underline-offset-2 hover:underline">open record</Link></> : null}
                </p>
              </div>
              {item.undoable && item.executionId ? (
                <Button size="sm" variant="outline" onClick={() => void undo(item)} disabled={undoing === item.executionId}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden /> Undo
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {observed.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Would have done</p>
          <ul className="mt-1 space-y-1">
            {observed.map(item => (
              <li key={item.proposalId} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{item.label}.</span> {item.summary} · {when(item.createdAt)}
                {item.href ? <> · <Link href={item.href} className="underline-offset-2 hover:underline">open record</Link></> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
