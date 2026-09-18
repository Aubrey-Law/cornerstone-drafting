import Image from 'next/image'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import IntakeAuthForm from './IntakeAuthForm'
import { clientIpFrom } from '@/lib/clientIp'
import { consumeRateLimit } from '@/lib/rateLimit'
import { getFirmConfig } from '@/lib/firmConfig'
import { resolveIntakeByInviteToken } from '@/lib/intake/standingLinks'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'

interface SearchParams {
  token?: string
  invite?: string
}

/**
 * Is this caller out of token lookups for the minute?
 *
 * This page is public, unauthenticated, and reachable with any string in the
 * query — and every presented token costs two service-role reads before it can
 * be rejected, because `resolveIntakeByInviteToken` falls back from the hashed
 * column to the legacy plaintext one. A valid token costs a write on top of
 * that. Nothing metered it.
 *
 * The tokens themselves are sound — standing links are HMAC-signed and invite
 * tokens are 32 CSPRNG bytes — so this is not a way in. It is an unmetered
 * database endpoint, and the counterpart of the guard on /api/sign/[token].
 *
 * 60/min matches that route and the same reasoning applies: a real client opens
 * their emailed link once, several people can share one address behind
 * household or carrier NAT, and a false block here means someone cannot start
 * their intake at all. `consumeRateLimit` fails open if its RPC errors, which
 * is the right way round for the same reason.
 *
 * A page cannot answer 429 — the App Router has no way to set that status — so
 * an exhausted caller gets the screen below at 200. The protection is that the
 * database work does not happen, which is the same either way; what is lost is
 * only the machine-readable signal, and the audience here is a person holding
 * a link.
 */
async function outOfTokenLookups(): Promise<boolean> {
  const ip = clientIpFrom(await headers())
  const rl = await consumeRateLimit({ bucket: 'intake-auth', limit: 60, windowSeconds: 60 }, ip)
  return !rl.ok
}

export default async function IntakeAuthPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { token, invite } = await searchParams
  const inviteToken = invite ?? token ?? ''
  const firm = getFirmConfig()

  if (!inviteToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 dark">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Invalid link. Ask your attorney to send a new intake invitation from the matter page.
        </p>
      </div>
    )
  }

  // After the empty-token branch above, so a truncated link costs nobody their
  // budget, and before any lookup, so an exhausted caller does no database work.
  if (await outOfTokenLookups()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 dark">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-sm text-foreground">Too many attempts from this connection.</p>
          <p className="text-sm text-muted-foreground">
            Please wait a minute and open your link again. If it keeps happening, email{' '}
            <a href={`mailto:${firm.email}`} className="text-accent hover:underline">
              {firm.email}
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  const admin = getAdminClient()
  const intake = await resolveIntakeByInviteToken(admin, inviteToken)

  if (!intake) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 dark">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          This intake link is invalid or expired. Ask your attorney to send a new invitation.
        </p>
      </div>
    )
  }

  await admin
    .from('client_intake')
    .update({ intake_token_last_used_at: new Date().toISOString() })
    .eq('id', intake.id)

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const invitedEmail = typeof intake.email === 'string' ? intake.email.trim().toLowerCase() : ''
    const userEmail = user.email?.trim().toLowerCase() ?? ''
    if (!invitedEmail || userEmail !== invitedEmail) {
      redirect('/auth/login?error=staff_only&redirectTo=/intake')
    }

    await admin
      .from('client_intake')
      .update({
        client_user_id: user.id,
        user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', intake.id)

    await admin.from('matters').update({ client_id: user.id }).eq('client_intake_id', intake.id).eq('relationship_status', 'hired')

    redirect('/intake')
  }

  const alreadyRegistered = Boolean(intake.client_user_id || intake.user_id)
  const submitted = intake.status === 'submitted' || intake.status === 'approved'
  if (alreadyRegistered || submitted) {
    const redirectTo = encodeURIComponent('/intake')
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 dark">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
          <h1 className="text-lg font-medium text-foreground">Continue your intake</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This intake already has a portal account. Sign in to continue or review its status.
          </p>
          <Link
            href={`/auth/login?redirectTo=${redirectTo}`}
            className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 dark">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <Link href="/auth/login" aria-label="Cornerstone home">
            <Image
              src="/logos/aubrey-law-stacked-dark.svg"
              alt="Aubrey Law"
              width={220}
              height={128}
              priority
            />
          </Link>
        </div>

        <div className="space-y-5 rounded-lg border bg-card p-8 shadow-sm">
          <div className="text-center">
            <h1 className="text-lg font-medium text-foreground">Start your intake</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a secure portal password for {intake.email}. You will go straight to the
              questionnaire — no email confirmation required.
            </p>
          </div>

          <IntakeAuthForm inviteToken={inviteToken} invitedEmail={intake.email ?? undefined} />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Questions? Email{' '}
          <a href={`mailto:${firm.email}`} className="text-accent hover:underline">
            {firm.email}
          </a>
        </p>
      </div>
    </div>
  )
}
