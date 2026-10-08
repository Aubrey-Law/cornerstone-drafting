'use client'

import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { NextAction } from '@/lib/leads/nextAction'

/** The matter page's next-action card shell: eyebrow, chips, title, detail, checklist, buttons. */
export function LeadNextActionCard({ eyebrow, chips, title, detail, children, actions, status = false }: {
  eyebrow: string
  chips?: ReactNode
  title: ReactNode
  detail?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  /** Announce changes (the computed action updates as the lead moves). */
  status?: boolean
}) {
  return (
    <section aria-label="Next action" role={status ? 'status' : undefined} className="rounded-lg border bg-card px-6 py-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-selected-border" />
        {eyebrow}
      </div>
      {chips && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{chips}</div>}
      <h2 className="mt-1.5 text-xl font-semibold tracking-tight">{title}</h2>
      {detail && <p className="mt-1 text-muted-foreground">{detail}</p>}
      {children}
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </section>
  )
}

type LeadNextActionProps = {
  action: NextAction
  busy: boolean
  context?: string
  urgency?: string
  onIntent: (intent: string) => void
  /** The Before hiring checklist, under the detail. */
  children?: ReactNode
}

export function LeadNextAction({
  action,
  busy,
  context,
  urgency,
  onIntent,
  children,
}: LeadNextActionProps) {
  if (action.key === 'nothing') return null

  return (
    <LeadNextActionCard
      status
      eyebrow="Next for the firm"
      chips={<>
        <Badge variant="outline" className="rounded-sm font-medium">Ready to work</Badge>
        {urgency && <span>{urgency}</span>}
        <span>· Owner: Firm</span>
        {context && <span>· {context}</span>}
      </>}
      title={action.title}
      detail={action.detail}
      actions={action.actions.map((item, index) => (
        <Button
          key={item.intent}
          type="button"
          variant={item.kind === 'secondary' ? 'outline' : 'default'}
          disabled={busy}
          onClick={() => onIntent(item.intent)}
        >
          {item.label}
          {index === 0 && item.kind !== 'secondary' && <ArrowRight aria-hidden className="size-3.5" />}
        </Button>
      ))}
    >
      {children}
    </LeadNextActionCard>
  )
}
