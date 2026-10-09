'use client'

import { useState } from 'react'
import { STAFF_CONTACT_FIELDS } from '@/lib/intake/forms/staffContactEditing'
import { FormField, TextInput } from './IntakeFormPrimitives'

type Contact = { id: string; _staff_edit_snapshot: Record<string, string | null> }
export default function StaffAdditionalContactEditor({ contacts, removed, disabled, update }: {
  contacts: unknown
  removed?: unknown
  disabled: boolean
  update: (value: unknown) => void
}) {
  const entries = (Array.isArray(contacts) ? contacts : []).filter((entry): entry is Contact =>
    entry && typeof entry.id === 'string' && entry._staff_edit_snapshot && typeof entry._staff_edit_snapshot === 'object')
  const [contactId, setContactId] = useState(entries[0]?.id ?? '')
  const [patch, setPatch] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'edit' | 'add' | 'remove'>('edit')
  const [newId, setNewId] = useState('')
  const [restoreId, setRestoreId] = useState('')
  const retained = (Array.isArray(removed) ? removed : []).filter((entry): entry is Contact =>
    entry && typeof entry.id === 'string' && entry._staff_edit_snapshot && typeof entry._staff_edit_snapshot === 'object')
  const contact = entries.find(entry => entry.id === contactId)
  return <fieldset disabled={disabled} className="space-y-3 border-0 p-0">
    <p className="text-sm text-muted-foreground">Save or cancel one contact change before starting another.</p>
    {mode === 'edit' && retained.length > 0 && <FormField label="Restore removed contact">
      <select className="w-full rounded border bg-background p-2" value={restoreId} disabled={Object.keys(patch).length > 0} onChange={event => {
        setRestoreId(event.target.value)
        const entry = retained.find(contact => contact.id === event.target.value)
        update(entry ? { operation: 'restore', contactId: entry.id, expected: entry._staff_edit_snapshot } : null)
      }}>
        <option value="">Choose a removed contact</option>
        {retained.map(entry => <option key={entry.id} value={entry.id}>{[entry._staff_edit_snapshot.first_name,entry._staff_edit_snapshot.last_name].filter(Boolean).join(' ')}</option>)}
      </select>
    </FormField>}
    {restoreId ? <p role="status">Save to restore this person to the questionnaire using their existing contact record.</p> : <>
    {mode !== 'add' && <>
      {contact ? <FormField label="Contact to edit">
        <select className="w-full rounded border bg-background p-2" value={contactId} disabled={mode === 'remove' || Object.keys(patch).length > 0}
          onChange={event => { setContactId(event.target.value); setPatch({}); update(null) }}>
          {entries.map(entry => <option key={entry.id} value={entry.id}>{[entry._staff_edit_snapshot.first_name, entry._staff_edit_snapshot.last_name].filter(Boolean).join(' ') || 'Unnamed contact'}</option>)}
        </select>
      </FormField> : <p className="text-sm text-muted-foreground">No saved contacts in this questionnaire.</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="text-sm underline" disabled={mode === 'remove' || Object.keys(patch).length > 0}
          onClick={() => { setNewId(crypto.randomUUID()); setMode('add'); setPatch({}); update(null) }}>Add contact</button>
        {contact && mode !== 'remove' && <button type="button" className="text-sm text-destructive underline" disabled={Object.keys(patch).length > 0}
          onClick={() => { setMode('remove'); update({ operation: 'remove', contactId, expected: contact._staff_edit_snapshot }) }}>Remove from questionnaire</button>}
      </div>
    </>}
    {mode === 'remove' ? <div className="space-y-2">
      <p role="status" className="text-sm">Save this removal to take the person out of the questionnaire. Their contact record is retained. A person with an appointment cannot be removed here.</p>
      <button type="button" className="text-sm underline" onClick={() => { setMode('edit'); update(null) }}>Keep contact</button>
    </div> : (mode === 'add' || contact) && <>
      {mode === 'add' && <h3 className="font-medium">New contact</h3>}
      <div className="grid gap-3 sm:grid-cols-2">
        {[...STAFF_CONTACT_FIELDS, ...(mode === 'add' ? [['relationship_label', 'Relationship'] as const] : [])].map(([key, label]) => <FormField key={key} label={label}>
          <TextInput type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={patch[key] ?? (mode === 'add' ? '' : contact?._staff_edit_snapshot[key]) ?? ''}
            onChange={value => {
              const next = { ...patch, [key]: value }
              setPatch(next)
              update(mode === 'add' ? { operation: 'add', contactId: newId, patch: next }
                : { contactId, expected: contact!._staff_edit_snapshot, patch: next })
            }} />
        </FormField>)}
      </div>
    </>}
    </>}
  </fieldset>
}
