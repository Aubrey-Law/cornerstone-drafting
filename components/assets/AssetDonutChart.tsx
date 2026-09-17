'use client'

import { formatAssetCurrency } from '@/lib/assets/format'
import { cn } from '@/lib/utils'

export interface DonutSegment {
  key: string
  label: string
  value: number
  color: string
}

interface AssetDonutChartProps {
  title: string
  segments: DonutSegment[]
  className?: string
  size?: number
}

export function AssetDonutChart({ title, segments, className, size = 120 }: AssetDonutChartProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  const stroke = 14
  const r = (size - stroke) / 2
  const cx = size / 2
  const circ = 2 * Math.PI * r

  let offset = circ / 4

  const arcs = segments
    .filter(s => s.value > 0)
    .map(seg => {
      const pct = total > 0 ? seg.value / total : 0
      const dash = pct * circ
      const arc = { ...seg, dash, gap: circ - dash, offset }
      offset -= dash
      return arc
    })

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="block -rotate-90">
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="currentColor"
              className="text-border"
              strokeWidth={stroke}
            />
            {total > 0 ? (
              arcs.map(arc => (
                <circle
                  key={arc.key}
                  cx={cx}
                  cy={cx}
                  r={r}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${arc.dash} ${arc.gap}`}
                  strokeDashoffset={arc.offset}
                  strokeLinecap="butt"
                />
              ))
            ) : null}
          </svg>
          {total <= 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-micro text-muted-foreground">
              No data
            </div>
          )}
        </div>
        <ul className="min-w-0 space-y-1.5 text-xs">
          {segments.map(seg => {
            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
            return (
              <li key={seg.key} className="flex items-start gap-2">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{seg.label}</span>
                  <span className="block text-muted-foreground">
                    {formatAssetCurrency(seg.value)}
                    {total > 0 ? ` · ${pct}%` : ''}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
