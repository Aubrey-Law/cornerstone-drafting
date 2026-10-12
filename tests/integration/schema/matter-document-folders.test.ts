import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Document folders, as the database maintains them.
 *
 * 20270204090000 seeds Intake, Design, Drafts and Signed Documents on EP and
 * EP-LP matters and lets folders nest; 20270205090000 files generated drafts
 * into the "Drafts" folder at insert. Both are triggers, so they are claims
 * about the migrated schema rather than about any route.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

const intakeIds: string[] = []
const matterIds: string[] = []

async function createMatter(practiceArea: string | null): Promise<string> {
  const intake = await admin
    .from('client_intake')
    .insert({ email: `folders-${randomUUID()}@example.invalid` })
    .select('id')
    .single()
  if (intake.error || !intake.data) throw new Error(`intake insert failed: ${intake.error?.message}`)
  intakeIds.push(intake.data.id as string)

  const matter = await admin
    .from('matters')
    .insert({ client_intake_id: intake.data.id })
    .select('id')
    .single()
  if (matter.error || !matter.data) throw new Error(`matter insert failed: ${matter.error?.message}`)
  const matterId = matter.data.id as string
  matterIds.push(matterId)

  const details = await admin
    .from('matter_details')
    .upsert({ client_id: matterId, practice_area: practiceArea }, { onConflict: 'client_id' })
  if (details.error) throw new Error(`details upsert failed: ${details.error.message}`)
  return matterId
}

async function rootFolders(matterId: string) {
  const { data, error } = await admin
    .from('matter_document_folders')
    .select('id, name, parent_id')
    .eq('matter_id', matterId)
    .is('parent_id', null)
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

async function insertDocument(matterId: string, name: string, generated: boolean) {
  const { data, error } = await admin
    .from('matter_documents')
    .insert({
      matter_id: matterId,
      r2_key: `test/${randomUUID()}`,
      name,
      size: 1,
      content_type: 'application/octet-stream',
      source: 'firm',
      generation_id: generated ? randomUUID() : null,
    })
    .select('folder_id')
    .single()
  if (error || !data) throw new Error(`document insert failed: ${error?.message}`)
  return data.folder_id as string | null
}

beforeAll(() => {
  if (!url || !serviceRoleKey) throw new Error('Schema tests need the local Supabase env')
})

afterAll(async () => {
  if (matterIds.length) {
    await admin.from('matter_documents').delete().in('matter_id', matterIds)
    await admin.from('matters').delete().in('id', matterIds)
  }
  if (intakeIds.length) await admin.from('client_intake').delete().in('id', intakeIds)
})

describe('estate-planning starter folders', () => {
  it('gives an EP matter Intake, Design, Drafts and Signed Documents', async () => {
    const matterId = await createMatter('EP')
    expect((await rootFolders(matterId)).map(folder => folder.name))
      .toEqual(['Design', 'Drafts', 'Intake', 'Signed Documents'])
  })

  it('leaves other practice areas alone until they move into estate planning', async () => {
    const matterId = await createMatter('Probate')
    expect(await rootFolders(matterId)).toEqual([])

    await admin.from('matter_details').update({ practice_area: 'EP-LP' }).eq('client_id', matterId)
    expect(await rootFolders(matterId)).toHaveLength(4)

    // EP-LP → EP is the same plan; it does not seed a second set.
    await admin.from('matter_details').update({ practice_area: 'EP' }).eq('client_id', matterId)
    expect(await rootFolders(matterId)).toHaveLength(4)
  })

  it('nests folders, allows a name under two parents, and deletes the branch', async () => {
    const matterId = await createMatter('EP')
    const roots = await rootFolders(matterId)
    const drafts = roots.find(folder => folder.name === 'Drafts')!
    const design = roots.find(folder => folder.name === 'Design')!

    const insert = (parentId: string) => admin
      .from('matter_document_folders')
      .insert({ matter_id: matterId, parent_id: parentId, name: 'Trust' })
      .select('id')
      .single()
    const nested = await insert(drafts.id)
    expect(nested.error).toBeNull()
    expect((await insert(design.id)).error).toBeNull()
    expect((await insert(drafts.id)).error?.code).toBe('23505')

    await admin.from('matter_document_folders').delete().eq('id', drafts.id)
    const { data } = await admin.from('matter_document_folders').select('id').eq('id', nested.data!.id)
    expect(data).toEqual([])
  })
})

describe('filing generated drafts', () => {
  it('files a generated draft into the matter’s Drafts folder', async () => {
    const matterId = await createMatter('EP')
    const drafts = (await rootFolders(matterId)).find(folder => folder.name === 'Drafts')!

    expect(await insertDocument(matterId, 'Revocable Trust.docx', true)).toBe(drafts.id)
    // Signed copies keep their derived folder; ordinary files stay loose.
    expect(await insertDocument(matterId, 'Signed Will.pdf', true)).toBeNull()
    expect(await insertDocument(matterId, 'Notes.docx', false)).toBeNull()
  })

  it('leaves a generated draft loose when the matter has no Drafts folder', async () => {
    const matterId = await createMatter('Probate')
    expect(await insertDocument(matterId, 'Petition.docx', true)).toBeNull()
  })
})
