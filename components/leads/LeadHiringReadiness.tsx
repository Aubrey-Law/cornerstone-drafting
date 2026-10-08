'use client'

import { Button } from '@/components/ui/button'
import type { EvaluatedRequirement } from '@/lib/lifecycle/registry'

/** Presentation of existing lifecycle requirements; does not add conversion gates. */
export function LeadHiringReadiness({ requirements, busy, onResolve }: {
  requirements: EvaluatedRequirement[]
  busy: boolean
  onResolve: (requirement: EvaluatedRequirement) => void
}) {
  if (!requirements.length) return null
  function rows(items: EvaluatedRequirement[]) {
    return <ul className="space-y-3">{items.map(item => <li key={item.key} className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-sm">{item.label}</p><p className="text-xs text-muted-foreground">
        {item.owner === 'client' ? 'Client information or response' : item.owner === 'attorney' ? 'Attorney decision' : 'Firm follow-up'}
      </p></div>
      <Button variant="link" size="sm" className="h-auto shrink-0 p-0" disabled={busy}
        aria-label={`Review ${item.label}`} onClick={() => onResolve(item)}>Review</Button>
    </li>)}</ul>
  }
  return <section aria-label="Before hiring" className="space-y-3 border-b border-border pb-4">
    <h2 className="text-sm font-semibold">Before hiring · {requirements.length}</h2>
    {rows(requirements.slice(0, 3))}
    {requirements.length > 3 && <details><summary className="cursor-pointer text-xs text-muted-foreground">Show {requirements.length - 3} more</summary><div className="mt-3">{rows(requirements.slice(3))}</div></details>}
  </section>
}
