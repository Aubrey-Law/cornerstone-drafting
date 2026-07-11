import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { deleteLead } from '@/lib/leads/deleteLead'

export async function POST(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  let body: { ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No lead ids provided' }, { status: 400 })
  }

  const admin = getAdminClient()
  const results: { id: string; ok: boolean; error?: string }[] = []
  for (const id of ids) {
    try {
      await deleteLead(admin, id)
      results.push({ id, ok: true })
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : 'Could not delete lead' })
    }
  }

  const deleted = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  return NextResponse.json({ ok: failed.length === 0, deleted, total: ids.length, results })
}
