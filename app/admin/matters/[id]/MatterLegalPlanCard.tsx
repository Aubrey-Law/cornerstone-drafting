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
import { ReadFirstPanel, ReadValue } from './ReadFirstPanel'

const LEGAL_PLANS = ['MetLife', 'ARAG', 'LegalEase', 'Other'] as const

interface MatterLegalPlanCardProps {
  details: MatterDetailsRow | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
  savingField?: keyof MatterDetailsRow | null
  lastSavedAt?: string | null
  error?: string | null
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-medium text-muted-foreground">
      {children}
    </span>
  )
}

export function MatterLegalPlanCard({
  details,
  onSaveField,
  savingField,
  lastSavedAt,
  error,
}: MatterLegalPlanCardProps) {

  return (
    <ReadFirstPanel
      title="Legal plan"
      description="Prepaid legal plan coverage for this matter."
      savingField={savingField}
      lastSavedAt={lastSavedAt}
      error={error}
      readView={(
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReadValue label="Plan" value={details?.legal_plan ?? '—'} />
          <ReadValue label="Service start" value={details?.legal_plan_service_start ?? '—'} />
          <ReadValue label="Service end" value={details?.legal_plan_service_end ?? '—'} />
          <ReadValue label="Client status" value={details?.client_status ?? '—'} />
        </dl>
      )}
    >
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
    </ReadFirstPanel>
  )
}
