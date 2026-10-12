import Link from 'next/link'
import { MatterSwitcher } from '@/components/matter/MatterSwitcher'
import {
  CalendarDays,
  CalendarPlus,
  ExternalLink,
  ClipboardList,
  CloudUpload,
  Loader as Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Phone,
  PhoneCall,
  Trash2,
  Merge,
  Upload,
  Clock as UnlockIcon,
  Sparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { formatFirmDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CallPhoneLink } from '@/components/phone/CallPhoneLink'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { RecordDetailsButton, RecordWorkspaceHeader, recordTitleClass } from '@/components/workspace/RecordWorkspaceHeader'
import type { PipelineMatter } from '@/types/database'

export interface MatterWorkspaceHeaderProps {
  matter: PipelineMatter
  matterNumber: string | null
  intakeCompleted: boolean
  intakeId: string | null
  unlocking: boolean
  factsRailOpen: boolean
  onToggleFactsRail: () => void
  onEmail: () => void
  /** Opens the text composer. Hidden when the page has no text action. */
  onText?: () => void
  /** Opens the log-call composer. Hidden when the page has no call log. */
  onLogCall?: () => void
  /** Books in the firm's own scheduler; hidden when not given. */
  onScheduleAppointment?: () => void
  /** Emails or posts a link to the firm's booking page; hidden when not given. */
  onSendSchedulingLink?: () => void
  /** Opens the firm's booking page filled in for the client; hidden when not given. */
  onBookViaPage?: () => void
  onOpenIntake: () => void
  onImportIntake: () => void
  onUnlockIntake: () => void
  /** Creates or updates the client's Lawmatics prospect; hidden without an intake. */
  onPushToLawmatics?: () => void
  pushingToLawmatics?: boolean
  onPushToStatular?: () => void
  pushingToStatular?: boolean
  onDelete: () => void
  /** Merge this matter into another lead or matter. */
  onMerge?: () => void
  planLabel?: string | null
  matterTypeLabel?: string | null
  stage?: ReactNode
  navigation?: ReactNode
  /** Extra items at the end of the chip row (Drafting puts its stage chip and work indicator here). */
  meta?: ReactNode
  /** Buttons before Details (Drafting's Focus). */
  extraActions?: ReactNode
  /** One slim row: name and actions only, with the tabs kept. Drafting collapses to this while the sheet scrolls. */
  collapsed?: boolean
}

/**
 * The matter workspace header shared by the matter page and the drafting
 * route: identity, Call / Email / Details / Actions, then the stage and tab
 * rows the caller passes in.
 */
export function MatterWorkspaceHeader({
  matter,
  matterNumber,
  intakeCompleted,
  intakeId,
  unlocking,
  factsRailOpen,
  onToggleFactsRail,
  onEmail,
  onText,
  onLogCall,
  onScheduleAppointment,
  onSendSchedulingLink,
  onBookViaPage,
  onOpenIntake,
  onImportIntake,
  onUnlockIntake,
  onPushToLawmatics,
  pushingToLawmatics = false,
  onPushToStatular,
  pushingToStatular = false,
  onDelete,
  onMerge,
  planLabel,
  matterTypeLabel,
  stage,
  navigation,
  meta,
  extraActions,
  collapsed = false,
}: MatterWorkspaceHeaderProps) {
  const clientName = matter.client_name || matter.matter_name || 'Matter'
  const identityChips = [
    matter.practice_area ? practiceAreaLabel(matter.practice_area) : null,
    planLabel,
    matterTypeLabel,
  ].filter((value): value is string => Boolean(value))
  const opened = matter.opened_at ?? matter.matter_created
  const openedOn = opened ? formatFirmDate(opened, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  return (
    <RecordWorkspaceHeader
      backHref="/admin/matters"
      backLabel="Matters"
      collapsed={collapsed}
      title={<MatterSwitcher matterId={matter.matter_id} label={clientName} className={cn('max-w-full px-0', recordTitleClass(collapsed))} />}
      chips={identityChips}
      meta={<>
        {(matterNumber || openedOn) && (
          <span className="pl-1 text-muted-foreground tabular-nums">
            {/* Finds this matter in the list, closed matters included. */}
            {matterNumber && (
              <Link
                href={`/admin/matters/list?${new URLSearchParams({ search: matterNumber, closed: '1' })}`}
                className="hover:text-foreground hover:underline"
                title="Show in matter list"
              >
                #{matterNumber}
              </Link>
            )}
            {matterNumber && openedOn && ' · '}
            {openedOn && `Opened ${openedOn}`}
          </span>
        )}
        {meta}
      </>}
      stage={stage}
      navigation={navigation}
      actions={<>
        {extraActions}
        {matter.client_phone && <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild><CallPhoneLink phone={matter.client_phone} label="Call" icon={<Phone className="size-3.5" />} /></Button>}
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" disabled={!matter.client_email} onClick={onEmail}><Mail className="size-3.5" />Email</Button>
        <RecordDetailsButton open={factsRailOpen} onToggle={onToggleFactsRail} record="matter" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              aria-label="Matter actions"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {matter.client_phone && (
              <DropdownMenuItem asChild>
                <CallPhoneLink
                  phone={matter.client_phone}
                  label="Call client"
                  icon={<Phone className="mr-2 size-3.5" />}
                />
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!matter.client_email} onClick={onEmail}>
              <Mail className="mr-2 size-3.5" />
              Email client
            </DropdownMenuItem>
            {onText && (
              <DropdownMenuItem onClick={onText}>
                <MessageSquare className="mr-2 size-3.5" />
                Text client
              </DropdownMenuItem>
            )}
            {onLogCall && (
              <DropdownMenuItem onClick={onLogCall}>
                <PhoneCall className="mr-2 size-3.5" />
                Log call
              </DropdownMenuItem>
            )}
            {onScheduleAppointment && (
              <DropdownMenuItem onClick={onScheduleAppointment}>
                <CalendarDays className="mr-2 size-3.5" />
                Schedule appointment…
              </DropdownMenuItem>
            )}
            {onBookViaPage && (
              <DropdownMenuItem onClick={onBookViaPage}>
                <ExternalLink className="mr-2 size-3.5" />
                Book via booking page…
              </DropdownMenuItem>
            )}
            {onSendSchedulingLink && (
              <DropdownMenuItem onClick={onSendSchedulingLink}>
                <CalendarPlus className="mr-2 size-3.5" />
                Send scheduling link
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onClick={onOpenIntake}>
              <ClipboardList className="mr-2 size-3.5" />
              Review / update intake
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onImportIntake}>
              <Upload className="mr-2 size-3.5" />
              Import intake — paste text or upload Word
            </DropdownMenuItem>
            {intakeCompleted && intakeId && (
              <DropdownMenuItem onClick={onUnlockIntake} disabled={unlocking}>
                {unlocking ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <UnlockIcon className="mr-2 size-3.5 text-muted-foreground" />
                )}
                Unlock intake for client editing
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={`/admin/drafting/${matter.matter_id}`}>
                <PenLine className="mr-2 size-3.5" />
                Open drafting
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/assistant?matter=${matter.matter_id}`}>
                <Sparkles className="mr-2 size-3.5" />
                Open in Assistant
              </Link>
            </DropdownMenuItem>
            {onPushToLawmatics && intakeId && (
              <DropdownMenuItem onClick={onPushToLawmatics} disabled={pushingToLawmatics}>
                <CloudUpload className="mr-2 size-3.5" />
                {pushingToLawmatics ? 'Pushing to Lawmatics…' : 'Push to Lawmatics'}
              </DropdownMenuItem>
            )}
            {onPushToStatular && intakeId && (
              <DropdownMenuItem onClick={onPushToStatular} disabled={pushingToStatular}>
                <CloudUpload className="mr-2 size-3.5" />
                {pushingToStatular ? 'Pushing to Statular…' : 'Push to Statular'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onToggleFactsRail}>
              <PanelRight className="mr-2 size-3.5" />
              {factsRailOpen ? 'Hide details' : 'Open details'}
            </DropdownMenuItem>
            {onMerge && (
              <DropdownMenuItem onClick={onMerge}>
                <Merge className="mr-2 size-3.5" />
                Merge into another lead or matter…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 size-3.5" />
              Delete matter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>}
    />
  )
}
