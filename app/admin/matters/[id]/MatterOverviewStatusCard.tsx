'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STAGES, type MatterStage, type PipelineMatter } from '@/types/database'

interface MatterOverviewStatusCardProps {
  matter: PipelineMatter
  stageSaving: boolean
  onStageChange: (stage: MatterStage) => void
}

export function MatterOverviewStatusCard({
  matter,
  stageSaving,
  onStageChange,
}: MatterOverviewStatusCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Client
          </p>
          <p className="text-sm font-medium">{matter.client_name || '—'}</p>
          <p className="text-xs text-muted-foreground">{matter.client_email || '—'}</p>
          <p className="text-xs text-muted-foreground">{matter.client_phone || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Stage
          </p>
          <Select
            value={matter.stage}
            onValueChange={v => onStageChange(v as MatterStage)}
            disabled={stageSaving}
          >
            <SelectTrigger className="h-8 w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map(s => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Intake status
          </p>
          <p className="text-sm capitalize">
            {matter.intake_status?.replace(/_/g, ' ') || '—'}
          </p>
          {matter.intake_sent_at && (
            <p className="text-xs text-muted-foreground">
              Sent {new Date(matter.intake_sent_at).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
