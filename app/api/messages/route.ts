import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getBearerToken, requireAdmin } from '@/lib/apiAuth'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'

function anonClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data: profile } = await getAdminClient()
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  return Boolean(profile && ['attorney', 'admin'].includes(profile.role as string))
}

async function clientOwnsMatter(token: string, userId: string, matterId: string): Promise<boolean> {
  const sb = anonClient(token)
  const matter = await getMatterForUser(sb, userId)
  return matter?.id === matterId
}

// GET /api/messages?matter_id=<uuid>
// Staff or client of the matter.
export async function GET(req: Request) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = anonClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const matterId = url.searchParams.get('matter_id')
  if (!matterId) return NextResponse.json({ error: 'matter_id required' }, { status: 400 })

  const isAdmin = await checkIsAdmin(user.id)
  if (!isAdmin) {
    const owns = await clientOwnsMatter(token, user.id, matterId)
    if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await getAdminClient()
    .from('messages')
    .select('*')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/messages
// Admin: { matter_id, body } → sender_role = 'attorney'
// Client: { matter_id, body } → sender_role = 'client'
export async function POST(req: Request) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = anonClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = await checkIsAdmin(user.id)
  const body = await req.json()
  const { matter_id, body: msgBody } = body as { matter_id: string; body: string }

  if (!matter_id || !msgBody?.trim()) {
    return NextResponse.json({ error: 'matter_id and body are required' }, { status: 400 })
  }

  if (isAdmin) {
    const { data, error } = await getAdminClient()
      .from('messages')
      .insert({
        matter_id,
        sender_role: 'attorney',
        sender_id: user.id,
        body: msgBody.trim(),
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const owns = await clientOwnsMatter(token, user.id, matter_id)
  if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await sb
    .from('messages')
    .insert({
      matter_id,
      sender_role: 'client',
      sender_id: user.id,
      body: msgBody.trim(),
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/messages — mark attorney messages as read for a matter (admin)
export async function PATCH(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = await req.json()
  const { matter_id } = body as { matter_id: string }
  if (!matter_id) return NextResponse.json({ error: 'matter_id required' }, { status: 400 })

  await getAdminClient().rpc('mark_messages_read', {
    p_matter_id: matter_id,
    p_reader_role: 'attorney',
  })

  return NextResponse.json({ ok: true })
}
