import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err } = await requireAdmin(req); if (err) return err
  const { id } = await params
  const { data, error } = await getAdminClient().from('lead_activity').select('*').eq('lead_id', id).order('created_at', { ascending: false })
  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ activity: data ?? [] })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err, userId } = await requireAdmin(req); if (err) return err
  const { id } = await params
  const body = await req.json().catch(() => ({})); const detail = typeof body.detail === 'string' ? body.detail.trim() : ''
  if (!detail) return Response.json({ error: 'Note is required' }, { status: 400 })
  const { data, error } = await getAdminClient().from('lead_activity').insert({ lead_id: id, event_type: 'note', title: 'Note added', detail, actor_id: userId }).select().single()
  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ activity: data })
}
