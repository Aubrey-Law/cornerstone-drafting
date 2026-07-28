'use client'

import { cn } from '@/lib/utils'
import { formatPhoneDisplay, phoneTelHref } from '@/lib/phone'
import { openStaffSoftphone } from '@/app/admin/components/softphoneEvents'
import { useVoiceEnabled } from '@/components/softphone/SoftphoneProvider'

/**
 * A phone number in a lead or matter record.
 *
 * With voice configured this opens the rail on its Phone tab with the digits
 * already in the dialer. Without it — or outside the admin shell — it stays a
 * plain `tel:` link so the number is still actionable.
 */
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
  const voiceEnabled = useVoiceEnabled()
  const href = phoneTelHref(phone)
  const display = label ?? formatPhoneDisplay(phone) ?? phone ?? ''

  if (!display) return null
  // A number we can't dial still belongs on screen — just not as an action.
  if (!href) return <span className={className}>{display}</span>

  if (!voiceEnabled) {
    return (
      <a href={href} className={cn('hover:underline', className)}>
        {display}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={() => openStaffSoftphone({ number: phone ?? undefined })}
      title={`Call ${display}`}
      className={cn('underline-offset-2 hover:text-accent hover:underline', className)}
    >
      {display}
    </button>
  )
}
