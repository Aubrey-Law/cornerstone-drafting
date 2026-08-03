'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDate, formatDateDetail } from '@/lib/utils'
import {
  ENGAGEMENT_STATUS_OPTIONS,
  deriveEngagementStatus,
  engagementStatusLabel,
} from '@/lib/engagementStatus'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import { MATTER_PLAN_TYPE_OPTIONS, normalizePlanType } from '@/lib/matterPlanType'
import { PRACTICE_AREA_OPTIONS, normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { normalizeTargetSigningDate, targetSigningDateInput } from '@/lib/matterDates'
import { MATTER_STATUSES, type MatterStatus, type PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import { ReadFirstPanel, ReadValue } from './ReadFirstPanel'

interface MatterEssentialsCardProps {
  matter: PipelineMatter
  matterId: string
  matterNumber: string | null
  matterNumberManual?: boolean
  matterStatus: string
  onStatusChange: (status: MatterStatus) => void
  statusSaving?: boolean
  details: MatterDetailsRow | null
  designSheetPlanType?: string | null
  onSaveField: (
    field: keyof MatterDetailsRow,
    value: unknown,
    options?: { manual?: boolean },
  ) => Promise<void>
  savingField?: keyof MatterDetailsRow | null
  lastSavedAt?: string | null
  error?: string | null
  esignEnabled?: boolean
  engagementSending?: boolean
  onSendEngagement?: () => void
  onDraftEngagement?: () => void
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-muted-foreground">{children}</span>
}

function currency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function taxDecision(value: boolean | null | undefined) {
  return value === true ? 'Tax-sensitive' : value === false ? 'Not tax-sensitive' : 'Not reviewed'
}

function paymentStatus(details: MatterDetailsRow | null) {
  if (details?.fee_payment_status === 'deposit') return 'Deposit'
  if (details?.fee_payment_status === 'paid_in_full' || details?.fee_collected) return 'Paid in full'
  return 'Unpaid'
}

export function MatterEssentialsCard({
  matter,
  matterId,
  matterNumber,
  matterNumberManual = false,
  matterStatus,
  onStatusChange,
  statusSaving = false,
  details,
  designSheetPlanType,
  onSaveField,
  savingField,
  lastSavedAt,
  error,
  esignEnabled = false,
  engagementSending = false,
  onSendEngagement,
  onDraftEngagement,
}: MatterEssentialsCardProps) {
  const [generatingNumber, setGeneratingNumber] = useState(false)
  const [numberIsManual, setNumberIsManual] = useState(matterNumberManual)
  const engagementStatus = deriveEngagementStatus(details)
  const matterPlanType = normalizePlanType(details?.plan_type ?? matter.plan_type ?? 'TBD')
  const practiceArea = normalizePracticeArea(details?.practice_area ?? matter.practice_area)
  const actualSigningDate = matter.signing_date ?? details?.signing_date ?? null
  const planLabel = designSheetPlanType
    ? designPlanTypeLabel(designSheetPlanType)
    : MATTER_PLAN_TYPE_OPTIONS.find(option => option.value === matterPlanType)?.label ?? matterPlanType

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

  const readView = (
    <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
      <ReadValue label="Matter number" value={matterNumber ? `#${matterNumber}` : '—'} />
      <ReadValue label="Practice area" value={practiceAreaLabel(practiceArea)} />
      <ReadValue
        label="Target signing"
        value={details?.scheduled_signing_date ? formatDate(details.scheduled_signing_date) : '—'}
      />
      <ReadValue label="Actual signing" value={actualSigningDate ? formatDateDetail(actualSigningDate) : '—'} />
      <ReadValue
        label="Plan composition"
        value={<Link className="font-medium text-accent hover:underline" href={`/admin/drafting/${matterId}?step=design`}>{planLabel}</Link>}
      />
      <ReadValue label="Flat fee" value={currency(details?.flat_fee_amount ?? matter.fee_amount)} tabular />
      <ReadValue label="Payment status" value={paymentStatus(details)} />
      <ReadValue label="Attorney tax decision" value={taxDecision(details?.ep_ma_estate_taxable)} />
      <ReadValue label="Engagement" value={engagementStatusLabel(engagementStatus)} />
      <ReadValue label="Referral source" value={details?.referral_source ?? matter.referral_source ?? '—'} />
    </dl>
  )

  return (
    <ReadFirstPanel
      title="Matter essentials"
      readView={readView}
      savingField={savingField}
      lastSavedAt={lastSavedAt}
      error={error}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1.5">
          <FieldLabel>Matter number</FieldLabel>
          <Input
            className="h-9 tabular-nums"
            defaultValue={matterNumber ?? ''}
            onBlur={event => {
              void onSaveField('matter_number', event.target.value).then(() => setNumberIsManual(true))
            }}
          />
          {!numberIsManual && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-0 text-xs"
              disabled={generatingNumber}
              onClick={() => void generateMatterNumber()}
            >
              <Zap className="h-3 w-3" />
              {generatingNumber ? 'Generating…' : 'Auto-generate'}
            </Button>
          )}
        </label>

        <div className="space-y-1.5">
          <FieldLabel>Practice area</FieldLabel>
          <Select value={practiceArea} onValueChange={value => void onSaveField('practice_area', value)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRACTICE_AREA_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="space-y-1.5">
          <FieldLabel>Target signing date</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={targetSigningDateInput(details?.scheduled_signing_date)}
            onBlur={event => void onSaveField(
              'scheduled_signing_date',
              event.target.value ? normalizeTargetSigningDate(event.target.value) : null,
            )}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Signing date</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={typeof actualSigningDate === 'string' ? actualSigningDate.slice(0, 10) : ''}
            onBlur={event => void onSaveField('signing_date', event.target.value)}
          />
        </label>

        <div className="space-y-1.5">
          <FieldLabel>Plan composition</FieldLabel>
          <Select value={matterPlanType} onValueChange={value => void onSaveField('plan_type', value)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MATTER_PLAN_TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link className="text-xs font-medium text-accent hover:underline" href={`/admin/drafting/${matterId}?step=design`}>
            Open design sheet
          </Link>
        </div>

        <label className="space-y-1.5">
          <FieldLabel>Flat fee</FieldLabel>
          <Input
            type="number"
            min={0}
            step="0.01"
            className="h-9 text-right tabular-nums"
            defaultValue={details?.flat_fee_amount ?? matter.fee_amount ?? ''}
            onBlur={event => void onSaveField('flat_fee_amount', event.target.value ? Number(event.target.value) : null)}
          />
        </label>

        <div className="space-y-1.5">
          <FieldLabel>Payment status</FieldLabel>
          <Select
            value={details?.fee_payment_status ?? (details?.fee_collected ? 'paid_in_full' : 'unpaid')}
            onValueChange={value => void onSaveField('fee_payment_status', value)}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="deposit">Deposit</SelectItem>
              <SelectItem value="paid_in_full">Paid in full</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Matter status</FieldLabel>
          <Select
            value={matterStatus}
            disabled={statusSaving}
            onValueChange={value => onStatusChange(value as MatterStatus)}
          >
            <SelectTrigger className="h-9" aria-label="Matter status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MATTER_STATUSES.map(option => (
                <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Attorney tax decision</FieldLabel>
          <Select
            value={details?.ep_ma_estate_taxable === true ? 'tax-sensitive' : details?.ep_ma_estate_taxable === false ? 'not-tax-sensitive' : 'not-reviewed'}
            onValueChange={value => void onSaveField('ep_ma_estate_taxable', value === 'not-reviewed' ? null : value === 'tax-sensitive')}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="not-reviewed">Not reviewed</SelectItem>
              <SelectItem value="tax-sensitive">Tax-sensitive</SelectItem>
              <SelectItem value="not-tax-sensitive">Not tax-sensitive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Referral source</FieldLabel>
          <Input
            className="h-9"
            defaultValue={details?.referral_source ?? matter.referral_source ?? ''}
            onBlur={event => void onSaveField('referral_source', event.target.value)}
          />
        </label>

        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Engagement</FieldLabel>
          <div className="flex min-h-9 flex-wrap items-center gap-2">
            <Select
              value={engagementStatus}
              onValueChange={value => void onSaveField('engagement_status', value)}
            >
              <SelectTrigger className="h-9 w-36" aria-label="Engagement status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {engagementStatus === 'declined' && (
                  <SelectItem value="declined">Declined</SelectItem>
                )}
                {ENGAGEMENT_STATUS_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {esignEnabled && engagementStatus !== 'signed' && (
              <Button type="button" size="sm" variant="outline" disabled={engagementSending} onClick={onSendEngagement}>
                {engagementSending ? 'Sending…' : details?.engagement_sent_at ? 'Resend' : 'Send engagement'}
              </Button>
            )}
            {engagementStatus !== 'signed' && (
              <Button type="button" size="sm" variant="ghost" disabled={engagementSending} onClick={onDraftEngagement}>
                Draft engagement
              </Button>
            )}
          </div>
        </div>
      </div>
    </ReadFirstPanel>
  )
}
