import Link from 'next/link'
import { MatterSwitcher } from '@/components/matter/MatterSwitcher'
import {
  ArrowLeft,
  ClipboardList,
  CloudUpload,
  Loader as Loader2,
  Mail,
  MoreHorizontal,
  PanelLeft,
  PenLine,
  Phone,
  Trash2,
  Upload,
  Clock as UnlockIcon,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CallPhoneLink } from '@/components/phone/CallPhoneLink'
import { practiceAreaLabel } from '@/lib/practiceArea'
import type { PipelineMatter } from '@/types/database'

interface MatterDetailHeaderProps {
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
}

export function MatterDetailHeader({
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
}: MatterDetailHeaderProps) {
  const clientName = matter.client_name || matter.matter_name || 'Matter'

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <Link href="/admin/matters" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden />Matters
        </Link>
        <h1 className="mt-1 min-w-0">
          <MatterSwitcher matterId={matter.matter_id} label={clientName} className="max-w-full px-0 text-xl sm:text-2xl" />
        </h1>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">{[matterNumber ? `#${matterNumber}` : null, matter.practice_area ? practiceAreaLabel(matter.practice_area) : null].filter(Boolean).join(' · ')}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {matter.client_phone && <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild><CallPhoneLink phone={matter.client_phone} label="Call" icon={<Phone className="size-3.5" />} /></Button>}
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" disabled={!matter.client_email} onClick={onEmail}><Mail className="size-3.5" />Email</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onToggleFactsRail}
          aria-pressed={factsRailOpen} aria-label={factsRailOpen ? 'Hide matter details' : 'Show matter details'}>
          <PanelLeft className="size-4" aria-hidden />
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
              <PanelLeft className="mr-2 size-3.5" />
              {factsRailOpen ? 'Hide details' : 'Open details'}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 size-3.5" />
              Delete matter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
