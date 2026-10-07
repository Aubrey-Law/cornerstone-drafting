import * as React from 'react'
import { cn } from './utils'

/**
 * A plain `<select>` styled to sit beside `Input`. The Radix `Select` is the
 * default for interactive pickers; this is for forms posted to a server
 * action, where a real form control keeps `name`, `defaultValue` and
 * progressive enhancement working without a controlled wrapper.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'border-input dark:bg-input/30 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/60 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
