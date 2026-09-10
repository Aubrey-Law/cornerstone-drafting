'use client'

import { cn } from '@/lib/utils'
import { formatPhoneDisplay, phoneTelHref } from '@/lib/phone'

/** A stored number opens the user's external calling application. */
export function CallPhoneLink({
  phone,
  className,
  label,
}: {
  phone: string | null | undefined
  className?: string
  /** Overrides the displayed text; defaults to the formatted number. */
  label?: string
}) {
  const href = phoneTelHref(phone)
  const display = label ?? formatPhoneDisplay(phone) ?? phone ?? ''

  if (!display) return null
  // A number we can't dial still belongs on screen — just not as an action.
  if (!href) return <span className={className}>{display}</span>

  return <a href={href} className={cn('hover:underline', className)}>{display}</a>
}
