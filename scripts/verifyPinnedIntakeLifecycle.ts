/** Local-only lifecycle and HTTP acceptance after seedPinnedIntakeAcceptance. */
import { config } from 'dotenv'
import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
async function main() {
  config({ path: '.env.local', quiet: true })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const app = process.env.INTAKE_ACCEPTANCE_APP_URL ?? 'http://127.0.0.1:3007'
  for (const target of [url, app]) if (!['127.0.0.1', 'localhost'].includes(new URL(target).hostname)) throw new Error('Local acceptance endpoints required')
  const { getAdminClient } = await import('../lib/supabaseAdmin')
  const repo = await import('../lib/intake/forms/repository')
  const { hashIntakeFormDefinition } = await import('../lib/intake/forms/hash')
  const { resolveIntakeDelivery } = await import('../lib/intake/forms/runtime')
  const { createStandingIntakeToken, ensureStandingIntakeLink } = await import('../lib/intake/standingLinks')
  const admin = getAdminClient()
  const actor = await admin.from('users').select('id').eq('email', 'attorney@example.com').single()
  if (actor.error) throw actor.error
  const actorId = actor.data.id
  for (const track of ['estate', 'college_prep']) {
    const found = await admin.from('client_intake').select('*').eq('email', `${track}-acceptance@example.test`).single()
    if (found.error) throw found.error
    const row = found.data
    assert.equal(row.status, 'draft', 'Use freshly seeded drafts')
    const source = await repo.getVersionRow(row.form_version_id!)
    assert(source)
    const draft = await repo.createNextDraftRow({ actorId, sourceVersionId: source.id })
    const definition = structuredClone(draft.definition)
    definition.title = `${definition.title} - future version`
    definition.sections = definition.sections.map(section => ({ ...section, id: `next_${section.id}` }))
    const saved = await repo.saveDraftRow({ actorId, versionId: draft.id, expectedLockVersion: draft.lock_version, definition, definitionHash: hashIntakeFormDefinition(definition) })
    await assert.rejects(() => repo.publishDraftRow({ actorId, versionId: draft.id, expectedLockVersion: draft.lock_version, expectedDefinitionHash: saved.definition_hash }))
    const published = await repo.publishDraftRow({ actorId, versionId: saved.id, expectedLockVersion: saved.lock_version, expectedDefinitionHash: saved.definition_hash })
    if (source.status === 'published') await repo.retireVersionRow({ actorId, versionId: source.id })
    const old = await resolveIntakeDelivery(row, 'client', { INTAKE_RENDERER_MODE: 'legacy' })
    assert.equal(old.rendererMode, 'compiled')
    if (old.rendererMode === 'compiled') assert.equal(old.compiledForm.title, source.definition.title)
    const newRecord = await admin.from('client_intake').insert({ first_name: 'Lifecycle', last_name: track, email: `lifecycle-${randomUUID()}@example.test`, practice_area: track === 'estate' ? 'EP' : 'CP', intake_track: track, status: 'draft' }).select('*').single()
    if (newRecord.error) throw newRecord.error
    assert.equal(newRecord.data.form_version_id, published.id)
    assert((await admin.from('client_intake').update({ form_version_id: published.id }).eq('id', row.id)).error)
    assert((await admin.from('client_intake').update({ intake_track: track === 'estate' ? 'college_prep' : 'estate' }).eq('id', row.id)).error)
    await repo.archiveTemplateRow({ actorId, templateId: source.template_id, archived: true })
    assert.equal((await resolveIntakeDelivery(row, 'client', {})).rendererMode, 'compiled')
    assert((await admin.from('client_intake').insert({ intake_track: track, practice_area: track === 'estate' ? 'EP' : 'CP' })).error)
    await repo.archiveTemplateRow({ actorId, templateId: source.template_id, archived: false })
    const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    const login = await client.auth.signInWithPassword({ email: `${track}-acceptance@example.test`, password: 'Password123!' })
    if (login.error) throw login.error
    const headers = { Authorization: `Bearer ${login.data.session!.access_token}`, 'Content-Type': 'application/json' }
    const denied = await client.from('intake_form_versions').select('*')
    assert(denied.error || !denied.data?.length, 'Clients must not read raw stored definitions')
    const save = await fetch(`${app}/api/intake`, { method: 'POST', headers, body: JSON.stringify({ existingId: row.id, status: 'draft', preferred_name: 'HTTP verified', form_version_id: published.id, intake_track: track === 'estate' ? 'college_prep' : 'estate' }) })
    assert.equal(save.status, 200, await save.text())
    const after = await admin.from('client_intake').select('*').eq('id', row.id).single()
    assert.equal(after.data?.form_version_id, source.id)
    assert.equal(after.data?.intake_track, track)
    const exported = await fetch(`${app}/api/intake/${row.id}/export`, { headers })
    assert.equal(exported.status, 200)
    assert(exported.headers.get('content-type')?.includes('wordprocessingml'))
    await exported.arrayBuffer()
    const forbidden = await fetch(`${app}/api/admin/intake/${row.id}/export`, { headers })
    assert([401,403].includes(forbidden.status))
    const cross = await fetch(`${app}/api/intake/${newRecord.data.id}/export`, { headers })
    assert([403,404].includes(cross.status))
    const crossSave = await fetch(`${app}/api/intake`, { method: 'POST', headers, body: JSON.stringify({ existingId: newRecord.data.id, status: 'draft', preferred_name: 'forbidden' }) })
    assert.equal(crossSave.status, 403)
    // Unclaimed synthetic intake supports standing-link access without sending mail.
    const link = await ensureStandingIntakeLink(admin, newRecord.data.id)
    const invite = createStandingIntakeToken(newRecord.data.id, link.version)
    const inviteHeaders = { 'X-Intake-Token': invite, 'Content-Type': 'application/json' }
    const inviteSave = await fetch(`${app}/api/intake`, { method: 'POST', headers: inviteHeaders, body: JSON.stringify({ existingId: row.id, status: 'draft', preferred_name: 'Invite verified', form_version_id: source.id, intake_track: 'forged' }) })
    assert.equal(inviteSave.status, 200, await inviteSave.text())
    const badToken = await fetch(`${app}/api/intake`, { method: 'POST', headers: { 'X-Intake-Token': 'forged', 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(badToken.status, 401)
    const invitationRow = await admin.from('client_intake').select('form_version_id,preferred_name').eq('id', newRecord.data.id).single()
    assert.equal(invitationRow.data?.form_version_id, published.id)
    assert.equal(invitationRow.data?.preferred_name, 'Invite verified')
    const inviteExport = await fetch(`${app}/api/intake/${newRecord.data.id}/export`, { headers: inviteHeaders })
    assert.equal(inviteExport.status, 200)
    await inviteExport.arrayBuffer()
    const wrongInvite = await fetch(`${app}/api/intake/${row.id}/export`, { headers: inviteHeaders })
    assert([401,403,404].includes(wrongInvite.status))
    console.log(`${track}: publish/retire/archive, old-pin delivery, new assignment, HTTP tampering/ownership guards, session and invite exports passed`)
  }
  const legacy = await admin.from('client_intake').select('*').is('form_version_id', null).limit(1).single()
  if (legacy.error) throw legacy.error
  assert.equal((await resolveIntakeDelivery(legacy.data, 'client', { INTAKE_RENDERER_MODE: 'legacy' })).rendererMode, 'legacy')
  console.log('Legacy null-pin rollback delivery preserved')
}
main().catch(error => { console.error(error?.message ?? 'Local lifecycle acceptance failed'); process.exitCode = 1 })
