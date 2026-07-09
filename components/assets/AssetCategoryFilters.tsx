'use client'

import { ASSET_FILTER_CHIPS } from '@/lib/assets/categories'
import { cn } from '@/lib/utils'

interface AssetCategoryFiltersProps {
  value: string
  onChange: (key: string) => void
}

export function AssetCategoryFilters({ value, onChange }: AssetCategoryFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ASSET_FILTER_CHIPS.map(chip => {
        const active = value === chip.key
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange(chip.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'border-brand-navy bg-brand-navy text-white'
                : 'border-border bg-card text-foreground/70 hover:border-border-strong hover:text-foreground',
            )}
          >
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
