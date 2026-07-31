'use client'

import {
  ClipboardList,
  Mail,
  MessageSquare,
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

type MutableLeadStatus = 'lead' | 'lost'

type Props = {
  busy: boolean
  status: string
  hasActiveAgreement: boolean
  snoozed: boolean
  matterId?: string | null
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
  onDraft,
  onConvert,
  onClearSnooze,
  onStatusChange,
  onSendSchedulingLink,
  onBookForClient,
  onCall,
  onEmail,
  onText,
  onIntake,
  onToggleRail,
  railOpen,
  hasEmail,
  hasPhone,
}: Props) {
  const active = status === 'lead'
  const hired = status === 'hired'
  const lost = status === 'lost'
  const canViewMatter = hired && Boolean(matterId)

  return (
    <>
      <div aria-label="Lead actions" className="hidden items-center gap-1 md:flex">
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={onCall} disabled={busy || !hasPhone}>
          <Phone className="h-3.5 w-3.5" aria-hidden />
          Call
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={onEmail} disabled={busy || !hasEmail}>
          <Mail className="h-3.5 w-3.5" aria-hidden />
          Email
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={onText} disabled={busy || !hasPhone}>
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          Text
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={onIntake} disabled={busy}>
          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
          Intake
        </Button>
        {canViewMatter ? (
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={onConvert} disabled={busy}>
            View matter
          </Button>
        ) : (
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={onDraft} disabled={busy || !active}>
            {hasActiveAgreement ? 'Resume engagement' : 'Draft engagement'}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              aria-label="More actions"
              disabled={busy}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onSendSchedulingLink}>
              Send scheduling link
            </DropdownMenuItem>
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
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
          <DropdownMenuItem disabled={!hasPhone} onClick={onText}>
            <MessageSquare className="mr-2 h-3.5 w-3.5" />
            Text
          </DropdownMenuItem>
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
          <DropdownMenuItem onClick={onToggleRail}>
            {railOpen ? 'Hide details' : 'Open details'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
