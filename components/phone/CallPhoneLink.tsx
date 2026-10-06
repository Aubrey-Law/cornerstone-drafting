'use client'

import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay, phoneTelHref } from '@/lib/phone'

/**
 * A stored number opens the user's external calling application. Other anchor
 * props pass through, so a wrapper using `asChild` (a menu item) gets its role,
 * keyboard handling and styling onto the link.
 */
export function CallPhoneLink({
  phone,
  className,
  label,
  icon,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> & {
  phone: string | null | undefined
  className?: string
  /** Overrides the displayed text; defaults to the formatted number. */
  label?: string
  /** Shown before the text, e.g. in a menu whose other items have icons. */
  icon?: ReactNode
}) {
  const href = phoneTelHref(phone)
  const display = label ?? formatPhoneDisplay(phone) ?? phone ?? ''

  if (!display) return null
  // A number we can't dial still belongs on screen — just not as an action.
  if (!href) return <span className={className}>{icon}{display}</span>

  return <a {...rest} href={href} className={cn('hover:underline', className)}>{icon}{display}</a>
}
