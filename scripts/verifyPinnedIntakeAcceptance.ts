/** Exercises real service/data boundaries in the synthetic local fixtures only. */
import { config } from 'dotenv'
import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
async function main() {
  config({ path: '.env.local', quiet: true })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url || !['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Local acceptance database required')
  const { getAdminClient } = await import('../lib/supabaseAdmin')
  const { saveStaffQuestionRow } = await import('../lib/intake/forms/staffQuestionEditing')
  const { loadAdminIntakeRow } = await import('../lib/intake/loadAdminIntakeRow')
  const { staffContactSnapshot } = await import('../lib/intake/forms/staffContactEditing')
  const { staffHouseholdSnapshot } = await import('../lib/intake/forms/staffHousehold')
  const { resolvePinnedIntakeExport } = await import('../lib/intake/forms/exportRuntime')
  const admin = getAdminClient()
  for (const track of ['estate','college_prep']) {
    const lookup = await admin.from('client_intake').select('id').eq('email', `${track}-acceptance@example.test`).single()
    if (lookup.error) throw lookup.error
    const id = lookup.data.id
    async function saved() {
      const row = await loadAdminIntakeRow(id)
      assert(row?.form_version_id, 'Fixture must be pinned')
      return row
    }
    async function save(fieldId: string, value: unknown) {
      const row = await saved()
      await saveStaffQuestionRow(admin, { intakeId: id, expectedVersionId: String(row.form_version_id), expectedUpdatedAt: row.updated_at as string | null, fieldId, value })
    }
    const noteField = track === 'estate' ? 'special_notes' : 'college_concerns'
    const before = await saved()
    await save(noteField, `Verified ${track} pinned answers`)
    await assert.rejects(() => saveStaffQuestionRow(admin, { intakeId: id, expectedVersionId: String(before.form_version_id), expectedUpdatedAt: before.updated_at as string | null, fieldId: noteField, value: 'stale overwrite' }))
    const personId = randomUUID()
    const block = track === 'estate' ? 'additional_contacts' : 'college_parents'
    await save(block, { operation: 'add', contactId: personId, patch: { first_name: 'Acceptance', last_name: personId.slice(0,8) } })
    let person = (await admin.from('contacts').select('*').eq('id', personId).single()).data!
    await save(block, { contactId: personId, expected: staffContactSnapshot(person), patch: { email: 'contact@example.test' } })
    person = (await admin.from('contacts').select('*').eq('id', personId).single()).data!
    await save(block, { operation: 'remove', contactId: personId, expected: staffContactSnapshot(person) })
    await save(block, { operation: 'restore', contactId: personId, expected: staffContactSnapshot(person) })
    const hydrated = await saved()
    const appointments = hydrated._staff_appointments as { matterId: string | null }
    const roleBlock = track === 'estate' ? 'client_fiduciaries' : 'college_agents'
    const slot = { matterId: appointments.matterId, role: 'hcp', party: 'client', priority: 7, coagent: false, contactId: personId, expected: [] }
    await save(roleBlock, slot)
    const assigned = await saved()
    assert((assigned._fid_hcp_client as { contact_id: string; priority: number }[]).some(row => row.contact_id === personId && row.priority === 7))
    await assert.rejects(() => save(block, { operation: 'remove', contactId: personId, expected: staffContactSnapshot(person) }))
    const actual = (assigned._staff_appointments as { roles: { role: string; priority: number }[] }).roles.filter(row => row.role === 'hcp' && row.priority === 7)
    await save(roleBlock, { ...slot, contactId: null, expected: actual })
    await save(block, { operation: 'remove', contactId: personId, expected: staffContactSnapshot(person) })
    if (track === 'estate') {
      await save('planning_goals', ['avoid_probate'])
      assert.deepEqual((await saved()).planning_goals, ['avoid_probate'])
      await save('address', { street_address: '2 Verified Street', city: 'Boston' })
      await save('has_children', true)
      const childId = randomUUID()
      await save('children', { operation: 'add', contactId: childId, expected: null, patch: { first_name: 'Test', last_name: childId.slice(0,8), date_of_birth: '2015-01-01', parentage: 'joint', child_relationship: 'biological' } })
      const child = (await admin.from('contacts').select('*').eq('id', childId).single()).data!
      await save('children', { operation: 'remove', contactId: childId, expected: staffHouseholdSnapshot(child), patch: {} })
      await save('has_children', false)
    } else await save('college_school_name', 'Acceptance University')
    const exported = await resolvePinnedIntakeExport(await saved(), 'staff')
    assert(JSON.stringify(exported.sections).includes(`Verified ${track} pinned answers`))
    console.log(`${track}: exact pin, scalar/contact/appointment edits, removal/restoration, stale and role guards, and export projection passed`)
  }
}
main().catch(error => { console.error(error?.message ?? 'Local acceptance verification failed'); process.exitCode = 1 })
