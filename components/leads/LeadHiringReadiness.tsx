'use client'

import { Button } from '@/components/ui/button'
import type { EvaluatedRequirement } from '@/lib/lifecycle/registry'

/**
 * Presentation of existing lifecycle requirements; does not add conversion
 * gates. Drawn as the matter page's prep checklist inside the next-action card.
 */
export function LeadHiringReadiness({ requirements, busy, onResolve }: {
  requirements: EvaluatedRequirement[]
  busy: boolean
  onResolve: (requirement: EvaluatedRequirement) => void
}) {
  if (!requirements.length) return null
  return <section aria-label="Before hiring" className="mt-4">
    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Before hiring · {requirements.length}</h3>
    <ul className="divide-y rounded-lg border">
      {requirements.map(item => <li key={item.key} className="flex items-center gap-3 px-3.5 py-2.5">
        <span aria-hidden className="size-4 shrink-0 rounded-sm border-[1.5px] border-input" />
        <div className="min-w-0 flex-1">
          <p>{item.label}</p>
          <p className="text-xs text-muted-foreground">
            {item.owner === 'client' ? 'Client information or response' : item.owner === 'attorney' ? 'Attorney decision' : 'Firm follow-up'}
          </p>
        </div>
        <Button variant="link" className="h-auto shrink-0 p-0" disabled={busy}
          aria-label={`Review ${item.label}`} onClick={() => onResolve(item)}>Review</Button>
      </li>)}
    </ul>
  </section>
}
