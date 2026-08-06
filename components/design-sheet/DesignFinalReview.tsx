'use client'

import { ClipboardCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import type { DesignReadinessBlocker } from '@/lib/designSheetReadiness'
import type { AttorneyDesignPreset } from '@/lib/designSheet/fastEntryWorkflow'
import type { DesignSheet } from '@/types/database'

export interface DesignFinalReviewProps {
  sheet: DesignSheet
  selectedDocKeys: DesignDocumentKey[]
  blockingDetails: Array<{ id: string; label: string; blockers: DesignReadinessBlocker[] }>
  optionalDetails: Array<{ id: string; label: string; blockers: DesignReadinessBlocker[] }>
  pendingFiduciaries: string[]
  readinessComplete: boolean
  onGenerate?: () => void
  attorneyPreset: AttorneyDesignPreset | null
}

export function DesignFinalReview({ sheet, selectedDocKeys, blockingDetails, optionalDetails, pendingFiduciaries, readinessComplete, onGenerate, attorneyPreset }: DesignFinalReviewProps) {
  const intakeOverrides = Object.keys(sheet.overrides ?? {})
  const appliedPresetFields = attorneyPreset
    ? Object.entries(attorneyPreset.fields)
        .filter(([field, value]) => JSON.stringify(sheet[field as keyof DesignSheet]) === JSON.stringify(value))
        .map(([field]) => field)
    : []
  const blockingCount = blockingDetails.reduce((total, group) => total + group.blockers.length, 0)
  const optionalCount = optionalDetails.reduce((total, group) => total + group.blockers.length, 0)
  const list = (values: string[]) => values.map(value => value.replace(/_/g, ' ')).join(' · ') || 'None'

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" />Final review</p>
          <p className="mt-1 text-xs text-muted-foreground">Only exceptions, unresolved work, and package choices are shown.</p>
        </div>
        <Badge className={cn('border-0', readinessComplete ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
          {readinessComplete ? `${optionalCount} optional` : `${blockingCount} blocking`}
        </Badge>
      </div>
      <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
        <div><p className="font-semibold text-foreground">Selected documents</p><p className="mt-1 text-muted-foreground">{list(selectedDocKeys)}</p></div>
        <div><p className="font-semibold text-foreground">Intake overrides</p><p className="mt-1 text-muted-foreground">{list(intakeOverrides)}</p></div>
        <div><p className="font-semibold text-foreground">Applied standards</p><p className="mt-1 text-muted-foreground">{list(appliedPresetFields)}</p></div>
        <div><p className="font-semibold text-foreground">Pending client</p><p className="mt-1 text-muted-foreground">{list(pendingFiduciaries)}</p></div>
      </div>
      {onGenerate && <Button className="mt-4 w-full" disabled={!readinessComplete} onClick={onGenerate}>Generate drafts →</Button>}
    </section>
  )
}
