'use client'

import { Button } from '@/components/ui/button'
import type { NextAction } from '@/lib/leads/nextAction'

type LeadNextActionProps = {
  action: NextAction
  busy: boolean
  onIntent: (intent: string) => void
}

export function LeadNextAction({
  action,
  busy,
  onIntent,
}: LeadNextActionProps) {
  if (action.key === 'nothing') return null

  return (
    <section
      aria-label="Next action"
      className="flex flex-col gap-4 rounded-lg border border-primary/45 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        >
          1
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{action.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{action.detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        {action.actions.map(item => (
          <Button
            key={item.intent}
            type="button"
            size="sm"
            variant={item.kind === 'secondary' ? 'outline' : 'default'}
            disabled={busy}
            onClick={() => onIntent(item.intent)}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </section>
  )
}
