'use client'

import { useActionState, useOptimistic } from 'react'
import { Button } from '@/components/ui/button'
import type { Importance, ScanDisposition, StoredScanItem } from '@/lib/review/scans'
import { recordScanDisposition } from './actions'
import { Badge } from '@/components/ui/badge'
import { TONE_BADGE, TONE_NOTICE, type Tone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

const IMPORTANCE_LABEL: Record<Importance, string> = { important: 'Important', notable: 'Notable', minor: 'Minor' }
const IMPORTANCE_TONE: Record<Importance, Tone> = {
  important: 'danger',
  notable: 'warning',
  minor: 'neutral',
}

/** `open` is no decision, so it is no button pressed rather than a fourth choice. */
const DECISIONS: Array<{ value: Exclude<ScanDisposition, 'open'>; label: string }> = [
  { value: 'accepted', label: 'Accept' },
  { value: 'rejected', label: 'Reject' },
  { value: 'deferred', label: 'Defer' },
]

/**
 * A saved check's items, each with the attorney's decision on it — made here
 * or in Word, where accepting or rejecting the tracked change records it too.
 * An item whose quote was not found in the document says so rather than
 * pointing anywhere.
 */
export function ScanItemsList({ scanId, items }: { scanId: string; items: StoredScanItem[] }) {
  const [state, submit] = useActionState(recordScanDisposition, { message: null })
  // Shown at once, so a decision does not look ignored during the round trip.
  const [optimistic, setOptimistic] = useOptimistic(
    Object.fromEntries(items.map(item => [item.id, item.disposition])) as Record<string, ScanDisposition>,
  )

  const decide = (item: StoredScanItem, value: Exclude<ScanDisposition, 'open'>) => {
    // Clicking the recorded decision again reopens it.
    const next: ScanDisposition = optimistic[item.id] === value ? 'open' : value
    const form = new FormData()
    form.set('itemId', item.id)
    form.set('scanId', scanId)
    form.set('disposition', next)
    setOptimistic({ ...optimistic, [item.id]: next })
    submit(form)
  }

  const decided = Object.values(optimistic).filter(d => d !== 'open').length

  return (
    <>
      {state.message ? (
        <p role="alert" className={cn('mx-4 mt-4', TONE_NOTICE.danger)}>
          {state.message}
        </p>
      ) : null}
      <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="scan-decided">
        {decided} of {items.length} decided
      </p>
      <ul className="divide-y divide-border" data-testid="scan-items">
        {items.map(item => (
          <li key={item.id} className="space-y-1.5 px-4 py-4">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{item.category}</span>
              <Badge variant="outline" className={cn('text-micro', TONE_BADGE[IMPORTANCE_TONE[item.importance]])}>
                {IMPORTANCE_LABEL[item.importance]}
              </Badge>
              {item.citation ? <span>¶ {item.citation.blockIndex}</span> : null}
            </p>
            <p className="font-medium">{item.title}</p>
            {item.explanation ? <p className="text-sm">{item.explanation}</p> : null}
            {item.citation ? (
              <blockquote className="border-l-2 border-border pl-3 font-serif text-sm text-muted-foreground">
                {item.citation.quote}
              </blockquote>
            ) : item.attemptedQuote ? (
              <p className="text-xs text-muted-foreground">
                The passage this item quoted was not found in the document: “{item.attemptedQuote}”. Check it by hand.
              </p>
            ) : null}
            {item.replacement ? (
              <p className="text-sm">
                <span className="text-xs font-medium text-muted-foreground">Suggested: </span>
                <span className="font-serif">{item.replacement}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1 pt-1">
              {DECISIONS.map(({ value, label }) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={optimistic[item.id] === value ? 'default' : 'ghost'}
                  aria-pressed={optimistic[item.id] === value}
                  onClick={() => decide(item, value)}
                >
                  {label}
                </Button>
              ))}
              {item.dispositionNote && optimistic[item.id] === item.disposition ? (
                <span className="text-xs text-muted-foreground">{item.dispositionNote}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
