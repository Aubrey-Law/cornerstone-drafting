'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toDateInputValue } from '@/lib/dob'
import {
  getEstatePlanDesignSetup,
  setEstatePlanDesignSetup,
} from '@/lib/designSheetDocumentInclusions'
import {
  AttorneyDateInput,
  AttorneySelect,
  DecisionRow,
  FieldLabel,
  sectionFieldGrid3,
  type SectionProps,
} from './shared'

const SIGNING_COUNTY_OPTIONS = [
  'Barnstable', 'Berkshire', 'Bristol', 'Dukes', 'Essex', 'Franklin',
  'Hampden', 'Hampshire', 'Middlesex', 'Nantucket', 'Norfolk', 'Plymouth',
  'Suffolk', 'Worcester',
]

export function SigningMechanicsSection({ sheet, onChange }: SectionProps) {
  const [open, setOpen] = useState(false)
  const setup = getEstatePlanDesignSetup(sheet)

  const updateSetup = (patch: Parameters<typeof setEstatePlanDesignSetup>[1]) => {
    onChange('decisions', previous => setEstatePlanDesignSetup(previous, patch))
  }

  const handleSigningDateChange = (value: string) => {
    if (!value) {
      onChange('signing_date', null)
      onChange('signing_month', null)
      onChange('signing_year', null)
      return
    }
    onChange('signing_date', value)
    const date = new Date(`${value}T12:00:00`)
    onChange('signing_month', date.toLocaleString('en-US', { month: 'long' }))
    onChange('signing_year', String(date.getFullYear()))
  }

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-dashed border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
        aria-expanded={open}
        aria-controls="signing-mechanics-content"
        onClick={() => setOpen(current => !current)}
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Signing mechanics</span>
          <span className="block text-xs text-muted-foreground">Completed at the signing meeting</span>
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
          Deferred
        </span>
      </button>
      <div id="signing-mechanics-content" className={open ? 'border-t border-border p-5' : 'hidden'}>
        <div className={sectionFieldGrid3}>
          <div id="design-field-signing_type" tabIndex={-1}>
            <DecisionRow
              question="Signing type"
              help="Completed at the signing meeting; this never blocks drafting."
              value={setup.signing_type}
              options={[
                { value: 'undecided', label: 'Undecided' },
                { value: 'attorney_supervised', label: 'Attorney Supervised' },
                { value: 'independent_client', label: 'Independent Client' },
              ]}
              onChange={value => updateSetup({ signing_type: value })}
            />
          </div>
          <div id="design-field-signing_date" tabIndex={-1}>
            <FieldLabel>Signing Date</FieldLabel>
            <Input
              type="date"
              value={toDateInputValue(sheet.signing_date)}
              onChange={event => handleSigningDateChange(event.target.value)}
              className="h-10"
            />
          </div>
          <AttorneySelect
            fieldName="signing_county"
            label="Signing County"
            value={sheet.signing_county ?? ''}
            placeholder="Select..."
            options={SIGNING_COUNTY_OPTIONS.map(county => ({ value: county, label: county }))}
            onChange={value => onChange('signing_county', value || null)}
          />
          <AttorneyDateInput
            fieldName="notary_commission_expiration"
            label="Notary Commission Expiration"
            value={sheet.notary_commission_expiration ?? ''}
            onChange={value => onChange('notary_commission_expiration', value || null)}
          />
        </div>
      </div>
    </section>
  )
}
