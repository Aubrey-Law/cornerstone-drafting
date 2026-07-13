import { NextResponse } from 'next/server'
import { MIN_CLIENT_PASSWORD_LENGTH } from '@/lib/auth/clientPassword'
import { hashIntakeInviteToken, isIntakeInviteExpired } from '@/lib/intakeInviteTokens'
import { getAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  let body: { inviteToken?: string; email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const inviteToken = body.inviteToken?.trim() ?? ''
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''

  if (!inviteToken) return NextResponse.json({ error: 'Invite token is required' }, { status: 400 })
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  if (password.length < MIN_CLIENT_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_CLIENT_PASSWORD_LENGTH} characters` },
      { status: 400 },
    )
  }

  const admin = getAdminClient()
  const tokenHash = hashIntakeInviteToken(inviteToken)

  const { data: intake } = await admin
    .from('client_intake')
    .select('id, email, intake_token_expires_at')
    .eq('intake_token_hash', tokenHash)
    .maybeSingle()

  if (!intake) {
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 401 })
  }
  if (isIntakeInviteExpired(intake.intake_token_expires_at as string | null | undefined)) {
    return NextResponse.json({ error: 'This intake link has expired' }, { status: 401 })
  }

  const invitedEmail = typeof intake.email === 'string' ? intake.email.trim().toLowerCase() : ''
  if (!invitedEmail) {
    return NextResponse.json(
      { error: 'This intake link is missing a recipient email. Contact your attorney for a new link.' },
      { status: 400 },
    )
  }
  if (email !== invitedEmail) {
    return NextResponse.json(
      { error: 'Use the email address that received this intake invitation.' },
      { status: 403 },
    )
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  let userId: string | null = created?.user?.id ?? null

  if (createErr) {
    const msg = createErr.message?.toLowerCase() ?? ''
    const alreadyExists = msg.includes('already') || msg.includes('exists') || msg.includes('registered')
    if (!alreadyExists) {
      console.error('[intake signup] createUser error:', createErr)
      return NextResponse.json({ error: createErr.message ?? 'Could not create account' }, { status: 500 })
    }

    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listErr) {
      console.error('[intake signup] listUsers error:', listErr)
      return NextResponse.json({ error: 'Could not look up existing account' }, { status: 500 })
    }
    const existing = list.users.find(u => (u.email ?? '').toLowerCase() === email)
    if (!existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Sign in instead.' },
        { status: 409 },
      )
    }
    userId = existing.id
    if (!existing.email_confirmed_at) {
      await admin.auth.admin.updateUserById(existing.id, { email_confirm: true })
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Could not create account' }, { status: 500 })
  }

  await admin.from('users').upsert(
    {
      id: userId,
      email,
      role: 'client',
    },
    { onConflict: 'id' },
  )

  await admin
    .from('client_intake')
    .update({
      client_user_id: userId,
      user_id: userId,
      email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', intake.id)

  await admin
    .from('matters')
    .update({ client_id: userId })
    .eq('client_intake_id', intake.id)
    .eq('relationship_status', 'hired')

  return NextResponse.json({ ok: true })
}
