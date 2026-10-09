import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { DOCUMENT_FOLDER_COLUMNS } from '@/lib/queryColumns'
import { isAdminUser, userCanAccessMatter } from '@/lib/documentSecurity'
import { normalizeFolderName } from '@/lib/documentFolders'

// GET /api/documents/folders?matterId=...  →  { folders: MatterDocumentFolder[] }
export async function GET(req: Request) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const matterId = searchParams.get('matterId')
  if (!matterId) return NextResponse.json({ error: 'Missing matterId' }, { status: 400 })

  const sb = getAdminClient()
  if (!(await userCanAccessMatter(sb, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Folder names are the firm's working notes, so the portal never sees them.
  // A client with matter access still gets an empty list rather than a 403 —
  // the documents themselves are what the portal reads.
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ folders: [] })

  const { data, error } = await sb
    .from('matter_document_folders')
    .select(DOCUMENT_FOLDER_COLUMNS)
    .eq('matter_id', matterId)
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ folders: data ?? [] })
}

// POST /api/documents/folders  body: { matterId, name, parentId? }
export async function POST(req: Request) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    | { matterId?: unknown; name?: unknown; parentId?: unknown }
    | null
  const matterId = typeof body?.matterId === 'string' ? body.matterId : ''
  const parentId = typeof body?.parentId === 'string' && body.parentId ? body.parentId : null
  const name = normalizeFolderName(typeof body?.name === 'string' ? body.name : '')
  if (!matterId) return NextResponse.json({ error: 'Missing matterId' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'Folder name is required' }, { status: 400 })

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: matter } = await sb.from('matters').select('id').eq('id', matterId).maybeSingle()
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

  // A subfolder has to sit inside a folder of the same matter; the table's
  // foreign key alone would accept a parent from anywhere.
  if (parentId) {
    const { data: parent } = await sb
      .from('matter_document_folders')
      .select('id, matter_id')
      .eq('id', parentId)
      .maybeSingle()
    if (!parent || (parent as { matter_id: string }).matter_id !== matterId) {
      return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 })
    }
  }

  const { data, error } = await sb
    .from('matter_document_folders')
    .insert({ matter_id: matterId, parent_id: parentId, name, created_by: user.id })
    .select(DOCUMENT_FOLDER_COLUMNS)
    .single()

  if (error) {
    // 23505 is the case-insensitive name index among siblings. Say so plainly
    // rather than surfacing the constraint name.
    if (error.code === '23505') {
      return NextResponse.json({ error: `A folder named “${name}” already exists here` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ folder: data })
}
