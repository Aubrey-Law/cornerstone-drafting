import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { isAdminUser, userCanAccessMatter } from '@/lib/documentSecurity'

// GET /api/documents?matterId=...&source=...
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

  const source = searchParams.get('source')
  let query = sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
  if (source) query = query.eq('source', source)
  if (!(await isAdminUser(sb, user))) {
    query = query.or(`shared_at.not.is.null,uploaded_by.eq.${user.id}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: data ?? [] })
}

// POST /api/documents
// body: { matterId, r2Key, name, size, contentType }
export async function POST(req: Request) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { matterId, r2Key, name, size, contentType } = await req.json()
  if (!matterId || !r2Key || !name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const sb = getAdminClient()
  if (!(await userCanAccessMatter(sb, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userIsAdmin = await isAdminUser(sb, user)
  const source = userIsAdmin ? 'firm' : 'client'
  if (!r2Key.startsWith(`matters/${matterId}/${source}/`)) {
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
      folder: userIsAdmin ? 'draft' : 'client',
      source,
      shared_at: null,
      uploaded_by: user.id,
    })
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ document: data })
}
