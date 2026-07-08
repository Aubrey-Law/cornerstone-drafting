import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  deleteUserApiKey,
  listUserApiKeyStatus,
  normalizeApiKeyProvider,
  upsertUserApiKey,
} from '@/lib/userApiKeys'

/** GET /api/admin/me/api-keys — masked status only (never raw keys). */
export async function GET(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  try {
    const keys = await listUserApiKeyStatus(admin, user.id)
    return NextResponse.json({ keys })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('user_api_keys') || message.includes('schema cache')) {
      return NextResponse.json({ keys: [], unavailable: true })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** PUT /api/admin/me/api-keys — { provider, key } */
export async function PUT(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { provider?: string; key?: string } | null
  const provider = normalizeApiKeyProvider(body?.provider ?? '')
  if (!provider) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
  if (!body?.key?.trim()) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const admin = getAdminClient()
  const result = await upsertUserApiKey(admin, user.id, provider, body.key)
  if (!result.ok) {
    const status = result.error.includes('ENCRYPTION_SECRET') ? 501 : 500
    return NextResponse.json({ error: result.error }, { status })
  }

  const keys = await listUserApiKeyStatus(admin, user.id)
  return NextResponse.json({ keys })
}

/** DELETE /api/admin/me/api-keys — { provider } */
export async function DELETE(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { provider?: string } | null
  const provider = normalizeApiKeyProvider(body?.provider ?? '')
  if (!provider) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })

  const admin = getAdminClient()
  const result = await deleteUserApiKey(admin, user.id, provider)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  const keys = await listUserApiKeyStatus(admin, user.id)
  return NextResponse.json({ keys })
}
