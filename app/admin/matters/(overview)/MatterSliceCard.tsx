import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MatterSlice } from '@/lib/matters/dashboard'

/**
 * A segmented bar over a breakdown, with a legend beneath it.
 *
 * One component rather than two near-identical ones: stage occupancy and
 * practice-area mix are the same shape of question, so they get the same answer.
 */

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

interface MatterSliceCardProps {
  title: string
  description: string
  slices: MatterSlice[]
  /** Noun for a single item, e.g. "matter". */
  unit?: string
  emptyLabel?: string
}

export function MatterSliceCard({
  title,
  description,
  slices,
  unit = 'matter',
  emptyLabel = 'Nothing to show yet.',
}: MatterSliceCardProps) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="px-4 py-4">
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              {slices.map(
                (slice, index) =>
                  slice.count > 0 && (
                    <span
                      key={slice.key}
                      style={{
                        width: `${(slice.count / total) * 100}%`,
                        backgroundColor: PALETTE[index % PALETTE.length],
                      }}
                    />
                  ),
              )}
            </div>

            <dl className="mt-4 space-y-3">
              {slices.map((slice, index) => (
                <div key={slice.key} className="flex items-center gap-3">
                  <dt className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{slice.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {slice.count} {slice.count === 1 ? unit : `${unit}s`}
                      </span>
                    </span>
                  </dt>
                  <dd className="flex shrink-0 items-center gap-2">
                    <span
                      className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"
                      aria-hidden
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${slice.percent}%`,
                          backgroundColor: PALETTE[index % PALETTE.length],
                        }}
                      />
                    </span>
                    <span className="w-9 text-right text-xs font-medium tabular-nums">
                      {slice.percent}%
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  )
}
