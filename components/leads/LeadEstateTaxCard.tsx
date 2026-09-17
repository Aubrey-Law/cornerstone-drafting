'use client'

import { openCornerstoneAssistant } from '@/app/admin/components/adminChatEvents'
import { Button } from '@/components/ui/button'
import { calculateMAEstateTax, MA_ESTATE_TAX_EXEMPTION } from '@/lib/estateTax'
import type { LeadEditableField } from '@/lib/leads/details'
import { cn } from '@/lib/utils'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

const TAX_WORKSHEET_PROMPT = 'Analyze MA estate tax exposure'

const money = (value: number) => `$${Math.round(value).toLocaleString()}`

/**
 * The estate against the Massachusetts threshold, read off the same field the
 * rail edits — so it sits with the fields rather than in the workspace.
 */
export function LeadEstateTaxCard({
  lead,
  onOpenField,
  className,
}: {
  lead: LeadDetailRecord
  onOpenField: (field: LeadEditableField) => void
  className?: string
}) {
  const estate = typeof lead.taxable_estate === 'number' ? lead.taxable_estate : null
  const exposure = estate === null ? null : calculateMAEstateTax(estate)
  const thresholdShare = estate === null
    ? 0
    : Math.min(100, Math.round((estate / MA_ESTATE_TAX_EXEMPTION) * 100))
  const overThreshold = estate !== null && estate > MA_ESTATE_TAX_EXEMPTION

  return (
    <section
      aria-label="Estate tax at a glance"
      className={cn('rounded-lg border border-border bg-card p-3', className)}
    >
      <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
        Estate tax at a glance
      </h3>
      {estate === null ? (
        <>
          <p className="mt-2 text-xl font-semibold tabular-nums text-muted-foreground">Unknown</p>
          <p className="mt-1 text-micro text-muted-foreground">
            No estimated estate value on this lead yet.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => onOpenField('estimatedEstateValue')}
          >
            Add estate value
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-xl font-semibold tabular-nums">{money(estate)}</p>
          <div
            aria-label="Share of the Massachusetts threshold"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={thresholdShare}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className={cn('h-full transition-[width]', overThreshold ? 'bg-amber-orange' : 'bg-green')}
              style={{ width: `${thresholdShare}%` }}
            />
          </div>
          <p className="mt-2 text-micro text-muted-foreground">
            MA threshold {money(MA_ESTATE_TAX_EXEMPTION)} · exposure without planning ≈{' '}
            <span className="font-medium text-foreground tabular-nums">{money(exposure ?? 0)}</span>
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => openCornerstoneAssistant({ prompt: TAX_WORKSHEET_PROMPT, send: true })}
          >
            Run tax worksheet
          </Button>
        </>
      )}
    </section>
  )
}
