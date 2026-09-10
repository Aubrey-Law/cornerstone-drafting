'use client'

import { phoneTelHref } from '@/lib/phone'

/** Open the user's external calling application using the stored number. */
export function openExternalPhone(detail?: { number?: string }) {
  const href = phoneTelHref(detail?.number)
  if (href && typeof window !== 'undefined') window.location.href = href
}
