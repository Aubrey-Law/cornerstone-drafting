import { expect, it } from 'vitest'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { getCompiledIntakeReadinessFlags } from '@/lib/intake/forms/readiness'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'
const compiled = compileIntakeForm({ schemaVersion: 1, key: 'custom', title: 'Custom', sections: [
  { id: 'identity_changed', title: 'About you', audience: 'client_and_staff', items: [{ kind: 'field', id: 'name', fieldId: 'client_first_name' }, { kind: 'field', id: 'dob', fieldId: 'client_dob' }] },
  { id: 'choices_changed', title: 'Your agents', audience: 'client_and_staff', items: [{ kind: 'block', id: 'agents', blockId: 'college_agents' }] },
  { id: 'finish_changed', title: 'Finish', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review', blockId: 'review_submit' }] },
]}, 'staff')
if (!compiled.success) throw new Error('invalid test form')
const form = compiled.form
it('scores and routes exact custom sections instead of bundled track sections', () => {
  const segments = getLeadIntakeProgress({ form_version_id: 'version', _pinned_form: form, intake_track: 'college_prep', first_name: 'Student', date_of_birth: '2000-01-01', status: 'draft' })
  expect(segments.map(s => s.id)).toEqual(['identity_changed', 'choices_changed', 'finish_changed'])
  expect(segments[0]).toEqual({ id: 'identity_changed', label: 'About you', complete: true })
  expect(segments[2].complete).toBe(false)
})
it('never substitutes bundled progress when the exact pin is unavailable', () => {
  expect(getLeadIntakeProgress({ form_version_id: 'missing' })).toEqual([])
})
it('retains attorney flag identities and maps them to active saved questions only', () => {
  const flags = getCompiledIntakeReadinessFlags(form, { intake_track: 'college_prep' })
  expect(flags.map(f => [f.key, f.sectionId])).toEqual([
    ['client_dob_missing', 'identity_changed'], ['client_poa_missing', 'choices_changed'], ['client_hcp_missing', 'choices_changed'],
  ])
})
