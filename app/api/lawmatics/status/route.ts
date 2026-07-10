import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const admin = getAdminClient()
  const { data: stored, error } = await admin
    .from('lawmatics_tokens')
    .select('id, expires_at, updated_at, access_token')
    .eq('id', 'singleton')
    .maybeSingle()

  if (error) return NextResponse.json({ connected: false, error: error.message })
  if (!stored) return NextResponse.json({ connected: false, reason: 'No token stored' })

  const expiresAt = new Date(stored.expires_at)
  const expired = expiresAt < new Date()
  const tokenPreview = `${stored.access_token?.slice(0, 8)}...`

  return NextResponse.json({
    connected: true,
    expired,
    expires_at: stored.expires_at,
    updated_at: stored.updated_at,
    token_preview: tokenPreview,
  })
}
