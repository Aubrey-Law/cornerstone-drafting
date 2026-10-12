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
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && <span className="tabular-nums">· {count}</span>}
    </button>
  )
}
