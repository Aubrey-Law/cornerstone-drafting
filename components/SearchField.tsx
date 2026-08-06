import { Search, X } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface SearchFieldProps extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange'> {
  value: string
  onValueChange: (value: string) => void
  containerClassName?: string
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({
  value,
  onValueChange,
  containerClassName,
  className,
  'aria-label': ariaLabel = 'Search',
  ...props
}, ref) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 transition-colors focus-within:border-primary',
        containerClassName,
      )}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={ref}
        {...props}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={ariaLabel}
        className={cn(
          'min-w-0 flex-1 appearance-none border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden',
          className,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange('')}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Clear ${ariaLabel.toLocaleLowerCase()}`}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
})
