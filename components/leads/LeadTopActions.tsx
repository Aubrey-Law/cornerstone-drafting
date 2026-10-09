'use client'

import Link from 'next/link'

import {
  AlarmClockOff,
  Ban,
  Briefcase,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  CloudUpload,
  ExternalLink,
  Mail,
  Merge,
  MessageSquareText,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Phone,
  RotateCcw,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MutableLeadStatus } from '@/lib/leads/viewTypes'
import { RecordDetailsButton } from '@/components/workspace/RecordWorkspaceHeader'

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
  /** Books in the firm's own scheduler (verified openings, confirmation email). */
  onScheduleAppointment?: () => void
  onCall: () => void
  onEmail: () => void
  onText: () => void
  onIntake: () => void
  onAddNote?: () => void
  /** Creates or updates this lead's Lawmatics prospect. */
  onPushToLawmatics?: () => void
  pushingToLawmatics?: boolean
  /** Creates this lead's Statular client (create-only; repeats reuse it). */
  onPushToStatular?: () => void
  pushingToStatular?: boolean
  onToggleRail: () => void
  /** Merge this lead into another lead or matter; hidden without a matter. */
  onMerge?: () => void
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
  onScheduleAppointment,
  onCall,
  onEmail,
  onIntake,
  onAddNote,
  onPushToLawmatics,
  pushingToLawmatics = false,
  onPushToStatular,
  pushingToStatular = false,
  onToggleRail,
  onMerge,
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
    <div role="group" aria-label="Lead actions" className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" className="hidden sm:inline-flex" onClick={onCall} disabled={busy || !hasPhone}>
        <Phone className="size-3.5" aria-hidden />
        Call
      </Button>
      <Button type="button" size="sm" variant="outline" className="hidden sm:inline-flex" onClick={onEmail} disabled={busy || !hasEmail}>
        <Mail className="size-3.5" aria-hidden />
        Email
      </Button>
      {canViewMatter && <Button type="button" size="sm" onClick={onConvert} disabled={busy}>View matter</Button>}
      <RecordDetailsButton open={railOpen} onToggle={onToggleRail} record="lead" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" aria-label="More actions" disabled={busy}>
            <MoreHorizontal className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!hasPhone} onClick={onCall}>
            <Phone className="mr-2 size-3.5" />
            Call client
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasEmail} onClick={onEmail}>
            <Mail className="mr-2 size-3.5" />
            Email client
          </DropdownMenuItem>
          {onAddNote && (
            <DropdownMenuItem onClick={onAddNote}>
              <MessageSquareText className="mr-2 size-3.5" />
              Add note
            </DropdownMenuItem>
          )}
          {onScheduleAppointment && (
            <DropdownMenuItem onClick={onScheduleAppointment}>
              <CalendarDays className="mr-2 size-3.5" />
              Schedule appointment…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onBookForClient}>
            <ExternalLink className="mr-2 size-3.5" />
            Book via booking page…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSendSchedulingLink}>
            <CalendarPlus className="mr-2 size-3.5" />
            Send scheduling link
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onIntake}>
            <ClipboardList className="mr-2 size-3.5" />
            Open intake
          </DropdownMenuItem>
          {canViewMatter ? (
            <DropdownMenuItem onClick={onConvert}>
              <Briefcase className="mr-2 size-3.5" />
              View matter
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onDraft} disabled={!active}>
              <PenLine className="mr-2 size-3.5" />
              {hasActiveAgreement ? 'Resume engagement' : 'Draft engagement'}
            </DropdownMenuItem>
          )}
          {leadId && (
            <DropdownMenuItem asChild>
              <Link href={`/admin/assistant?lead=${leadId}`}>
                <Sparkles className="mr-2 size-3.5" />
                Open in Assistant
              </Link>
            </DropdownMenuItem>
          )}
          {onPushToLawmatics && (
            <DropdownMenuItem onClick={onPushToLawmatics} disabled={pushingToLawmatics}>
              <CloudUpload className="mr-2 size-3.5" />
              {pushingToLawmatics ? 'Pushing to Lawmatics…' : 'Push to Lawmatics'}
            </DropdownMenuItem>
          )}
          {onPushToStatular && (
            <DropdownMenuItem onClick={onPushToStatular} disabled={pushingToStatular}>
              <CloudUpload className="mr-2 size-3.5" />
              {pushingToStatular ? 'Pushing to Statular…' : 'Push to Statular'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onToggleRail}>
            <PanelRight className="mr-2 size-3.5" />
            {railOpen ? 'Hide details' : 'Open details'}
          </DropdownMenuItem>
          {onMerge && matterId && (
            <DropdownMenuItem onClick={onMerge} disabled={busy}>
              <Merge className="mr-2 size-3.5" />
              Merge into another lead or matter…
            </DropdownMenuItem>
          )}
          {!canViewMatter && (
            <DropdownMenuItem disabled={!active} onClick={onConvert}>
              <UserCheck className="mr-2 size-3.5" />
              Hire matter
            </DropdownMenuItem>
          )}
          {active && snoozed && (
            <DropdownMenuItem onClick={onClearSnooze}>
              <AlarmClockOff className="mr-2 size-3.5" />
              Clear snooze
            </DropdownMenuItem>
          )}
          {active && (
            <DropdownMenuItem onClick={() => onStatusChange('lost')}>
              <XCircle className="mr-2 size-3.5" />
              Mark lost
            </DropdownMenuItem>
          )}
          {active && (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onStatusChange('declined')}>
              <Ban className="mr-2 size-3.5" />
              Decline — not a fit
            </DropdownMenuItem>
          )}
          {closed && (
            <DropdownMenuItem onClick={() => onStatusChange('lead')}>
              <RotateCcw className="mr-2 size-3.5" />
              Reactivate
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
