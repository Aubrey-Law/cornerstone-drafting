import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CrmSlice } from '@/lib/crm/dashboard'

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--muted-foreground)',
]

const RADIUS = 38
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Where the firm's people came from, as a donut over the whole directory. */
export function LeadSourcesCard({ sources }: { sources: CrmSlice[] }) {
  const total = sources.reduce((sum, slice) => sum + slice.count, 0)

  let cursor = 0
  const arcs = sources.map((slice, index) => {
    const length = total > 0 ? (slice.count / total) * CIRCUMFERENCE : 0
    const arc = { ...slice, color: PALETTE[index % PALETTE.length], length, offset: cursor }
    cursor += length
    return arc
  })

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
        <CardTitle className="text-sm">Leads by source</CardTitle>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href="/admin/crm/people">View people</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-4 py-4">
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No people in the directory yet.
          </p>
        ) : (
          <>
            <div className="relative mx-auto size-32">
              <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth="14" />
                {arcs.map(arc => (
                  arc.length > 0 && (
                    <circle
                      key={arc.key}
                      cx="50"
                      cy="50"
                      r={RADIUS}
                      fill="none"
                      stroke={arc.color}
                      strokeWidth="14"
                      strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                      strokeDashoffset={-arc.offset}
                    />
                  )
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-2xl font-semibold tabular-nums">{total}</p>
                <p className="text-[11px] text-muted-foreground">people</p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
              {arcs.map(arc => (
                <div key={arc.key} className="flex items-center justify-between gap-2">
                  <dt className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: arc.color }}
                      aria-hidden
                    />
                    <span className="truncate">{arc.label}</span>
                  </dt>
                  <dd className="shrink-0 text-xs font-medium tabular-nums">{arc.count}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  )
}
