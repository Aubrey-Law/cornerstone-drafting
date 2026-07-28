'use client'

import { AlertCircle, Check, Circle } from 'lucide-react'
import { openCornerstoneAssistant } from '@/app/admin/components/adminChatEvents'
import { Button } from '@/components/ui/button'
import { calculateMAEstateTax, MA_ESTATE_TAX_EXEMPTION } from '@/lib/estateTax'
import type { LeadEditableField } from '@/lib/leads/details'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'
import { computeLeadReadiness, engagementStarted, intakeCompleted } from '@/lib/leads/readiness'
import { cn, formatDate } from '@/lib/utils'
import type { IntakeRow } from '@/lib/intakeSections'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'

const TAX_WORKSHEET_PROMPT = 'Analyze MA estate tax exposure'

type GateState = 'complete' | 'current' | 'upcoming'

type Gate = {
  key: string
  title: string
  /** Short state word shown under the title. */
  word: string
  date: string | null
  satisfied: boolean
  state: GateState
}

export type LeadPlanTabProps = {
  lead: LeadDetailRecord
  spouse: LeadSpouseRecord | null
  nextAppointmentAt: string | null
  lastMeetingAt: string | null
  hasActiveAgreement: boolean
  agreementId: string | null
  busy: boolean
  onDraft: () => void
  onPreviewAgreement: () => void
  onOpenField: (field: LeadEditableField) => void
  onOpenIntake: () => void
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`

function shortDate(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return formatDate(value)
}

function buildGates({
  lead,
  nextAppointmentAt,
  lastMeetingAt,
  hasActiveAgreement,
}: {
  lead: LeadDetailRecord
  nextAppointmentAt: string | null
  lastMeetingAt: string | null
  hasActiveAgreement: boolean
}): Gate[] {
  const intakeDone = intakeCompleted(lead)
  const intakeSent = Boolean(lead.intake_sent_at)
  const intakeSegments = getLeadIntakeProgress(lead as IntakeRow)
  const intakeComplete = intakeSegments.filter(segment => segment.complete).length
  const signed = Boolean(lead.engagement_signed_at)
  const sent = Boolean(lead.engagement_sent_at) || engagementStarted(lead)
  const hired = lead.lead_status === 'hired' && Boolean(lead.matter_id)

  const raw: Omit<Gate, 'state'>[] = [
    {
      key: 'contact',
      title: '1 · Contact',
      word: 'Logged',
      date: shortDate(lead.created_at),
      satisfied: true,
    },
    {
      key: 'meeting',
      title: '2 · Meeting',
      word: lastMeetingAt ? 'Held' : nextAppointmentAt ? 'Scheduled' : 'Not scheduled',
      date: shortDate(lastMeetingAt ?? nextAppointmentAt),
      satisfied: Boolean(lastMeetingAt),
    },
    {
      key: 'intake',
      title: '3 · Intake',
      word: intakeDone
        ? `Complete · ${intakeComplete} of ${intakeSegments.length}`
        : intakeSent
          ? `Sent · ${intakeComplete} of ${intakeSegments.length}`
          : 'Not sent',
      date: shortDate(lead.intake_completed_at ?? lead.intake_sent_at),
      satisfied: intakeDone,
    },
    {
      key: 'engagement',
      title: '4 · Engagement',
      word: signed ? 'Signed' : sent ? 'Sent' : hasActiveAgreement ? 'Drafted' : 'Not started',
      date: shortDate(lead.engagement_signed_at ?? lead.engagement_sent_at),
      satisfied: signed,
    },
    {
      key: 'hire',
      title: '5 · Hire',
      word: hired ? 'Hired' : 'Not yet',
      date: null,
      satisfied: hired,
    },
  ]

  const currentIndex = raw.findIndex(gate => !gate.satisfied)
  return raw.map((gate, index) => ({
    ...gate,
    state: gate.satisfied
      ? 'complete'
      : index === currentIndex
        ? 'current'
        : 'upcoming',
  }))
}

const GATE_CLASSES: Record<GateState, string> = {
  complete: 'border-l-green text-green',
  current: 'border-l-amber-orange bg-amber-bg text-amber',
  upcoming: 'border-l-border text-muted-foreground',
}

export function LeadPlanTab({
  lead,
  spouse,
  nextAppointmentAt,
  lastMeetingAt,
  hasActiveAgreement,
  agreementId,
  busy,
  onDraft,
  onPreviewAgreement,
  onOpenField,
  onOpenIntake,
}: LeadPlanTabProps) {
  const gates = buildGates({ lead, nextAppointmentAt, lastMeetingAt, hasActiveAgreement })
  const readiness = computeLeadReadiness(lead, spouse)
  const estate = typeof lead.taxable_estate === 'number' ? lead.taxable_estate : null
  const exposure = estate === null ? null : calculateMAEstateTax(estate)
  const thresholdShare = estate === null
    ? 0
    : Math.min(100, Math.round((estate / MA_ESTATE_TAX_EXEMPTION) * 100))
  const overThreshold = estate !== null && estate > MA_ESTATE_TAX_EXEMPTION

  return (
    <div className="space-y-4">
      <ol aria-label="Lead pipeline gates" className="grid grid-cols-5 gap-2">
        {gates.map(gate => (
          <li
            key={gate.key}
            className={cn(
              'rounded-md border border-border border-l-[3px] bg-card px-2 py-2',
              GATE_CLASSES[gate.state],
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide">{gate.title}</p>
            <p className="mt-1 truncate text-xs font-medium">{gate.word}</p>
            <p className="text-[11px] text-muted-foreground">
              {gate.state === 'current' ? "You're here" : gate.date ?? '—'}
            </p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <section aria-label="What the engagement needs" className="flex-1 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">What the engagement needs</h3>
          <ul className="mt-3 space-y-1.5">
            {readiness.items.map(item => {
              const outstanding = !item.complete && item.required
              const Icon = item.complete ? Check : outstanding ? AlertCircle : Circle
              return (
                <li key={item.key} className="flex items-center gap-2 text-xs">
                  <Icon
                    aria-hidden
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      item.complete ? 'text-green' : outstanding ? 'text-amber' : 'text-muted-foreground',
                    )}
                  />
                  <span className={item.complete ? 'text-foreground' : outstanding ? 'text-amber' : 'text-muted-foreground'}>
                    {item.label}
                  </span>
                  {outstanding && (
                    <button
                      type="button"
                      className="rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        if (item.key === 'intake') onOpenIntake()
                        else if (item.key !== 'engagement') onOpenField(item.key)
                      }}
                    >
                      {item.key === 'intake' ? 'Open intake' : `Add ${item.label.toLowerCase()}`}
                    </button>
                  )}
                </li>
              )
            })}
            {overThreshold && (
              <li className="flex items-center gap-2 text-xs">
                <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber" />
                <span className="text-amber">MA estate tax judgment</span>
                <button
                  type="button"
                  className="rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openCornerstoneAssistant({ prompt: TAX_WORKSHEET_PROMPT, send: true })}
                >
                  Run tax worksheet
                </button>
              </li>
            )}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
            <Button type="button" size="sm" disabled={busy || lead.lead_status !== 'lead'} onClick={onDraft}>
              Draft &amp; send via SignWell
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !agreementId}
              onClick={onPreviewAgreement}
            >
              Preview agreement
            </Button>
          </div>
        </section>

        <section
          aria-label="Estate tax at a glance"
          className="rounded-lg border border-border bg-card p-4 xl:w-[320px] xl:shrink-0"
        >
          <h3 className="text-sm font-semibold">Estate tax at a glance</h3>
          {estate === null ? (
            <>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-muted-foreground">Unknown</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                No estimated estate value on this lead yet.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => onOpenField('estimatedEstateValue')}
              >
                Add estate value
              </Button>
            </>
          ) : (
            <>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{money(estate)}</p>
              <div
                aria-label="Share of the Massachusetts threshold"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={thresholdShare}
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
              >
                <div
                  className={cn('h-full transition-[width]', overThreshold ? 'bg-amber-orange' : 'bg-green')}
                  style={{ width: `${thresholdShare}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                MA threshold {money(MA_ESTATE_TAX_EXEMPTION)} · exposure without planning ≈{' '}
                <span className="font-medium text-foreground tabular-nums">{money(exposure ?? 0)}</span>
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => openCornerstoneAssistant({ prompt: TAX_WORKSHEET_PROMPT, send: true })}
              >
                Run tax worksheet
              </Button>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
