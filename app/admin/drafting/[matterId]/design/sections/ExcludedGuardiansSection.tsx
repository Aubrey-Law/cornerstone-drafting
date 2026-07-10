'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import type { MatterContact } from '@/types/database'
import {
  formatExcludedGuardianName,
  getExcludedGuardians,
  setExcludedGuardians,
  type ExcludedGuardianEntry,
} from '@/lib/designSheet/excludedGuardians'
import DesignContactPicker, { type Contact as PickerContact } from './ContactPicker'
import type { SectionProps } from './shared'
import { AttorneyInput, FieldLabel, SectionBlock } from './shared'

interface ExcludedGuardiansProps extends SectionProps {
  contacts: MatterContact[]
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

export function ExcludedGuardians({
  sheet,
  onChange,
  contacts,
  onAddContact,
  onUpdateContact,
}: ExcludedGuardiansProps) {
  const enabled = Boolean(sheet.excluded_guardian_flag)
  const entries = getExcludedGuardians(sheet)
  const pickerContacts = contacts as unknown as PickerContact[]

  const applyEntries = (
    updater: (current: ExcludedGuardianEntry[]) => ExcludedGuardianEntry[],
    options?: { flag?: boolean },
  ) => {
    const flag = options?.flag ?? enabled
    onChange('decisions', prevSheet => {
      const nextEntries = updater(getExcludedGuardians(prevSheet))
      return setExcludedGuardians(prevSheet, nextEntries)
    })
    onChange('excluded_guardian_name', prevSheet => {
      if (!flag) return null
      return formatExcludedGuardianName(getExcludedGuardians(prevSheet), contacts)
    })
  }

  const updateEntry = (index: number, patch: Partial<ExcludedGuardianEntry>) => {
    applyEntries(current =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    )
  }

  const addEntry = () => {
    applyEntries(current => [...current, { contact_id: '', reason: null }])
  }

  const removeEntry = (index: number) => {
    applyEntries(current => current.filter((_, i) => i !== index))
  }

  const contactById = (id: string): PickerContact | null =>
    (contacts.find(contact => contact.id === id) ?? null) as unknown as PickerContact | null

  const adaptAdd = (data: Omit<PickerContact, 'id'>) =>
    onAddContact(data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<PickerContact>
  const adaptUpdate = onUpdateContact
    ? (id: string, data: Omit<PickerContact, 'id'>) =>
        onUpdateContact(id, data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<PickerContact>
    : undefined

  return (
    <SectionBlock title="Excluded Guardian(s)">
      <label className="flex items-start gap-2">
        <Checkbox
          checked={enabled}
          onCheckedChange={checked => {
            const next = checked === true
            onChange('excluded_guardian_flag', next)
            if (!next) {
              applyEntries(() => [], { flag: false })
            } else {
              applyEntries(
                current => (current.length > 0 ? current : [{ contact_id: '', reason: null }]),
                { flag: true },
              )
            }
          }}
        />
        <span className="text-xs leading-5 text-foreground">
          Exclude one or more individuals from serving as guardian
        </span>
      </label>

      {enabled && (
        <div className="mt-4 space-y-4">
          {entries.map((entry, index) => (
            <div key={`excluded-guardian-${index}`} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <FieldLabel>Excluded individual</FieldLabel>
                  <DesignContactPicker
                    role="Excluded Guardian"
                    value={entry.contact_id ? contactById(entry.contact_id) : null}
                    contacts={pickerContacts}
                    onAddContact={adaptAdd}
                    onUpdateContact={adaptUpdate}
                    onChange={contact => updateEntry(index, { contact_id: contact?.id ?? '' })}
                  />
                </div>
                <div>
                  <AttorneyInput
                    label="Reason"
                    value={entry.reason ?? ''}
                    placeholder="e.g. estranged"
                    onChange={value => updateEntry(index, { reason: value || null })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-destructive hover:text-destructive"
                  onClick={() => removeEntry(index)}
                  disabled={entries.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addEntry}>
            <Plus className="h-3.5 w-3.5" />
            Add excluded guardian
          </Button>
        </div>
      )}
    </SectionBlock>
  )
}
