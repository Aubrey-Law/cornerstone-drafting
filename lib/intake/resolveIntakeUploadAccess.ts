import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveIntakeByInviteToken } from '@/lib/intake/standingLinks'

type AdminClient = ReturnType<typeof getAdminClient>

export async function resolveIntakeUploadAccess(
  req: Request,
  intakeId: string,
): Promise<{ ok: true; user: User | null; admin: AdminClient } | { ok: false; status: number; error: string }> {
  const admin = getAdminClient()
  const publicToken = req.headers.get('x-intake-token')

  if (publicToken) {
    const intake = await resolveIntakeByInviteToken(admin, publicToken)

    if (!intake || intake.id !== intakeId || intake.user_id || intake.client_user_id) {
      return { ok: false, status: 401, error: 'Invalid or expired intake token' }
    }
    return { ok: true, user: null, admin }
  }

  const bearer = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearer) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await sb.auth.getUser(bearer)
  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const { data: intake } = await admin
    .from('client_intake')
    .select('id')
    .eq('id', intakeId)
    .or(`user_id.eq.${user.id},client_user_id.eq.${user.id}`)
    .maybeSingle()

  if (!intake) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return { ok: true, user, admin }
}
