'use client'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AttentionItem } from './types'

export function AttentionBand({
  items,
  onDismiss,
  compact = false,
}: {
  compact?: boolean
  items: AttentionItem[]
  onDismiss: (id: string) => void
}) {
  if (items.length === 0) return null
  const red = items.some(item => item.severity === 'red')
  return (
    <section
      className={cn(
        'rounded-lg border p-3',
        red ? 'border-red-strong-border bg-red-bg' : 'border-amber-strong-border bg-amber-bg',
      )}
    >
      <h2 className="text-sm font-semibold text-foreground">Needs you before your next meeting</h2>
      <div className={cn('mt-2 grid gap-2', !compact && 'lg:grid-cols-3')}>
        {items.slice(0, 6).map(item => (
          <article key={item.id} className="relative rounded-md border border-border bg-card p-3">
            <button
              type="button"
              aria-label={`Dismiss ${item.title}`}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              onClick={() => onDismiss(item.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <h3 className="pr-5 text-sm font-semibold text-foreground">{item.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.actions.slice(0, 2).map(action => action.href ? (
                <Button key={action.label} asChild size="sm" variant="outline">
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              ) : null)}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

