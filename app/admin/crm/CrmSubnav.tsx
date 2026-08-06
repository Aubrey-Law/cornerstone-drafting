'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, ContactRound, Mail, RefreshCw, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/admin/crm/people', label: 'People', icon: ContactRound },
  { href: '/admin/crm/opportunities', label: 'Opportunities', icon: Target },
  { href: '/admin/crm/activities', label: 'Activities', icon: Activity },
  { href: '/admin/crm/campaigns', label: 'Campaigns', icon: Mail },
  { href: '/admin/crm/sync', label: 'Sync', icon: RefreshCw },
] as const

export function CrmSubnav() {
  const pathname = usePathname()
  return (
    <nav aria-label="CRM" className="flex flex-wrap gap-1 border-b border-border pb-2">
      {ITEMS.map(item => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
