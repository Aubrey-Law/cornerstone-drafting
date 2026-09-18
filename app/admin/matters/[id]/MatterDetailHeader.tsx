import Link from 'next/link'
import { MatterSwitcher } from '@/components/matter/MatterSwitcher'
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Loader as Loader2,
  Mail,
  MoreHorizontal,
  PanelRight,
  Trash2,
  Upload,
  Clock as UnlockIcon,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CallPhoneLink } from '@/components/phone/CallPhoneLink'
import { cn } from '@/lib/utils'
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
  onDelete: () => void
}

function clientInitial(matter: PipelineMatter): string {
  const source = (matter.client_name || matter.matter_name || '').trim()
  return source ? source[0].toUpperCase() : '—'
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
  onDelete,
}: MatterDetailHeaderProps) {
  const clientName = matter.client_name || matter.matter_name || 'Matter'

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/admin/matters"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span className="hidden sm:inline">Matters</span>
        </Link>
        <span aria-hidden className="hidden shrink-0 text-xs text-muted-foreground sm:inline">/</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="flex size-[18px] shrink-0 items-center justify-center rounded bg-muted text-micro font-semibold text-muted-foreground"
          >
            {clientInitial(matter)}
          </span>
          <MatterSwitcher matterId={matter.matter_id} label={clientName} />
        </span>
        <Badge variant="outline" className="hidden shrink-0 text-micro font-medium tabular-nums sm:inline-flex">
          {matterNumber ? `#${matterNumber}` : 'No matter number'}
        </Badge>
      </div>

      <div className="hidden shrink-0 items-center gap-2 md:flex">
        {matter.client_phone && (
          <CallPhoneLink
            phone={matter.client_phone}
            label="Call"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'no-underline')}
          />
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onEmail}
          disabled={!matter.client_email}
        >
          <Mail className="size-3.5" />
          Email
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="gap-1.5">
              <ClipboardList className="size-3.5" />
              Intake actions
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenIntake}>
              <ClipboardList className="mr-2 size-3.5" />
              {intakeCompleted ? 'Edit intake' : intakeId ? 'Update intake' : 'Create intake'}
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
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" asChild>
          <Link href={`/admin/assistant?matter=${matter.matter_id}`} title="Start an Assistant chat on this matter">
            <Sparkles className="size-3.5" />
            Open in Assistant
          </Link>
        </Button>
        <Button type="button" size="sm" asChild>
          <Link href={`/admin/drafting/${matter.matter_id}`}>Open drafting</Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" aria-label="More actions">
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 size-3.5" />
              Delete matter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onToggleFactsRail}
          aria-pressed={factsRailOpen}
          aria-label={factsRailOpen ? 'Hide matter facts' : 'Show matter facts'}
          title={factsRailOpen ? 'Hide matter facts' : 'Show matter facts'}
        >
          <PanelRight className="size-3.5" />
        </Button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 md:hidden"
            aria-label="Matter actions"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {matter.client_phone && (
            <DropdownMenuItem asChild>
              <CallPhoneLink phone={matter.client_phone} label="Call client" />
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={!matter.client_email} onClick={onEmail}>
            <Mail className="mr-2 size-3.5" />
            Email client
          </DropdownMenuItem>

          <DropdownMenuItem onClick={onOpenIntake}>
            <ClipboardList className="mr-2 size-3.5" />
            {intakeCompleted ? 'Edit intake' : intakeId ? 'Update intake' : 'Create intake'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImportIntake}>
            <Upload className="mr-2 size-3.5" />
            Import intake
          </DropdownMenuItem>
          {intakeCompleted && intakeId && (
            <DropdownMenuItem onClick={onUnlockIntake} disabled={unlocking}>
              {unlocking ? (
                <Loader2 className="mr-2 size-3.5 animate-spin text-muted-foreground" />
              ) : (
                <UnlockIcon className="mr-2 size-3.5 text-muted-foreground" />
              )}
              Unlock intake
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/admin/drafting/${matter.matter_id}`}>Open drafting</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleFactsRail}>
            <PanelRight className="mr-2 size-3.5" />
            {factsRailOpen ? 'Hide facts' : 'Open facts'}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
            <Trash2 className="mr-2 size-3.5" />
            Delete matter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
