'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlarmClock, LayoutDashboard, List } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The dashboard sits at the matters root, so it only lights up on an exact match. */
const MATTERS_ROOT = '/admin/matters'

const ITEMS = [
  { href: MATTERS_ROOT, label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/matters/list', label: 'List', icon: List },
  // Aging has always lived under /admin/pipeline but it is a matters view, so it
  // is reachable from here rather than only from a link on the list page.
  { href: '/admin/pipeline/aging', label: 'Aging', icon: AlarmClock },
] as const

export function MattersSubnav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Matters" className="flex flex-wrap gap-1 border-b border-border pb-2">
      {ITEMS.map(item => {
        const active =
          item.href === MATTERS_ROOT
            ? pathname === MATTERS_ROOT
            : pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
