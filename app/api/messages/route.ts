import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'
import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getBearerToken, requireAdmin } from '@/lib/apiAuth'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { notifyClientOfFirmMessage } from '@/lib/portalNotifications'

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

  if (url.searchParams.get('summary') === '1') {
    const admin = getAdminClient()
    const [latest, unread] = await Promise.all([
      admin.from('messages').select('id, body, sender_role, created_at, read_at').eq('matter_id', matterId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
      admin.from('messages').select('id', { count: 'exact', head: true }).eq('matter_id', matterId)
        .eq('sender_role', isAdmin ? 'client' : 'attorney').is('read_at', null),
    ])
    if (latest.error || unread.error) return NextResponse.json({ error: 'Message summary unavailable' }, { status: 503 })
    return NextResponse.json({ latest: latest.data, unread: unread.count ?? 0 })
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
    after(() => notifyClientOfFirmMessage(matter_id))
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

// PATCH /api/messages — mark only the client messages displayed to the attorney.
export async function PATCH(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const body = await req.json().catch(() => null)
  const { matter_id, message_ids } = (body ?? {}) as { matter_id?: string; message_ids?: unknown }
  if (!matter_id || !Array.isArray(message_ids) || !message_ids.length || message_ids.length > 1000
    || !message_ids.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) {
    return NextResponse.json({ error: 'matter_id and displayed message_ids required' }, { status: 400 })
  }
  const { error } = await getAdminClient().from('messages').update({ read_at: new Date().toISOString() })
    .eq('matter_id', matter_id).eq('sender_role', 'client').is('read_at', null).in('id', message_ids)
  if (error) return NextResponse.json({ error: 'Could not mark messages read' }, { status: 503 })
  revalidateSidebarCounts()
  return NextResponse.json({ ok: true })
}
