'use client'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MatterDetailsRow } from '@/types/matter-details'

const LEGAL_PLANS = ['MetLife', 'ARAG', 'LegalEase', 'Other'] as const

interface MatterLegalPlanCardProps {
  details: MatterDetailsRow | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}

export function MatterLegalPlanCard({ details, onSaveField }: MatterLegalPlanCardProps) {

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Legal plan</h3>
        <p className="text-xs text-muted-foreground">
          MetLife, ARAG, or other prepaid legal plan coverage for this matter.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1.5">
          <FieldLabel>Plan</FieldLabel>
          <Select
            value={details?.legal_plan ?? 'none'}
            onValueChange={value => void onSaveField('legal_plan', value === 'none' ? null : value)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select plan…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {LEGAL_PLANS.map(plan => (
                <SelectItem key={plan} value={plan}>
                  {plan}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Service start</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.legal_plan_service_start ?? ''}
            onBlur={event => void onSaveField('legal_plan_service_start', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Service end</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.legal_plan_service_end ?? ''}
            onBlur={event => void onSaveField('legal_plan_service_end', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Client status</FieldLabel>
          <Input
            className="h-9"
            placeholder="e.g. active member"
            defaultValue={details?.client_status ?? ''}
            onBlur={event => void onSaveField('client_status', event.target.value)}
          />
        </label>
      </div>
    </section>
  )
}
