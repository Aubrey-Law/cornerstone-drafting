import type { ReactNode } from 'react'

/**
 * The top of every portal page: an optional line naming the plan, the page
 * title, one line on what the page is for, and anything that belongs beside
 * the title. One shape, so a client moving between pages always finds the
 * title in the same place.
 */
export function PortalPageHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2" data-testid="portal-page-header">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className={eyebrow ? 'mt-1 text-2xl font-semibold text-foreground' : 'text-2xl font-semibold text-foreground'}>
          {title}
        </h1>
        {description ? <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {aside ? <div className="text-sm text-muted-foreground sm:text-right">{aside}</div> : null}
    </div>
  )
}
