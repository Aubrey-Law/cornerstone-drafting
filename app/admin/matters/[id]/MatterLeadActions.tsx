'use client'

import { Briefcase, CircleSlash, RotateCcw, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { MutableLeadStatus } from '@/lib/leads/viewTypes'

/**
 * The lifecycle actions a matter needs while it is still a lead.
 *
 * They live on the matter page rather than a separate leads page because a lead
 * and a matter are the same record — the only difference is whether anyone has
 * signed yet. Hiring is the one action that is not a plain status write: it goes
 * through the convert endpoint, which assigns the matter number and starts the
 * firm clock, so it is the primary button rather than a menu item.
 *
 * Everything here keys off the intake id, which is what the lead endpoints take.
 */
export interface MatterLeadActionsProps {
  relationshipStatus: string
  /** Null when the matter has no intake row, which leaves nothing to act on. */
  intakeId: string | null
  busy: boolean
  onHire: () => void
  onStatusChange: (status: MutableLeadStatus) => void
}

const STATUS_COPY: Record<string, { label: string; blurb: string }> = {
  lead: {
    label: 'Lead',
    blurb: 'No engagement signed yet. Hiring assigns the matter number and starts the 28-day clock.',
  },
  lost: {
    label: 'Lost',
    blurb: 'A fit that never engaged. Reactivate to put it back in the pipeline.',
  },
  declined: {
    label: 'Declined',
    blurb: 'Turned away at discovery. Reactivate to put it back in the pipeline.',
  },
}

export function MatterLeadActions({
  relationshipStatus,
  intakeId,
  busy,
  onHire,
  onStatusChange,
}: MatterLeadActionsProps) {
  // A hired matter has no lifecycle actions left; this is the whole component's
  // reason to exist, so it renders nothing rather than an empty card.
  if (relationshipStatus === 'hired') return null
  const copy = STATUS_COPY[relationshipStatus] ?? STATUS_COPY.lead
  const active = relationshipStatus === 'lead'
  const closed = relationshipStatus === 'lost' || relationshipStatus === 'declined'

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{copy.label}</Badge>
            <span className="text-sm font-medium text-foreground">Not yet engaged</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.blurb}</p>
        </div>

        {active && (
          <>
            <Button type="button" size="sm" disabled={busy || !intakeId} onClick={onHire}>
              <Briefcase className="size-4" aria-hidden />
              Hire matter
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !intakeId}
              onClick={() => onStatusChange('lost')}
            >
              <XCircle className="size-4" aria-hidden />
              Mark lost
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !intakeId}
              onClick={() => onStatusChange('declined')}
            >
              <CircleSlash className="size-4" aria-hidden />
              Decline
            </Button>
          </>
        )}

        {closed && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !intakeId}
            onClick={() => onStatusChange('lead')}
          >
            <RotateCcw className="size-4" aria-hidden />
            Reactivate
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
