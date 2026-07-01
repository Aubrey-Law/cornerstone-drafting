import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { mirrorMatterDocumentToOneDrive } from '@/lib/oneDriveSync'
import {
  filterClientVisibleDocuments,
  isAdminUser,
  isClientUploadFolder,
  userCanAccessMatter,
} from '@/lib/documentSecurity'

async function getUser(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await sb.auth.getUser(token)
  return user ?? null
}

// GET /api/documents?matterId=...&folder=...
export async function GET(req: Request) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const matterId = searchParams.get('matterId')
  const folder = searchParams.get('folder')
  if (!matterId) return NextResponse.json({ error: 'Missing matterId' }, { status: 400 })

  const sb = getAdminClient()
  if (!(await userCanAccessMatter(sb, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let query = sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
  if (folder) query = query.eq('folder', folder)
  const userIsAdmin = await isAdminUser(sb, user)
  if (!userIsAdmin) query = query.not('folder', 'in', '("draft","drafts")')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const documents = userIsAdmin
    ? data ?? []
    : await filterClientVisibleDocuments(sb, data ?? [])
  return NextResponse.json({ documents })
}

// POST /api/documents
// body: { matterId, r2Key, name, size, contentType, folder }
export async function POST(req: Request) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { matterId, r2Key, name, size, contentType, folder = 'client', folderId = null } = await req.json()
  if (!matterId || !r2Key || !name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const sb = getAdminClient()
  if (!(await userCanAccessMatter(sb, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!(await isAdminUser(sb, user)) && !isClientUploadFolder(folder)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!r2Key.startsWith(`matters/${matterId}/${folder}/`)) {
    return NextResponse.json({ error: 'Invalid document key' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('matter_documents')
    .insert({
      matter_id: matterId,
      r2_key: r2Key,
      name,
      size: size ?? 0,
      content_type: contentType ?? 'application/octet-stream',
      folder,
      folder_id: folderId,
      uploaded_by: user.id,
    })
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  mirrorMatterDocumentToOneDrive({
    matterDocumentId: data.id,
    matterId,
    r2Key,
    fileName: name,
    folder,
  }).catch((err) => console.error('[onedrive] mirrorMatterDocumentToOneDrive', err))

  return NextResponse.json({ document: data })
}
