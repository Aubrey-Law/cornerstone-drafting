import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { guardPublicSchedulingRoute } from '@/lib/appointments/publicRouteGuard'
import { MIN_CLIENT_PASSWORD_LENGTH } from '@/lib/auth/clientPassword'
import { resolveIntakeByInviteToken } from '@/lib/intake/standingLinks'
import { consumeRateLimit } from '@/lib/rateLimit'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Two limits, because this route has two costs and they belong to different
 * people.
 *
 * Anyone can POST here — it is in PUBLIC_AUTH_PATHS, so the proxy demands no
 * session — and every request carrying a token spends two service-role reads
 * before it can be rejected, the same pair /intake/auth pays. That is bounded
 * per address.
 *
 * The expensive half is bounded per invite instead. Creating the account is
 * once-only in the happy path: it sets client_user_id, and the next request
 * 409s before reaching it. The loop that is not once-only is the duplicate
 * branch — createUser reports the address is taken, and the route pages
 * through the auth directory looking for it — and an address has no budget of
 * its own to spend there. Keying that on the intake is what makes it
 * meaningful: a token has to be *valid* to get this far, so unlike the signing
 * route, where a script would present a different token every time, the key
 * here is something an attacker cannot vary.
 *
 * Splitting them also keeps a household honest. Two spouses onboarding from
 * one sofa share an address but not an invite, so neither can exhaust the
 * other's attempts at the part that matters.
 */
const SIGNUP_ATTEMPTS_PER_INVITE = 5

/**
 * Find an account by address, in a directory that cannot be searched by one.
 *
 * GoTrue's admin API offers no lookup by email — `listUsers` takes `page` and
 * `perPage` and nothing else (see PageParams in @supabase/auth-js). This route
 * used to ask for `{ page: 1, perPage: 1000 }` and treat a miss as "no such
 * account", which is only true while the firm has fewer than a thousand of
 * them. Past that the client was told to sign in to an account that was never
 * linked to their intake, and the reason was invisible: a single page looks
 * exactly like a whole directory.
 *
 * So page through it. `listUsers` returns `nextPage` alongside the rows, which
 * is the only honest way to know there is no more to read. The cap is there so
 * a directory larger than expected surfaces as an error rather than as a
 * silent miss — the same failure this replaces.
 *
 * This runs only when `createUser` has already said the address is taken, so
 * the common path never reaches it.
 */
const DIRECTORY_PAGE_SIZE = 200
const DIRECTORY_PAGE_CAP = 50

type AdminClient = ReturnType<typeof getAdminClient>

async function findAuthUserByEmail(
  admin: AdminClient,
  email: string,
): Promise<{ ok: true; user: User | null } | { ok: false; reason: string }> {
  for (let page = 1; page <= DIRECTORY_PAGE_CAP; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: DIRECTORY_PAGE_SIZE,
    })
    if (error) return { ok: false, reason: error.message }

    const match = data.users.find(u => (u.email ?? '').toLowerCase() === email)
    if (match) return { ok: true, user: match }

    // Absent when this was the last page. Reading rows and stopping there is
    // what made the old single-page call wrong.
    const { nextPage } = data as { nextPage?: number | null }
    if (!nextPage) return { ok: true, user: null }
  }
  return {
    ok: false,
    reason: `directory exceeds ${DIRECTORY_PAGE_CAP * DIRECTORY_PAGE_SIZE} accounts`,
  }
}

export async function POST(req: Request) {
  // Before the body is even read: the cheapest request to send is the one
  // worth bounding first.
  const limited = await guardPublicSchedulingRoute(req, 'intake-signup', 20)
  if (limited) return limited

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
  const intake = await resolveIntakeByInviteToken(admin, inviteToken)

  if (!intake) {
    return NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 401 })
  }
  if (intake.client_user_id || intake.user_id || intake.status === 'submitted' || intake.status === 'approved') {
    return NextResponse.json(
      { error: 'This intake already has an account. Sign in instead.' },
      { status: 409 },
    )
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

  // Everything above is a read or a refusal; past here the route writes to the
  // auth directory. So the budget is spent here and not a line earlier: a
  // mismatched address is turned away for free, because refusing it costs
  // nothing and the per-address limit already bounds how fast anyone can try.
  // What this counts is attempts that reach the directory itself.
  const attempt = await consumeRateLimit(
    { bucket: 'intake-signup-account', limit: SIGNUP_ATTEMPTS_PER_INVITE, windowSeconds: 3600 },
    intake.id,
  )
  if (!attempt.ok) {
    return NextResponse.json(
      { error: 'Too many attempts on this invitation. Please try again later or contact the firm.' },
      { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSeconds || 3600) } },
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

    const found = await findAuthUserByEmail(admin, email)
    if (!found.ok) {
      console.error('[intake signup] directory lookup failed:', found.reason)
      return NextResponse.json({ error: 'Could not look up existing account' }, { status: 500 })
    }
    const existing = found.user
    if (!existing) {
      // createUser said the address was taken and the directory says otherwise.
      // The client is told the right thing either way, but the contradiction is
      // worth a line: it means the two disagree, not that the page ran out.
      console.error('[intake signup] createUser reported a duplicate the directory does not hold:', email)
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
