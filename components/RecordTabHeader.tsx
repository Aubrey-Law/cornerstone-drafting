import type { ReactNode } from 'react'

/**
 * The top of every matter or lead tab but Overview: what the tab is, one line on what
 * it holds, and its actions — a view switch included — on the right. One
 * shape, so each tab starts in the same place and its controls are where the
 * last tab's were.
 */
export function RecordTabHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3" data-testid="record-tab-header">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
