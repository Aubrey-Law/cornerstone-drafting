import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { hashIntakeInviteToken, isIntakeInviteExpired } from '@/lib/intakeInviteTokens'

type AdminClient = ReturnType<typeof getAdminClient>

export async function resolveIntakeUploadAccess(
  req: Request,
  intakeId: string,
): Promise<{ ok: true; user: User | null; admin: AdminClient } | { ok: false; status: number; error: string }> {
  const admin = getAdminClient()
  const publicToken = req.headers.get('x-intake-token')

  if (publicToken) {
    const tokenHash = hashIntakeInviteToken(publicToken)
    let { data: intake } = await admin
      .from('client_intake')
      .select('id, intake_token_expires_at')
      .eq('intake_token_hash', tokenHash)
      .maybeSingle()

    if (!intake) {
      const legacy = await admin
        .from('client_intake')
        .select('id, intake_token_expires_at')
        .eq('intake_token', publicToken)
        .maybeSingle()
      intake = legacy.data
    }

    if (!intake || intake.id !== intakeId) {
      return { ok: false, status: 401, error: 'Invalid or expired intake token' }
    }
    if (isIntakeInviteExpired(intake.intake_token_expires_at as string | null | undefined)) {
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
