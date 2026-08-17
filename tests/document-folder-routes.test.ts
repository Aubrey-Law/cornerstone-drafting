import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBearerUser: vi.fn(),
  isAdminUser: vi.fn(),
  userCanAccessMatter: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ getBearerUser: mocks.getBearerUser }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/documentSecurity', () => ({
  isAdminUser: mocks.isAdminUser,
  userCanAccessMatter: mocks.userCanAccessMatter,
  userCanReadDocument: vi.fn().mockResolvedValue(true),
  auditDocumentAccess: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/r2', () => ({ getR2Client: () => ({ send: vi.fn() }), R2_BUCKET: 'bucket' }))
vi.mock('@/lib/portalNotifications', () => ({ notifyClientOfSharedDocument: vi.fn() }))

import { GET as listFolders, POST as createFolder } from '@/app/api/documents/folders/route'
import {
  DELETE as deleteFolder,
  PATCH as renameFolder,
} from '@/app/api/documents/folders/[folderId]/route'
import { PATCH as patchDocument } from '@/app/api/documents/[id]/route'

const MATTER_ID = '11111111-1111-4111-8111-111111111111'
const FOLDER_ID = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '33333333-3333-4333-8333-333333333333'

/** One PostgREST chain: filters return `this`, terminals return seeded data. */
function chain(result: { data: unknown; error: unknown; count?: number }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'in']) builder[method] = () => builder
  builder.insert = (...args: unknown[]) => { mocks.insert(...args); return builder }
  builder.update = (...args: unknown[]) => { mocks.update(...args); return builder }
  builder.delete = (...args: unknown[]) => { mocks.del(...args); return builder }
  builder.maybeSingle = async () => result
  builder.single = async () => result
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return builder
}

function seed(tables: Record<string, { data: unknown; error?: unknown; count?: number }>) {
  mocks.from.mockImplementation((table: string) =>
    chain({ error: null, ...(tables[table] ?? { data: null }) }),
  )
}

function post(body: unknown) {
  return new Request('http://app.test/api/documents/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('document folder routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBearerUser.mockResolvedValue({ id: 'user-1', email: 'attorney@example.com' })
    mocks.isAdminUser.mockResolvedValue(true)
    mocks.userCanAccessMatter.mockResolvedValue(true)
    seed({})
  })

  it('refuses anonymous callers before touching the database', async () => {
    mocks.getBearerUser.mockResolvedValue(null)
    const response = await listFolders(
      new Request(`http://app.test/api/documents/folders?matterId=${MATTER_ID}`),
    )
    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('gives a client an empty folder list rather than the firm’s working names', async () => {
    mocks.isAdminUser.mockResolvedValue(false)
    seed({ matter_document_folders: { data: [{ id: FOLDER_ID, name: 'Deed work' }] } })

    const response = await listFolders(
      new Request(`http://app.test/api/documents/folders?matterId=${MATTER_ID}`),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ folders: [] })
  })

  it('creates a folder with a normalized name, stamped with its creator', async () => {
    seed({
      matters: { data: { id: MATTER_ID } },
      matter_document_folders: { data: { id: FOLDER_ID, name: 'Deed work' } },
    })

    const response = await createFolder(post({ matterId: MATTER_ID, name: '  Deed   work  ' }))

    expect(response.status).toBe(200)
    expect(mocks.insert).toHaveBeenCalledWith({
      matter_id: MATTER_ID,
      name: 'Deed work',
      created_by: 'user-1',
    })
  })

  it('rejects a blank name and a non-attorney', async () => {
    const blank = await createFolder(post({ matterId: MATTER_ID, name: '   ' }))
    expect(blank.status).toBe(400)

    mocks.isAdminUser.mockResolvedValue(false)
    const forbidden = await createFolder(post({ matterId: MATTER_ID, name: 'Deeds' }))
    expect(forbidden.status).toBe(403)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('says a duplicate name is taken instead of leaking the index', async () => {
    seed({
      matters: { data: { id: MATTER_ID } },
      matter_document_folders: { data: null, error: { code: '23505', message: 'duplicate key ... unique_name' } },
    })

    const response = await createFolder(post({ matterId: MATTER_ID, name: 'Deed work' }))

    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('already exists')
  })

  it('renames a folder', async () => {
    seed({ matter_document_folders: { data: { id: FOLDER_ID, name: 'Deeds' } } })

    const response = await renameFolder(
      new Request('http://app.test', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: ' Deeds ' }),
      }),
      { params: Promise.resolve({ folderId: FOLDER_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ name: 'Deeds' })
  })

  it('deletes the folder and reports how many documents it released', async () => {
    // The documents are not deleted with it — folder_id is ON DELETE SET NULL.
    seed({
      matter_document_folders: { data: { id: FOLDER_ID } },
      matter_documents: { data: null, count: 3 },
    })

    const response = await deleteFolder(new Request('http://app.test', { method: 'DELETE' }), {
      params: Promise.resolve({ folderId: FOLDER_ID }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, released: 3 })
    expect(mocks.del).toHaveBeenCalled()
  })
})

describe('moving a document between folders', () => {
  function patch(body: unknown) {
    return patchDocument(
      new Request('http://app.test', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: DOC_ID }) },
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBearerUser.mockResolvedValue({ id: 'user-1', email: 'attorney@example.com' })
    mocks.isAdminUser.mockResolvedValue(true)
  })

  it('files a document into a folder on the same matter', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'matter_document_folders') {
        return chain({ data: { id: FOLDER_ID, matter_id: MATTER_ID, name: 'Deed work' }, error: null })
      }
      return chain({ data: { id: DOC_ID, matter_id: MATTER_ID, name: 'Deed.pdf', shared_at: null }, error: null })
    })

    const response = await patch({ folderId: FOLDER_ID })

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ folder_id: FOLDER_ID })
  })

  it('moves a document back to the root when folderId is null', async () => {
    seed({ matter_documents: { data: { id: DOC_ID, matter_id: MATTER_ID, name: 'Deed.pdf', shared_at: null } } })

    const response = await patch({ folderId: null })

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ folder_id: null })
  })

  it('refuses a folder belonging to another matter', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'matter_document_folders') {
        return chain({ data: { id: FOLDER_ID, matter_id: 'other-matter', name: 'Deed work' }, error: null })
      }
      return chain({ data: { id: DOC_ID, matter_id: MATTER_ID, name: 'Deed.pdf', shared_at: null }, error: null })
    })

    const response = await patch({ folderId: FOLDER_ID })

    expect(response.status).toBe(404)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('still rejects a PATCH that asks for nothing at all', async () => {
    seed({ matter_documents: { data: { id: DOC_ID, matter_id: MATTER_ID, name: 'Deed.pdf', shared_at: null } } })
    const response = await patch({})
    expect(response.status).toBe(400)
  })
})
