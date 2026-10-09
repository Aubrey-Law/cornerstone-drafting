import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { DOCUMENT_FOLDER_COLUMNS } from '@/lib/queryColumns'
import { isAdminUser } from '@/lib/documentSecurity'
import { folderSubtreeIds, normalizeFolderName } from '@/lib/documentFolders'
import type { MatterDocumentFolder } from '@/types/database'

// PATCH /api/documents/folders/[folderId]  body: { name }
export async function PATCH(req: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folderId } = await params
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  const name = normalizeFolderName(typeof body?.name === 'string' ? body.name : '')
  if (!name) return NextResponse.json({ error: 'Folder name is required' }, { status: 400 })

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await sb
    .from('matter_document_folders')
    .update({ name })
    .eq('id', folderId)
    .select(DOCUMENT_FOLDER_COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `A folder named “${name}” already exists here` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ folder: data })
}

// DELETE /api/documents/folders/[folderId]
//
// The folder goes, and its subfolders with it (`parent_id` is ON DELETE
// CASCADE); its documents do not. `folder_id` is ON DELETE SET NULL, so
// everything filed anywhere in the branch falls back to the root of the
// matter's workspace.
export async function DELETE(req: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folderId } = await params
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing } = await sb
    .from('matter_document_folders')
    .select('id, matter_id')
    .eq('id', folderId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: siblings } = await sb
    .from('matter_document_folders')
    .select('id, parent_id')
    .eq('matter_id', (existing as { matter_id: string }).matter_id)
  const branch = [...folderSubtreeIds(folderId, Array.isArray(siblings) ? siblings as MatterDocumentFolder[] : [])]

  const { count } = await sb
    .from('matter_documents')
    .select('id', { count: 'exact', head: true })
    .in('folder_id', branch)

  const { error } = await sb.from('matter_document_folders').delete().eq('id', folderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, released: count ?? 0 })
}
