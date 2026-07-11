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
import { MATTER_PLAN_TYPE_OPTIONS, normalizePlanType } from '@/lib/matterPlanType'
import { PRACTICE_AREA_OPTIONS, normalizePracticeArea } from '@/lib/practiceArea'
import type { PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

interface MatterEssentialsCardProps {
  matter: PipelineMatter
  details: MatterDetailsRow | null
  designSheetPlanType?: string | null
  intakeCompletedAt?: string | null
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

function resolveDate(...candidates: Array<string | null | undefined>): string | null {
  for (const value of candidates) {
    if (value && value.trim()) return value
  }
  return null
}

type Milestone = {
  key: string
  label: string
  date: string | null
  complete: boolean
}

function MilestoneCell({ milestone, isLast }: { milestone: Milestone; isLast: boolean }) {
  return (
    <div className={cn('relative min-w-0 flex-1 px-2 first:pl-0 last:pr-0', !isLast && 'sm:border-r sm:border-border')}>
      <FieldLabel>{milestone.label}</FieldLabel>
      <p
        className={cn(
          'mt-1 text-sm font-medium',
          milestone.complete ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {milestone.date ? formatDate(milestone.date) : '—'}
      </p>
    </div>
  )
}

export function MatterEssentialsCard({
  matter,
  details,
  designSheetPlanType,
  intakeCompletedAt,
  onSaveField,
}: MatterEssentialsCardProps) {

  const matterPlanType = normalizePlanType(details?.plan_type ?? matter.plan_type ?? 'TBD')
  const designPlanTypeNote = designSheetPlanType
    ? designPlanTypeLabel(designSheetPlanType)
    : null

  const practiceArea = normalizePracticeArea(details?.practice_area ?? matter.practice_area)

  const actualSigningDate = matter.signing_date ?? details?.signing_date ?? null

  const opened = resolveDate(details?.open_date, matter.matter_created)
  const intakeDone = resolveDate(intakeCompletedAt, matter.intake_submitted_at, details?.intake_date)
  const draftsSent = resolveDate(matter.drafts_sent_at, details?.draft_sent_date)
  const signing = resolveDate(matter.signing_date, details?.signing_date, details?.scheduled_signing_date)
  const closed = resolveDate(details?.closed_date)

  const milestones: Milestone[] = [
    { key: 'opened', label: 'Opened', date: opened, complete: Boolean(opened) },
    { key: 'intake', label: 'Intake done', date: intakeDone, complete: Boolean(intakeDone) },
    { key: 'drafts', label: 'Drafts sent', date: draftsSent, complete: Boolean(draftsSent) },
    { key: 'signing', label: 'Signing', date: signing, complete: Boolean(signing) },
    {
      key: 'closed',
      label: 'Closed',
      date: closed,
      complete: matter.stage === 'closed' || Boolean(closed),
    },
  ]

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <h3 className="mb-4 text-sm font-semibold">Matter essentials</h3>
      <div className="mb-4 flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:gap-0">
        {milestones.map((milestone, index) => (
          <MilestoneCell
            key={milestone.key}
            milestone={milestone}
            isLast={index === milestones.length - 1}
          />
        ))}
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
          <Select
            value={matterPlanType}
            onValueChange={value => void onSaveField('plan_type', value)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATTER_PLAN_TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {designPlanTypeNote && (
            <p className="text-[11px] text-muted-foreground">
              Design sheet: {designPlanTypeNote}
            </p>
          )}
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
