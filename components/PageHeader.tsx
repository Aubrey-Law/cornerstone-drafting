import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  /** Small uppercase label above the title (e.g. "Attorney tools"). */
  eyebrow?: string
  icon?: LucideIcon
  actions?: ReactNode
}

/** Shared page heading so admin pages keep one title scale and layout. */
export function PageHeader({ title, description, eyebrow, icon: Icon, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="flex items-center gap-2 text-muted-foreground">
            {Icon && <Icon className="h-4 w-4" />}
            <span className="text-xs font-medium uppercase tracking-wide">{eyebrow}</span>
          </div>
        )}
        <h1 className="admin-page-title mt-1 text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
