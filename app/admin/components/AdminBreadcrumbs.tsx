'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { Crumb } from '@/lib/adminBreadcrumbs'

/**
 * The trail in the shell header. `lib/adminBreadcrumbs` decides what it says;
 * this only draws it.
 *
 * Renders nothing for an empty trail, which is what every top-level page gets —
 * the slot it occupies was a bare spacer before this, so those pages look
 * exactly as they did.
 */
export function AdminBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex min-w-0 items-center gap-1 text-compact text-muted-foreground">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              )}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="truncate rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {crumb.label}
                </Link>
              ) : (
                // The page you are on. `aria-current` is what tells a screen
                // reader which of these is the destination rather than a step.
                <span
                  className={last ? 'truncate font-medium text-foreground' : 'truncate'}
                  aria-current={last ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
