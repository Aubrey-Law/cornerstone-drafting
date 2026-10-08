'use client'

import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ENGAGEMENT_STATUS_OPTIONS,
  deriveEngagementStatus,
} from '@/lib/engagementStatus'
import { MATTER_STATUSES, type MatterStatus } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import { InlineSelect, InlineText } from './InlineField'

export interface MatterAdminRowsProps {
  matterId: string
  matterNumber: string | null
  matterNumberManual?: boolean
  matterStatus: string
  onStatusChange: (status: MatterStatus) => void
  statusSaving?: boolean
  details: MatterDetailsRow | null
  onSaveField: (
    field: keyof MatterDetailsRow,
    value: unknown,
    options?: { manual?: boolean },
  ) => Promise<void>
  esignEnabled?: boolean
  engagementSending?: boolean
  onSendEngagement?: () => void
  onDraftEngagement?: () => void
}

/**
 * The matter's administrative fields — number, status, engagement — as inline
 * rows at the top of the facts panel's Matter section. Everything else the old
 * "Administrative settings" card edited (practice area, plan, fees, tax
 * decision, signing dates, lead source) already has a row or chip in the panel.
 */
export function MatterAdminRows({
  matterId,
  matterNumber,
  matterNumberManual = false,
  matterStatus,
  onStatusChange,
  statusSaving = false,
  details,
  onSaveField,
  esignEnabled = false,
  engagementSending = false,
  onSendEngagement,
  onDraftEngagement,
}: MatterAdminRowsProps) {
  const [generatingNumber, setGeneratingNumber] = useState(false)
  const [numberIsManual, setNumberIsManual] = useState(matterNumberManual)
  const engagementStatus = deriveEngagementStatus(details)
  const engagementOptions = [
    ...(engagementStatus === 'declined' ? [{ value: 'declined', label: 'Declined' }] : []),
    ...ENGAGEMENT_STATUS_OPTIONS,
  ]

  const generateMatterNumber = async () => {
    setGeneratingNumber(true)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/matter-number`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to generate matter number')
      await onSaveField('matter_number', body.matterNumber, { manual: false })
      setNumberIsManual(false)
    } finally {
      setGeneratingNumber(false)
    }
  }

  return (
    <>
      <InlineText
        label="Matter number"
        tabular
        value={matterNumber ?? ''}
        display={matterNumber ? `#${matterNumber}` : undefined}
        onSave={next => onSaveField('matter_number', next).then(() => setNumberIsManual(true))}
      />
      {!numberIsManual && (
        <div className="flex justify-end px-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-micro"
            disabled={generatingNumber}
            onClick={() => void generateMatterNumber()}
          >
            <Zap className="size-3" />
            {generatingNumber ? 'Generating…' : 'Auto-generate'}
          </Button>
        </div>
      )}
      <InlineSelect
        label="Matter status"
        value={matterStatus}
        disabled={statusSaving}
        options={MATTER_STATUSES.map(option => ({ value: option.key, label: option.label }))}
        onSave={next => onStatusChange(next as MatterStatus)}
      />
      <InlineSelect
        label="Engagement status"
        value={engagementStatus}
        options={engagementOptions}
        onSave={next => onSaveField('engagement_status', next)}
      />
      {engagementStatus !== 'signed' && (
        <div className="flex justify-end gap-1.5 px-1.5 pb-1">
          {esignEnabled && (
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-micro" disabled={engagementSending} onClick={onSendEngagement}>
              {engagementSending ? 'Sending…' : details?.engagement_sent_at ? 'Resend' : 'Send engagement'}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-micro" disabled={engagementSending} onClick={onDraftEngagement}>
            Draft engagement
          </Button>
        </div>
      )}
    </>
  )
}
