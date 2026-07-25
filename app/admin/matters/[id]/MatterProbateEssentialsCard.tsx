'use client'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { MatterDetailsRow } from '@/types/matter-details'
import { ReadFirstPanel, ReadValue } from './ReadFirstPanel'

interface MatterProbateEssentialsCardProps {
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

export function MatterProbateEssentialsCard({
  details,
  onSaveField,
  savingField,
  lastSavedAt,
  error,
}: MatterProbateEssentialsCardProps) {

  return (
    <ReadFirstPanel
      title="Probate essentials"
      description="Core probate filing and administration details."
      savingField={savingField}
      lastSavedAt={lastSavedAt}
      error={error}
      readView={(
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReadValue label="Decedent name" value={details?.pb_decedent_name ?? '—'} />
          <ReadValue label="Date of death" value={details?.pb_date_of_death ?? '—'} />
          <ReadValue label="Court" value={details?.pb_court_name ?? '—'} />
          <ReadValue label="Docket number" value={details?.pb_docket_number ?? '—'} />
          <ReadValue label="Personal representative" value={details?.pb_personal_representative ?? '—'} />
          <ReadValue label="PR appointed" value={details?.pb_pr_appointment_date ?? '—'} />
          <ReadValue label="Inventory due" value={details?.pb_inventory_due_date ?? '—'} />
          <ReadValue label="Claims period ends" value={details?.pb_claims_period_end_date ?? '—'} />
        </dl>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1.5">
          <FieldLabel>Decedent name</FieldLabel>
          <Input
            className="h-9"
            defaultValue={details?.pb_decedent_name ?? ''}
            onBlur={event => void onSaveField('pb_decedent_name', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Date of death</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.pb_date_of_death ?? ''}
            onBlur={event => void onSaveField('pb_date_of_death', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Court</FieldLabel>
          <Input
            className="h-9"
            defaultValue={details?.pb_court_name ?? ''}
            onBlur={event => void onSaveField('pb_court_name', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Docket number</FieldLabel>
          <Input
            className="h-9"
            defaultValue={details?.pb_docket_number ?? ''}
            onBlur={event => void onSaveField('pb_docket_number', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Personal representative</FieldLabel>
          <Input
            className="h-9"
            defaultValue={details?.pb_personal_representative ?? ''}
            onBlur={event => void onSaveField('pb_personal_representative', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>PR appointed</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.pb_pr_appointment_date ?? ''}
            onBlur={event => void onSaveField('pb_pr_appointment_date', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Inventory due date</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.pb_inventory_due_date ?? ''}
            onBlur={event => void onSaveField('pb_inventory_due_date', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>Claims period ends</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.pb_claims_period_end_date ?? ''}
            onBlur={event => void onSaveField('pb_claims_period_end_date', event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <FieldLabel>MA estate tax return due</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.pb_m706_due_date ?? ''}
            onBlur={event => void onSaveField('pb_m706_due_date', event.target.value)}
          />
        </label>

        <label className={cn('flex items-center gap-2 pt-6 sm:col-span-2')}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={Boolean(details?.pb_estate_closed)}
            onChange={event => void onSaveField('pb_estate_closed', event.target.checked)}
          />
          <span className="text-sm font-medium">Estate closed</span>
        </label>
      </div>
    </ReadFirstPanel>
  )
}
