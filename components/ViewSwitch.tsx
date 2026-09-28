'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ViewSwitchOption<T extends string> {
  value: T
  label: string
  icon: LucideIcon
}

/**
 * Two or more faces of one tab: Tasks' queue and plan, Assets' inventory and
 * funding, Documents' files and signing. A segmented control rather than
 * nested tabs, so it reads as a way of looking at the tab rather than a
 * place of its own.
 */
export function ViewSwitch<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly ViewSwitchOption<T>[]
  onChange: (view: T) => void
  label?: string
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-md bg-muted p-0.5 text-xs">
      {options.map(option => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 transition-colors',
              value === option.value
                ? 'bg-card font-medium text-foreground shadow-xs'
                : 'text-muted-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
