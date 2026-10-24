'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function engagementStatusLabel(agreementStatus: string | null | undefined, signed: boolean): string {
  if (signed) return 'Signed'
  if (!agreementStatus) return 'Not prepared'
  return (agreementStatus.charAt(0).toUpperCase() + agreementStatus.slice(1)).replaceAll('_', ' ')
}

/**
 * The lead header's engagement chip: the agreement's status, opening a menu to
 * record a send made outside the app or jump to the engagement details.
 */
export function LeadEngagementPill({ agreementStatus, signedAt, engagementSentOutside, onEngagementSentOutside, onEngagement }: {
  agreementStatus?: string | null
  signedAt?: string | null
  /**
   * Whether the engagement is recorded as sent outside the app. Undefined when
   * the app sent it itself, which its own status already shows.
   */
  engagementSentOutside?: boolean
  onEngagementSentOutside?: (sent: boolean) => Promise<void>
  onEngagement: () => void
}) {
  const [saving, setSaving] = useState(false)
  // A signed engagement is not un-sent from here: that would clear the signature too.
  const signed = Boolean(signedAt) || agreementStatus === 'signed' || agreementStatus === 'completed'
  const showSentOutside = engagementSentOutside !== undefined && Boolean(onEngagementSentOutside) && !signed
  const status = engagementStatusLabel(agreementStatus, signed)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Engagement: ${status}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-muted-foreground">Engagement:</span> {status}
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Engagement · {status}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showSentOutside && (
          <DropdownMenuCheckboxItem
            checked={engagementSentOutside}
            disabled={saving}
            onCheckedChange={checked => {
              setSaving(true)
              void onEngagementSentOutside!(checked === true).finally(() => setSaving(false))
            }}
          >
            Sent outside the app
          </DropdownMenuCheckboxItem>
        )}
        <DropdownMenuItem onSelect={onEngagement}>View engagement details</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
