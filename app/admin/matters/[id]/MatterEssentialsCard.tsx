'use client'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatDate } from '@/lib/utils'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import { planTypeLabel } from '@/lib/matterPlanType'
import { PRACTICE_AREA_OPTIONS, normalizePracticeArea } from '@/lib/practiceArea'
import type { PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

interface MatterEssentialsCardProps {
  matter: PipelineMatter
  details: MatterDetailsRow | null
  designSheetPlanType?: string | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </span>
  )
}

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return ''
  return String(value)
}

export function MatterEssentialsCard({
  matter,
  details,
  designSheetPlanType,
  onSaveField,
}: MatterEssentialsCardProps) {

  const planTypeDisplay =
    designPlanTypeLabel(designSheetPlanType) ||
    planTypeLabel(details?.plan_type ?? matter.plan_type) ||
    '—'

  const practiceArea = normalizePracticeArea(details?.practice_area ?? matter.practice_area)

  const actualSigningDate = matter.signing_date ?? details?.signing_date ?? null

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Matter essentials</h3>
        <p className="text-xs text-muted-foreground">
          Key operational fields — scheduling, fees, and engagement status.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <FieldLabel>Practice area</FieldLabel>
          <Select
            value={practiceArea}
            onValueChange={value => void onSaveField('practice_area', value)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRACTICE_AREA_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="space-y-1.5">
          <FieldLabel>Target signing date</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.scheduled_signing_date ?? ''}
            onBlur={event => void onSaveField('scheduled_signing_date', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Signing date</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={
              typeof actualSigningDate === 'string'
                ? actualSigningDate.slice(0, 10)
                : ''
            }
            onBlur={event => void onSaveField('signing_date', event.target.value)}
          />
        </label>

        <div className="space-y-1.5">
          <FieldLabel>Plan type</FieldLabel>
          <p className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-foreground">
            {planTypeDisplay}
          </p>
        </div>

        <label className="space-y-1.5">
          <FieldLabel>Flat fee</FieldLabel>
          <Input
            type="number"
            min={0}
            step="0.01"
            className="h-9"
            placeholder="0.00"
            defaultValue={formatMoney(details?.flat_fee_amount ?? matter.fee_amount)}
            onBlur={event => {
              const raw = event.target.value.trim()
              void onSaveField('flat_fee_amount', raw === '' ? null : Number(raw))
            }}
          />
        </label>

        <label className={cn('flex items-center gap-2 pt-6 sm:col-span-2')}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={Boolean(details?.fee_collected)}
            onChange={event => void onSaveField('fee_collected', event.target.checked)}
          />
          <span className="text-sm font-medium">Fee collected</span>
          {details?.fee_collected_date && (
            <span className="text-xs text-muted-foreground">
              ({formatDate(details.fee_collected_date)})
            </span>
          )}
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Fee collected date</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.fee_collected_date ?? ''}
            onBlur={event => void onSaveField('fee_collected_date', event.target.value)}
          />
        </label>

        <label className={cn('flex items-center gap-2 pt-6')}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={Boolean(details?.engagement_signed)}
            onChange={event => void onSaveField('engagement_signed', event.target.checked)}
          />
          <span className="text-sm font-medium">Engagement signed</span>
        </label>

        <label className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Referral source</FieldLabel>
          <Input
            className="h-9"
            placeholder="e.g. client referral, CPA, website"
            defaultValue={details?.referral_source ?? matter.referral_source ?? ''}
            onBlur={event => void onSaveField('referral_source', event.target.value)}
          />
        </label>
      </div>
    </section>
  )
}
