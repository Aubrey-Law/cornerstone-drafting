import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const admin = getAdminClient()
  const { data: stored, error } = await admin
    .from('lawmatics_tokens')
    .select('updated_at, access_token')
    .eq('id', 'singleton')
    .maybeSingle()

  if (error) return NextResponse.json({
    connected: false,
    updatedAt: null,
    error: 'Lawmatics connection could not be read',
  })

  return NextResponse.json({
    connected: Boolean(stored?.access_token),
    updatedAt: stored?.updated_at ?? null,
  })
}
