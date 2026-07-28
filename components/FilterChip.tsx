import { cn } from '@/lib/utils'

interface FilterChipProps extends React.ComponentProps<'button'> {
  selected?: boolean
  count?: number
}
export function FilterChip({ selected = false, count, className, children, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
        selected
          ? 'bg-accent text-accent-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/80',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && <span className="tabular-nums opacity-75">· {count}</span>}
    </button>
  )
}
