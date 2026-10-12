import Link from 'next/link'
import { cn } from '@/lib/utils'

export type BillingView = 'dashboard' | 'ledger' | 'invoices' | 'reports'

const views: { view: BillingView; href: string; label: string }[] = [
  { view: 'dashboard', href: '/admin/billing', label: 'Dashboard' },
  { view: 'ledger', href: '/admin/billing?tab=ledger', label: 'Ledger' },
  { view: 'invoices', href: '/admin/billing?tab=invoices', label: 'Invoices' },
  { view: 'reports', href: '/admin/billing?tab=insights', label: 'Reports' },
]

/** Persistent sub-navigation shared by every billing surface. */
export function BillingViewNav({ active }: { active: BillingView }) {
  return (
    <nav aria-label="Billing views" className="flex w-fit items-center rounded-lg bg-muted p-1">
      {views.map(item => (
        <Link
          key={item.view}
          href={item.href}
          aria-current={active === item.view ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors',
            active === item.view
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
