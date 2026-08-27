'use client'

import { AlertCircle, Check, Circle } from 'lucide-react'
import { openCornerstoneAssistant } from '@/app/admin/components/adminChatEvents'
import { Button } from '@/components/ui/button'
import { calculateMAEstateTax, MA_ESTATE_TAX_EXEMPTION } from '@/lib/estateTax'
import type { LeadEditableField } from '@/lib/leads/details'
import { computeLeadReadiness } from '@/lib/leads/readiness'
import { cn } from '@/lib/utils'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'

const TAX_WORKSHEET_PROMPT = 'Analyze MA estate tax exposure'

export type LeadPlanTabProps = {
  lead: LeadDetailRecord
  spouse: LeadSpouseRecord | null
  agreementId: string | null
  busy: boolean
  onDraft: () => void
  onPreviewAgreement: () => void
  onOpenField: (field: LeadEditableField) => void
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`

export function LeadPlanTab({
  lead,
  spouse,
  agreementId,
  busy,
  onDraft,
  onPreviewAgreement,
  onOpenField,
}: LeadPlanTabProps) {
  const readiness = computeLeadReadiness(lead, spouse)
  const estate = typeof lead.taxable_estate === 'number' ? lead.taxable_estate : null
  const exposure = estate === null ? null : calculateMAEstateTax(estate)
  const thresholdShare = estate === null
    ? 0
    : Math.min(100, Math.round((estate / MA_ESTATE_TAX_EXEMPTION) * 100))
  const overThreshold = estate !== null && estate > MA_ESTATE_TAX_EXEMPTION

  return (
    // A container so the tab reflows against its own width — it renders both in
    // the index side panel and full width on the record page.
    <div className="@container/plan space-y-4">
      <div className="flex flex-col gap-4 @3xl/plan:flex-row @3xl/plan:items-start">
        <section aria-label="What the engagement needs" className="flex-1 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">What the engagement needs</h3>
          <ul className="mt-3 space-y-1.5">
            {readiness.items.map(item => {
              const outstanding = !item.complete && item.required
              const Icon = item.complete ? Check : outstanding ? AlertCircle : Circle
              // 'intake' and 'engagement' are gates, not rail fields: the
              // intake card above owns the first and the buttons below the
              // second.
              const field = item.key === 'intake' || item.key === 'engagement' ? null : item.key
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
                  {outstanding && field && (
                    <button
                      type="button"
                      className="rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onOpenField(field)}
                    >
                      Add {item.label.toLowerCase()}
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
          className="rounded-lg border border-border bg-card p-4 @3xl/plan:w-[320px] @3xl/plan:shrink-0"
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
