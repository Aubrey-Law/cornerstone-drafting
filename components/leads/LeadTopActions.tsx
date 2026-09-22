'use client'

import Link from 'next/link'

import {
  ClipboardList,
  CalendarDays,
  MessageSquareText,
  Mail,
  MoreHorizontal,
  PanelRight,
  Phone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MutableLeadStatus } from '@/lib/leads/viewTypes'

type Props = {
  busy: boolean
  status: string
  hasActiveAgreement: boolean
  snoozed: boolean
  matterId?: string | null
  /** The lead's own id, for the Assistant deep link. */
  leadId?: string | null
  onDraft: () => void
  onConvert: () => void
  onClearSnooze: () => void
  onStatusChange: (status: MutableLeadStatus) => void
  onSendSchedulingLink: () => void
  onBookForClient: () => void
  onCall: () => void
  onEmail: () => void
  onText: () => void
  onIntake: () => void
  onAddNote?: () => void
  /** Creates or updates this lead's Lawmatics prospect. */
  onPushToLawmatics?: () => void
  pushingToLawmatics?: boolean
  onToggleRail: () => void
  railOpen: boolean
  hasEmail: boolean
  hasPhone: boolean
}

export function LeadTopActions({
  busy,
  status,
  hasActiveAgreement,
  snoozed,
  matterId,
  leadId,
  onDraft,
  onConvert,
  onClearSnooze,
  onStatusChange,
  onSendSchedulingLink,
  onBookForClient,
  onCall,
  onEmail,
  onIntake,
  onAddNote,
  onPushToLawmatics,
  pushingToLawmatics = false,
  onToggleRail,
  railOpen,
  hasEmail,
  hasPhone,
}: Props) {
  const active = status === 'lead'
  const hired = status === 'hired'
  const lost = status === 'lost'
  const declined = status === 'declined'
  // Both closed states reopen the same way, so the menu offers one Reactivate.
  const closed = lost || declined
  const canViewMatter = hired && Boolean(matterId)

  return (
    <>
      <div aria-label="Lead actions" className="hidden items-center gap-1 md:flex">
        <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 px-2 text-xs" onClick={onCall} disabled={busy || !hasPhone}>
          <Phone className="h-3.5 w-3.5" aria-hidden />
          Call
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 px-2 text-xs" onClick={onEmail} disabled={busy || !hasEmail}>
          <Mail className="h-3.5 w-3.5" aria-hidden />
          Email
        </Button>

        {onAddNote && <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 px-2" onClick={onAddNote} disabled={busy}><MessageSquareText className="h-3.5 w-3.5" aria-hidden />Add note</Button>}
        <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 px-2" onClick={onBookForClient} disabled={busy}><CalendarDays className="h-3.5 w-3.5" aria-hidden />Schedule</Button>
        {canViewMatter && <Button type="button" size="sm" onClick={onConvert} disabled={busy}>View matter</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 px-2"
              aria-label="More actions"
              disabled={busy}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onIntake}>Open intake</DropdownMenuItem>
            {leadId && (
              <DropdownMenuItem asChild>
                <Link href={`/admin/assistant?lead=${leadId}`}>Open in Assistant</Link>
              </DropdownMenuItem>
            )}
            {!canViewMatter && <DropdownMenuItem onClick={onDraft} disabled={!active}>{hasActiveAgreement ? 'Resume engagement' : 'Draft engagement'}</DropdownMenuItem>}
            <DropdownMenuItem onClick={onSendSchedulingLink}>
              Send scheduling link
            </DropdownMenuItem>
            {onPushToLawmatics && (
              <DropdownMenuItem onClick={onPushToLawmatics} disabled={pushingToLawmatics}>
                {pushingToLawmatics ? 'Pushing to Lawmatics…' : 'Push to Lawmatics'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onBookForClient}>
              Book for client…
            </DropdownMenuItem>
            {!canViewMatter && (
              <DropdownMenuItem disabled={!active} onClick={onConvert}>
                Hire matter
              </DropdownMenuItem>
            )}
            {active && (
              <DropdownMenuItem onClick={() => onStatusChange('lost')}>
                Mark lost
              </DropdownMenuItem>
            )}
            {active && (
              <DropdownMenuItem onClick={() => onStatusChange('declined')}>
                Decline — not a fit
              </DropdownMenuItem>
            )}
            {active && snoozed && (
              <DropdownMenuItem onClick={onClearSnooze}>
                Clear snooze
              </DropdownMenuItem>
            )}
            {closed && (
              <DropdownMenuItem onClick={() => onStatusChange('lead')}>
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 px-2"
          aria-label="Toggle details rail"
          aria-pressed={railOpen}
          onClick={onToggleRail}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 md:hidden"
            aria-label="More lead actions"
            disabled={busy}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!hasPhone} onClick={onCall}>
            <Phone className="mr-2 h-3.5 w-3.5" />
            Call
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasEmail} onClick={onEmail}>
            <Mail className="mr-2 h-3.5 w-3.5" />
            Email
          </DropdownMenuItem>

          {onAddNote && <DropdownMenuItem onClick={onAddNote}>Add note</DropdownMenuItem>}
          <DropdownMenuItem onClick={onIntake}>
            <ClipboardList className="mr-2 h-3.5 w-3.5" />
            Intake
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canViewMatter && !active} onClick={canViewMatter ? onConvert : onDraft}>
            {canViewMatter
              ? 'View matter'
              : hasActiveAgreement
                ? 'Resume engagement'
                : 'Draft engagement'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSendSchedulingLink}>
            Send scheduling link
          </DropdownMenuItem>
          {onPushToLawmatics && (
            <DropdownMenuItem onClick={onPushToLawmatics} disabled={pushingToLawmatics}>
              {pushingToLawmatics ? 'Pushing to Lawmatics…' : 'Push to Lawmatics'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onBookForClient}>
            Book for client…
          </DropdownMenuItem>
          {!canViewMatter && (
            <DropdownMenuItem disabled={!active} onClick={onConvert}>
              Hire matter
            </DropdownMenuItem>
          )}
          {active && (
            <DropdownMenuItem onClick={() => onStatusChange('lost')}>
              Mark lost
            </DropdownMenuItem>
          )}
          {active && (
            <DropdownMenuItem onClick={() => onStatusChange('declined')}>
              Decline — not a fit
            </DropdownMenuItem>
          )}
          {active && snoozed && (
            <DropdownMenuItem onClick={onClearSnooze}>
              Clear snooze
            </DropdownMenuItem>
          )}
          {closed && (
            <DropdownMenuItem onClick={() => onStatusChange('lead')}>
              Reactivate
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onToggleRail}>
            {railOpen ? 'Hide details' : 'Open details'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
