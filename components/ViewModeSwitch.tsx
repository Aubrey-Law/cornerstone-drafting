import type { LucideIcon } from 'lucide-react'
import { Columns3, LayoutGrid, Table2 } from 'lucide-react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const viewButton = cva(
  'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-accent motion-reduce:transition-none',
  {
    variants: {
      selected: {
        true: 'bg-selected text-selected-foreground ring-1 ring-inset ring-selected-border',
        false: 'text-muted-foreground hover:bg-accent hover:text-foreground',
      },
    },
  },
)

const ICONS = {
  grid: LayoutGrid,
  table: Table2,
  board: Columns3,
} as const

export function ViewModeSwitch<T extends string>({
  value,
  onChange,
  modes,
  className,
}: {
  value: T
  onChange: (value: T) => void
  modes: readonly T[]
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn('inline-flex rounded-lg border border-border bg-card p-0.5', className)}
    >
      {modes.map(mode => {
        const Icon: LucideIcon | undefined = ICONS[mode as keyof typeof ICONS]
        const selected = value === mode
        const label = mode[0].toUpperCase() + mode.slice(1)
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(mode)}
            className={viewButton({ selected })}
          >
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {label}
          </button>
        )
      })}
    </div>
  )
}
