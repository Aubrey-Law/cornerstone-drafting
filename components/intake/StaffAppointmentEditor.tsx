'use client'

import { useState } from 'react'
import { APPOINTMENT_LABELS, STAFF_APPOINTMENT_BLOCKS, type StaffAppointmentData } from '@/lib/intake/forms/staffAppointments'
import { FormField } from './IntakeFormPrimitives'

export default function StaffAppointmentEditor({ block, saved, reviewChoice = '', excludedNames = '', disabled, update }: {
  block: keyof typeof STAFF_APPOINTMENT_BLOCKS; saved: StaffAppointmentData; reviewChoice?: string; excludedNames?: string; disabled: boolean; update: (value: unknown) => void
}) {
  const pairs = STAFF_APPOINTMENT_BLOCKS[block]
  const [role, setRole] = useState<string>(pairs[0][0])
  const party = pairs[0][1]
  const [priority, setPriority] = useState(1)
  const [coagent, setCoagent] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [choice, setChoice] = useState(reviewChoice)
  const [mode, setMode] = useState('slot')
  const [excluded, setExcluded] = useState(excludedNames)
  const expected = saved.roles.filter(row => row.role === role && row.for_party === party && row.priority === priority && row.is_coagent === coagent)
  function reset() { setChosen(null); update(null) }
  return <fieldset disabled={disabled} className="space-y-3 border-0 p-0">
    <p className="text-sm text-muted-foreground">Change one appointment at a time. Add a new person in the contacts section first. Clearing a slot retains the contact and their other appointments.</p>
    <FormField label="Change to make"><select className="w-full rounded border bg-background p-2" value={mode} onChange={e => { setMode(e.target.value); reset(); setChoice(reviewChoice); setExcluded(excludedNames) }}>
      <option value="slot">Appoint or remove a person</option><option value="choice">Record why appointments are incomplete</option>
      {block === 'guardian' && <option value="excluded">People excluded from guardianship</option>}
    </select></FormField>
    {mode === 'excluded' ? <FormField label="Excluded guardians — one name per line"><textarea className="w-full rounded border bg-background p-2" value={excluded} onChange={e => { setExcluded(e.target.value); update({ excludedNames: e.target.value.split('\n').map(name => name.trim()).filter(Boolean) }) }} /></FormField> : mode === 'choice' ? <FormField label="If appointments are incomplete"><select className="w-full rounded border bg-background p-2" value={choice} onChange={e => { setChoice(e.target.value); update({ reviewChoice: e.target.value }) }}>
      <option value="">No review choice</option><option value="discuss_with_attorney">Discuss with attorney</option><option value="not_provided_yet">Not provided yet</option>
    </select></FormField> : <>
    <FormField label="Appointment role"><select className="w-full rounded border bg-background p-2" value={role} onChange={e => { setRole(e.target.value); reset() }}>
      {pairs.map(([key]) => <option key={key} value={key}>{APPOINTMENT_LABELS[key]}</option>)}
    </select></FormField>
    <FormField label="Appointment order"><select className="w-full rounded border bg-background p-2" value={priority} onChange={e => { setPriority(Number(e.target.value)); reset() }}>
      {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i === 0 ? 'Primary' : `Alternate ${i}`}</option>)}
    </select></FormField>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={coagent} onChange={e => { setCoagent(e.target.checked); reset() }} />Co-agent for this appointment</label>
    {expected.length > 1 ? <p role="alert">Multiple people occupy this slot. Resolve the duplicate appointments before editing here.</p> : <FormField label="Appointed contact">
      <select className="w-full rounded border bg-background p-2" value={chosen ?? expected[0]?.contact_id ?? ''} onChange={e => {
        setChosen(e.target.value)
        update({ matterId: saved.matterId, role, party, priority, coagent, contactId: e.target.value || null, expected })
      }}>
        <option value="">No appointment — clear this slot</option>
        {expected[0] && !saved.contacts.some(c => c.id === expected[0].contact_id) && <option value={expected[0].contact_id} disabled>Current contact needs review</option>}
        {saved.contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
      </select>
    </FormField>}
    </>}
  </fieldset>
}
