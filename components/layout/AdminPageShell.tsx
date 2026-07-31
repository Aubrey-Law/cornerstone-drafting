import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Full-height admin content shell. The admin layout already owns page padding. */
export function AdminPageShell({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-testid="admin-page-shell"
      className={cn('flex min-h-0 flex-1 flex-col gap-5', className)}
      {...props}
    />
  )
}
