import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import {
  filterClientVisibleDocuments,
  isAdminUser,
  isClientUploadFolder,
  userCanAccessMatter,
} from '@/lib/documentSecurity'

// GET /api/documents?matterId=...&folder=...
export async function GET(req: Request) {
  const user = await getBearerUser(req)
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
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { matterId, r2Key, name, size, contentType, folder = 'client', folderId = null } = await req.json()
  if (!matterId || !r2Key || !name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const sb = getAdminClient()
  if (!(await userCanAccessMatter(sb, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userIsAdmin = await isAdminUser(sb, user)
  if (!userIsAdmin && !isClientUploadFolder(folder)) {
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
      source: userIsAdmin ? 'firm' : 'client',
      shared_at: ['review', 'signed', 'final'].includes(folder) ? new Date().toISOString() : null,
      uploaded_by: user.id,
    })
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ document: data })
}
