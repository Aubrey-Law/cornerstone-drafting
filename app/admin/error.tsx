'use client'

import { usePathname } from 'next/navigation'

import { RouteErrorState } from '@/components/RouteErrorState'
import { adminBreadcrumbs } from '@/lib/adminBreadcrumbs'

/**
 * The error boundary for the whole admin app, which is why the way back has to
 * be worked out rather than written down.
 *
 * It used to say "Back to drafting hub" and link `/admin/drafting` from
 * wherever the error happened — so an error on Billing offered to take you to
 * drafting, which is neither where you were nor where you were going.
 *
 * The section comes from the same map the breadcrumbs use, so the two agree by
 * construction: whatever the header would have called this part of the app is
 * what the way back is called. A top-level page has no section above it, and
 * falls back to Today.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const pathname = usePathname() ?? '/admin'
  const section = adminBreadcrumbs(pathname)[0]
  const back =
    section?.href !== undefined
      ? { href: section.href, label: `Back to ${section.label}` }
      : { href: '/admin', label: 'Back to Today' }
  // The way back cannot be the page that just failed. Today has no section
  // above it, so Overview is the other door.
  const samePage = back.href === pathname
  const overview = pathname === '/admin'
    ? { href: '/admin/overview', label: 'Open Overview' }
    : null

  return (
    <RouteErrorState
      error={error}
      reset={reset}
      title="Something went wrong"
      description="An unexpected error occurred. Your saved data is usually unaffected — try again, or go back and come at it from there."
      backHref={samePage ? undefined : back.href}
      backLabel={samePage ? undefined : back.label}
      secondaryHref={overview?.href}
      secondaryLabel={overview?.label}
    />
  )
}
