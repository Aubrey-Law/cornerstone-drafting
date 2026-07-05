import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { mergeUserPreferences, parseUserPreferences, type UserPreferences } from '@/lib/userPreferences'

export async function GET(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('users')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    // Column may not exist on older firm databases — fall back gracefully.
    if (error.message.includes('preferences')) {
      return NextResponse.json({ preferences: {} satisfies UserPreferences })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ preferences: parseUserPreferences(data?.preferences) })
}

export async function PATCH(req: Request) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { preferences?: Partial<UserPreferences> } | null
  if (!body?.preferences || typeof body.preferences !== 'object') {
    return NextResponse.json({ error: 'preferences is required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: existing, error: readError } = await admin
    .from('users')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle()

  if (readError?.message.includes('preferences')) {
    return NextResponse.json({ error: 'User preferences are not available on this database yet.' }, { status: 501 })
  }
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })

  const merged = mergeUserPreferences(parseUserPreferences(existing?.preferences), body.preferences)
  const { error: writeError } = await admin
    .from('users')
    .update({ preferences: merged })
    .eq('id', user.id)

  if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 })
  return NextResponse.json({ preferences: merged })
}
