'use client'

import { useState } from 'react'
import { HOUSEHOLD_FIELDS } from '@/lib/intake/forms/staffHousehold'
import { CITIZENSHIP_STATUS_OPTIONS } from '@aubrey-law/estate-fields/core'
import { FormField, TextInput } from './IntakeFormPrimitives'
export type SavedHouseholdContact = { id: string; kind: string; expected: Record<string, string | null> }
export default function StaffHouseholdEditor({ block, contacts, disabled, update }: {
  block: string; contacts: SavedHouseholdContact[]; disabled: boolean; update: (value: unknown) => void
}) {
  const kind = block === 'children' ? 'child' : 'spouse'
  const entries = contacts.filter(contact => contact.kind === kind)
  const [id, setId] = useState(entries[0]?.id ?? '')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [patch, setPatch] = useState<Record<string, string>>({})
  const person = entries.find(row => row.id === id)
  const changed = Object.keys(patch).length > 0
  const options: Record<string, readonly { value: string; label: string }[]> = {
    citizenship_status: CITIZENSHIP_STATUS_OPTIONS,
    child_relationship: ['biological','adopted','stepchild'].map(value => ({ value, label: value })),
    parentage: [{ value: 'client', label: 'Client' }, { value: 'spouse', label: 'Spouse' }, { value: 'joint', label: 'Both' }],
  }
  return <fieldset disabled={disabled} className="space-y-3 border-0 p-0">
    <p className="text-sm text-muted-foreground">Save or cancel one household change at a time.</p>
    {!adding && entries.length > 0 && <FormField label="Household contact"><select className="w-full rounded border bg-background p-2" value={id} disabled={changed || removing} onChange={e => { setId(e.target.value); update(null) }}>
      {entries.map(row => <option key={row.id} value={row.id}>{[row.expected.first_name,row.expected.last_name].filter(Boolean).join(' ')}</option>)}
    </select></FormField>}
    {!adding && (kind === 'child' || !entries.length) && <button type="button" className="text-sm underline" disabled={changed || removing} onClick={() => { setId(crypto.randomUUID()); setAdding(true); setPatch({}); update(null) }}>Add {kind}</button>}
    {person && !adding && !removing && <button type="button" className="ml-3 text-sm text-destructive underline" disabled={changed} onClick={() => { setRemoving(true); update({ operation: 'remove', contactId: id, expected: person.expected, patch: {} }) }}>Remove from household</button>}
    {removing ? <p role="status">Save to remove this person from the household. Their contact record is retained. People with appointments cannot be removed here.</p> : (adding || person) && <div className="grid gap-3 sm:grid-cols-2">
      {HOUSEHOLD_FIELDS.filter(([key]) => kind === 'child' || !['child_relationship','parentage'].includes(key)).map(([key,label]) => {
        const value = patch[key] ?? (adding ? '' : person?.expected[key]) ?? ''
        const change = (value: string) => { const next = { ...patch, [key]: value }; setPatch(next); update({ operation: adding ? 'add' : 'edit', contactId: id, expected: adding ? null : person!.expected, patch: next }) }
        return <FormField key={key} label={label}>{options[key] ? <select className="w-full rounded border bg-background p-2" value={value} onChange={e => change(e.target.value)}>
          <option value="">Not provided</option>{options[key].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : <TextInput type={key === 'date_of_birth' ? 'date' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={value} onChange={change} />}</FormField>
      })}
    </div>}
  </fieldset>
}
