import { cn } from '@/lib/utils'

/**
 * Inline validation message for a single field. Render with the id referenced by
 * the input's aria-describedby so screen readers announce it on focus; the
 * form-level error block carries role="alert" instead, so a failed submit does
 * not fire one announcement per invalid field.
 */
export function FieldError({
  id,
  message,
  className,
}: {
  id?: string
  message?: string
  className?: string
}) {
  if (!message) return null
  return (
    <p id={id} className={cn('mt-1 text-xs text-destructive', className)}>
      {message}
    </p>
  )
}
