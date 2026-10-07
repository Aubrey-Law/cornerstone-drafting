import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export async function GET(request: Request) {
  const { err } = await requireAdmin(request)
  if (err) return err
  const params = new URL(request.url).searchParams
  const kind = params.get('kind')
  const q = (params.get('q') ?? '').trim().slice(0, 100).replace(/[%_\\]/g, '')
  const client = getAdminClient()
  if (kind === 'person') {
    let query = client.from('v_cornerstone_crm_people').select('id,name').order('name').limit(30)
    if (q) query = query.ilike('name', `%${q}%`)
    const { data, error } = await query
    return error ? Response.json({ error: 'Could not search people' }, { status: 500 }) : Response.json({ options: (data ?? []).map(row => ({ id: row.id, name: row.name ?? 'Unnamed person' })) })
  }
  if (kind === 'actor') {
    let query = client.from('users').select('id,display_name,email').in('role', ['attorney', 'admin']).order('display_name').limit(30)
    if (q) query = query.ilike('display_name', `%${q}%`)
    const { data, error } = await query
    return error ? Response.json({ error: 'Could not search staff' }, { status: 500 }) : Response.json({ options: (data ?? []).map(row => ({ id: row.id, name: row.display_name || row.email || 'Staff member' })) })
  }
  return Response.json({ error: 'Invalid lookup' }, { status: 400 })
}
