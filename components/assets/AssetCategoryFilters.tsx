'use client'

import { cn } from '@/lib/utils'

export interface AssetFilterOption {
  key: string
  label: string
  count: number
}

interface AssetCategoryFiltersProps {
  value: string
  onChange: (key: string) => void
  /**
   * One chip per category the matter actually has, named as its group is in
   * the table. A fixed list used to leave life insurance, business interests
   * and the rest reachable only through "All", under different names.
   */
  options: AssetFilterOption[]
}

export function AssetCategoryFilters({ value, onChange, options }: AssetCategoryFiltersProps) {
  const total = options.reduce((sum, option) => sum + option.count, 0)
  const chips = [{ key: 'all', label: 'All', count: total }, ...options]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map(chip => {
        const active = value === chip.key
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'border-brand-navy bg-brand-navy text-white'
                : 'border-border bg-card text-foreground/70 hover:border-border-strong hover:text-foreground',
            )}
          >
            {chip.label}
            <span className="ml-1 tabular-nums opacity-75">· {chip.count}</span>
          </button>
        )
      })}
    </div>
  )
}
