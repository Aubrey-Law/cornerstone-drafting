import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight, Landmark, ListChecks, ShieldCheck, Signature } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/funding/format'
import type { MatterCloseoutSummary } from '@/lib/matters/closeout'
import { cn } from '@/lib/utils'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

interface Tile {
  key: string
  href: string
  icon: LucideIcon
  label: string
  /** Null when the figure could not be read. */
  value: string | null
  detail: string
  /** True when the figure is work waiting, so it reads louder than a zero. */
  attention: boolean
}

function tiles(summary: MatterCloseoutSummary): Tile[] {
  const { funding, fiduciaries, signing, blockers } = summary
  return [
    {
      key: 'funding',
      href: '/admin/funding',
      icon: Landmark,
      label: 'Unfunded',
      value: funding ? formatMoney(funding.unfundedValue) : null,
      detail: funding
        ? `outside the trusts on ${plural(funding.mattersOutstanding, 'matter', 'matters')}`
        : 'Could not be read',
      attention: Boolean(funding && funding.mattersOutstanding > 0),
    },
    {
      key: 'signing',
      href: '/admin/execution',
      icon: Signature,
      label: 'To sign',
      value: signing ? String(signing.mattersToSign) : null,
      detail: signing
        ? `drafted, not yet signed${signing.documentsToConfirm > 0 ? ` · ${plural(signing.documentsToConfirm, 'document', 'documents')} to confirm` : ''}`
        : 'Could not be read',
      attention: Boolean(signing && signing.mattersToSign > 0),
    },
    {
      key: 'fiduciaries',
      href: '/admin/fiduciaries',
      icon: ShieldCheck,
      label: 'Fiduciary gaps',
      value: fiduciaries ? String(fiduciaries.mattersWithGaps) : null,
      detail: fiduciaries ? `of ${plural(fiduciaries.mattersTracked, 'matter', 'matters')} with appointments` : 'Could not be read',
      attention: Boolean(fiduciaries && fiduciaries.mattersWithGaps > 0),
    },
    {
      key: 'blockers',
      href: '/admin/field-audits',
      icon: ListChecks,
      label: 'Audit blockers',
      value: blockers ? String(blockers.matters) : null,
      detail: blockers ? `${blockers.matters === 1 ? 'matter' : 'matters'} with a blocker nobody has decided` : 'Could not be read',
      attention: Boolean(blockers && blockers.matters > 0),
    },
  ]
}

/**
 * The close-out worklists across every hired matter: what is unfunded, what
 * is drafted and unsigned, whose fiduciaries have a gap, which field audit
 * left a blocker. Each tile opens its worklist; each worklist row opens the
 * matter, where the work is done.
 */
export function MatterCloseoutCard({ summary }: { summary: MatterCloseoutSummary }) {
  return (
    <Card className="min-w-0 gap-0 py-0" data-testid="matter-closeout">
      <CardHeader className="block space-y-1 border-b border-border py-3 [.border-b]:pb-3">
        <CardTitle className="text-sm">Close-out</CardTitle>
        <CardDescription className="text-xs">After drafting: signing, funding and the checks, across every hired matter</CardDescription>
      </CardHeader>
      {/* One-pixel gaps over the border colour draw the dividers at every breakpoint. */}
      <ul className="grid gap-px overflow-hidden rounded-b-lg bg-border sm:grid-cols-2 lg:grid-cols-4">
        {tiles(summary).map(tile => {
          const Icon = tile.icon
          return (
            <li key={tile.key} className="bg-card">
              <Link
                href={tile.href}
                data-testid={`closeout-${tile.key}`}
                className="group flex h-full items-start gap-3 px-4 py-3 transition-colors hover:bg-accent"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-muted-foreground">{tile.label}</span>
                  <span className={cn('block text-lg font-semibold tabular-nums', tile.attention ? 'text-foreground' : 'text-muted-foreground')}>
                    {tile.value ?? '—'}
                  </span>
                  <span className="block text-xs text-muted-foreground">{tile.detail}</span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
