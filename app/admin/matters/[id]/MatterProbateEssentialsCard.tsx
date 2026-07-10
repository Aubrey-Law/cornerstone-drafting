'use client'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { MatterDetailsRow } from '@/types/matter-details'

interface MatterProbateEssentialsCardProps {
  details: MatterDetailsRow | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </span>
  )
}

export function MatterProbateEssentialsCard({ details, onSaveField }: MatterProbateEssentialsCardProps) {

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Probate essentials</h3>
        <p className="text-xs text-muted-foreground">
          Core probate filing and administration details for this matter.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <FieldLabel>Inventory due date</FieldLabel>
          <Input
            type="date"
            className="h-9"
            defaultValue={details?.pb_inventory_due_date ?? ''}
            onBlur={event => void onSaveField('pb_inventory_due_date', event.target.value)}
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
    </section>
  )
}
