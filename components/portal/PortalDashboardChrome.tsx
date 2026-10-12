import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const calloutVariants = cva('rounded-xl border', {
  variants: {
    tone: {
      next: 'relative overflow-hidden border-blue-strong-border bg-gradient-to-br from-blue-bg via-blue-bg to-card p-5 shadow-sm',
      alert: 'border-red-strong-border bg-red-bg px-3 py-2.5 text-sm text-red',
      quiet: 'border-dashed border-border bg-muted px-3 py-3 text-sm text-muted-foreground',
    },
  },
})

export function PortalNextStep({
  message,
  action,
}: {
  message: string
  action?: ReactNode
}) {
  return (
    <section className={cn(calloutVariants({ tone: 'next' }), 'mt-6')} aria-labelledby="portal-next-step">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-blue-strong" />
      <p className="pl-2 text-xs font-semibold uppercase tracking-[0.08em] text-blue-strong">Next step</p>
      <h2 id="portal-next-step" className="mt-1 pl-2 text-base font-semibold tracking-tight text-foreground">
        What&apos;s next
      </h2>
      <p className="mt-1.5 pl-2 text-sm leading-relaxed text-foreground/80">{message}</p>
      {action ? <div className="mt-4 pl-2">{action}</div> : null}
    </section>
  )
}

export function PortalUnavailable({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={cn(calloutVariants({ tone: 'alert' }), 'mt-3')}>
      {children}
    </p>
  )
}

export function PortalQuietNote({ children }: { children: ReactNode }) {
  return <p className={cn(calloutVariants({ tone: 'quiet' }), 'mt-3')}>{children}</p>
}

export function PortalFact({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon
  title: string
  detail?: string | null
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-md px-2 py-1.5 -mx-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{title}</p>
        {detail ? <p className="text-xs leading-snug text-muted-foreground">{detail}</p> : null}
      </div>
    </li>
  )
}
