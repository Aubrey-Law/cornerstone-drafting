import { NextResponse } from 'next/server'
import { MIN_CLIENT_PASSWORD_LENGTH } from '@/lib/auth/clientPassword'
import { createLead } from '@/lib/leads/createLead'
import { consumeRateLimit } from '@/lib/rateLimit'
import { getAdminClient } from '@/lib/supabaseAdmin'

type RegistrationBody = {
  fullName?: unknown
  email?: unknown
  phone?: unknown
  password?: unknown
  turnstileToken?: unknown
}

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown'
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return process.env.NODE_ENV !== 'production'
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    cache: 'no-store',
  })
  if (!response.ok) return false
  const result = await response.json().catch(() => null) as { success?: boolean } | null
  return result?.success === true
}

function existingAccountResponse() {
  // Intentionally neutral: callers get the same response whether the email is
  // present in Auth, leads, or client records.
  return NextResponse.json({
    ok: false,
    existingAccount: true,
    message: 'If an account exists for this email, sign in or reset its password to continue.',
  }, { status: 409 })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as RegistrationBody | null
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const turnstileToken = typeof body?.turnstileToken === 'string' ? body.turnstileToken.trim() : ''

  if (!fullName || !email) {
    return NextResponse.json({ error: 'Full name and email are required' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }
  if (password.length < MIN_CLIENT_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_CLIENT_PASSWORD_LENGTH} characters` },
      { status: 400 },
    )
  }
  if (!turnstileToken && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Complete the security check' }, { status: 400 })
  }

  const ip = clientIp(req)
  const [ipLimit, emailLimit] = await Promise.all([
    consumeRateLimit({ bucket: 'public_intake_ip', limit: 8, windowSeconds: 3600 }, ip),
    consumeRateLimit({ bucket: 'public_intake_email', limit: 3, windowSeconds: 3600 }, email),
  ])
  if (!ipLimit.ok || !emailLimit.ok) {
    const retryAfter = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds)
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }
  if (!await verifyTurnstile(turnstileToken, ip)) {
    return NextResponse.json({ error: 'Security check failed. Please try again.' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: existing } = await admin
    .from('client_intake')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle()
  if (existing) return existingAccountResponse()

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (authError || !created.user) {
    const duplicate = /already|exists|registered/i.test(authError?.message ?? '')
    if (duplicate) return existingAccountResponse()
    return NextResponse.json({ error: authError?.message ?? 'Could not create account' }, { status: 500 })
  }

  const userId = created.user.id
  try {
    const { error: profileError } = await admin.from('users').upsert(
      { id: userId, email, role: 'client', display_name: fullName },
      { onConflict: 'id' },
    )
    if (profileError) throw new Error(profileError.message)

    const lead = await createLead({
      clientName: fullName,
      clientEmail: email,
      clientPhone: phone || null,
      clientUserId: userId,
      practiceArea: 'EP',
    })
    return NextResponse.json({ ok: true, leadId: lead.leadId })
  } catch (error) {
    // Compensate for a partially-created Auth identity. No session has been
    // issued yet, so this cannot leave a valid orphan token behind.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not start intake' },
      { status: 500 },
    )
  }
}
