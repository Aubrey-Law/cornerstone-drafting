'use client'

import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type MutableLeadStatus = 'lead' | 'lost'

type Props = {
  busy: boolean
  status: string
  hasActiveAgreement: boolean
  snoozed: boolean
  matterId?: string | null
  actionError?: string | null
  onDraft: () => void
  onConvert: () => void
  onClearSnooze: () => void
  onStatusChange: (status: MutableLeadStatus) => void
}

export function LeadTopActions({
  busy,
  status,
  hasActiveAgreement,
  snoozed,
  matterId,
  actionError,
  onDraft,
  onConvert,
  onClearSnooze,
  onStatusChange,
}: Props) {
  const active = status === 'lead'
  const hired = status === 'hired'
  const lost = status === 'lost'
  const canViewMatter = hired && Boolean(matterId)

  return (
    <div className="space-y-2">
      <div aria-label="Lead actions" className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onDraft}
          disabled={busy || !active}
        >
          {hasActiveAgreement ? 'Resume engagement' : 'Draft engagement'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onConvert}
          disabled={busy || (!active && !canViewMatter)}
        >
          {canViewMatter ? 'View matter' : 'Hire matter'}
        </Button>
        {active && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onStatusChange('lost')}
            disabled={busy}
          >
            Mark lost
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="More actions"
              disabled={busy || hired}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {active && snoozed && (
              <DropdownMenuItem onClick={onClearSnooze}>
                Clear snooze
              </DropdownMenuItem>
            )}
            {lost && (
              <DropdownMenuItem onClick={() => onStatusChange('lead')}>
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {actionError && (
        <p role="alert" aria-live="polite" className="text-right text-xs text-destructive">
          {actionError}
        </p>
      )}
    </div>
  )
}
