import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

function resolveOrigin(req: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  if (process.env.SUPABASE_AUTH_SITE_URL) return process.env.SUPABASE_AUTH_SITE_URL.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (host) return `${proto}://${host}`
  return new URL(req.url).origin
}

export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => ({})) as { matterId?: string }
  const matterId = typeof body.matterId === 'string' ? body.matterId.trim() : ''
  if (!matterId) {
    return NextResponse.json({ error: 'matterId is required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id, client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (matterError) {
    return NextResponse.json({ error: matterError.message }, { status: 500 })
  }
  if (!matter?.client_intake_id) {
    return NextResponse.json({ error: 'Matter not found or missing intake' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const { error: intakeError } = await admin
    .from('client_intake')
    .update({ intake_sent_at: now })
    .eq('id', matter.client_intake_id)

  if (intakeError) {
    return NextResponse.json({ error: intakeError.message }, { status: 500 })
  }

  const origin = resolveOrigin(req)
  const url = `${origin}/auth/login?redirectTo=/intake`

  try {
    const actorName =
      (user?.user_metadata?.full_name as string | undefined)
      ?? user?.email
      ?? null
    await admin.from('matter_activity').insert({
      matter_id: matterId,
      event_type: 'intake_sent',
      title: 'Intake sent',
      detail: url,
      actor_id: userId,
      actor_email: user?.email ?? null,
      actor_name: actorName,
    })
  } catch (e) {
    console.warn('matter_activity intake_sent skipped:', e)
  }

  return NextResponse.json({ url, intake_sent_at: now })
}
