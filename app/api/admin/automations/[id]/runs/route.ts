import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid automation' }, { status: 400 })
  const { data, error } = await getAdminClient().from('automation_runs').select('*')
    .eq('rule_id', id).order('started_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ runs: data ?? [] })
}
