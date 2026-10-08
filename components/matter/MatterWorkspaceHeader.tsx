import Link from 'next/link'
import { MatterSwitcher } from '@/components/matter/MatterSwitcher'
import {
  ArrowLeft,
  ClipboardList,
  CloudUpload,
  Loader as Loader2,
  Mail,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Phone,
  Trash2,
  Upload,
  Clock as UnlockIcon,
  Sparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
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
  onOpenIntake: () => void
  onImportIntake: () => void
  onUnlockIntake: () => void
  /** Creates or updates the client's Lawmatics prospect; hidden without an intake. */
  onPushToLawmatics?: () => void
  pushingToLawmatics?: boolean
  onPushToStatular?: () => void
  pushingToStatular?: boolean
  onDelete: () => void
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
  onOpenIntake,
  onImportIntake,
  onUnlockIntake,
  onPushToLawmatics,
  pushingToLawmatics = false,
  onPushToStatular,
  pushingToStatular = false,
  onDelete,
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
    <header data-collapsed={collapsed || undefined} className={cn('shrink-0 border-b border-border bg-card px-4 md:px-6', collapsed ? 'pt-2' : 'pt-5')}>
      <div className={cn('flex flex-wrap justify-between gap-3', collapsed ? 'items-center' : 'items-start')}>
        <div className="min-w-0 flex-1 basis-48">
          {!collapsed && <Link href="/admin/matters" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />Matters
          </Link>}
          <h1 className={cn('min-w-0', !collapsed && 'mt-1')}>
            <MatterSwitcher matterId={matter.matter_id} label={clientName} className={cn('max-w-full px-0 font-semibold tracking-tight', collapsed ? 'text-lg' : 'text-xl sm:text-2xl')} />
          </h1>
          {!collapsed && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {identityChips.map(label => (
              <Badge key={label} variant="outline" className="rounded-md font-medium">{label}</Badge>
            ))}
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
          </div>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
        {extraActions}
        {matter.client_phone && <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild><CallPhoneLink phone={matter.client_phone} label="Call" icon={<Phone className="size-3.5" />} /></Button>}
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" disabled={!matter.client_email} onClick={onEmail}><Mail className="size-3.5" />Email</Button>
        <Button type="button" size="sm" variant={factsRailOpen ? 'selected' : 'outline'} onClick={onToggleFactsRail}
          aria-pressed={factsRailOpen} aria-label={factsRailOpen ? 'Hide matter details' : 'Show matter details'}>
          <PanelRight className="size-4" aria-hidden />
          <span className="hidden sm:inline">Details</span>
        </Button>
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
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 size-3.5" />
              Delete matter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
      {stage && !collapsed && <div className="mt-5">{stage}</div>}
      {navigation && <div className={cn('-mx-4 md:-mx-6', collapsed ? 'mt-1' : 'mt-4')}>{navigation}</div>}
    </header>
  )
}
