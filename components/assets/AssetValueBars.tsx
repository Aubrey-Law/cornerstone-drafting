'use client'

import { formatAssetCurrency } from '@/lib/assets/format'

interface AssetValueSegment {
  key: string
  label: string
  value: number
  color: string
}

export function AssetValueBars({ title, segments }: { title: string; segments: AssetValueSegment[] }) {
  const maximum = Math.max(...segments.map(segment => segment.value), 1)

  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {segments.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet</p>
      ) : (
        <div className="space-y-3">
          {segments.map(segment => (
            <div key={segment.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="truncate text-muted-foreground">{segment.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{formatAssetCurrency(segment.value)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max((segment.value / maximum) * 100, 2)}%`, backgroundColor: segment.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
