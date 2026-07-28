import Link from 'next/link'
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Loader as Loader2,
  MoreHorizontal,
  Trash2,
  Upload,
  Clock as UnlockIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { practiceAreaLabel } from '@/lib/practiceArea'
import type { MatterAgingSummary } from '@/lib/queries/matterOverview'
import { stageLabel, STAGES, type MatterStage, type PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

interface MatterDetailHeaderProps {
  matter: PipelineMatter
  matterNumber: string | null
  details: MatterDetailsRow | null
  agingSummary: MatterAgingSummary | null
  stageSaving: boolean
  intakeCompleted: boolean
  intakeId: string | null
  unlocking: boolean
  onStageChange: (stage: MatterStage) => void
  onOpenIntake: () => void
  onImportIntake: () => void
  onUnlockIntake: () => void
  onDelete: () => void
}
function healthPresentation(summary: MatterAgingSummary | null) {
  if (!summary || summary.isSnoozed) return null
  if (summary.health === 'red') {
    return {
      label: 'Stalled',
      className: 'border-red-strong-border bg-red-strong-bg text-red-strong',
    }
  }
  if (summary.health === 'amber') {
    return {
      label: 'Needs attention',
      className: 'border-amber-border bg-amber-bg text-amber',
    }
  }
  if (summary.health === 'green') {
    return {
      label: 'On track',
      className: 'border-green/40 bg-green-bg text-green',
    }
  }
  return null
}

export function MatterDetailHeader({
  matter,
  matterNumber,
  details,
  agingSummary,
  stageSaving,
  intakeCompleted,
  intakeId,
  unlocking,
  onStageChange,
  onOpenIntake,
  onImportIntake,
  onUnlockIntake,
  onDelete,
}: MatterDetailHeaderProps) {
  const health = healthPresentation(agingSummary)

  return (
    <div className="border-b border-border bg-card px-4 py-4 md:px-8">
      <div className="w-full">
        <div className="mb-3">
          <Link
            href="/admin/matters"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Matters
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {matter.client_name || matter.matter_name || 'Matter'}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{matterNumber ? `#${matterNumber}` : 'Matter number —'}</span>
              <span aria-hidden>·</span>
              <span>{practiceAreaLabel(details?.practice_area ?? matter.practice_area)}</span>
              {agingSummary && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {agingSummary.daysInStage} business day{agingSummary.daysInStage === 1 ? '' : 's'} in{' '}
                    {stageLabel(matter.stage)}
                  </span>
                </>
              )}
              {health && (
                <Badge variant="outline" className={`text-[10px] ${health.className}`}>
                  {health.label}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={matter.stage}
              onValueChange={value => onStageChange(value as MatterStage)}
              disabled={stageSaving}
            >
              <SelectTrigger size="sm" className="w-[150px]" aria-label="Matter stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map(stage => (
                  <SelectItem key={stage.key} value={stage.key}>{stage.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          </div>
        </div>
      </div>
    </div>
  )
}
