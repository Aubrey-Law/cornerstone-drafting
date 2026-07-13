import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import IntakeAuthForm from './IntakeAuthForm'
import { getFirmConfig } from '@/lib/firmConfig'
import { hashIntakeInviteToken, isIntakeInviteExpired } from '@/lib/intakeInviteTokens'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'

interface SearchParams {
  token?: string
  invite?: string
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

  const admin = getAdminClient()
  const tokenHash = hashIntakeInviteToken(inviteToken)
  const { data: intake } = await admin
    .from('client_intake')
    .select('id, email, intake_token_expires_at')
    .eq('intake_token_hash', tokenHash)
    .maybeSingle()

  if (!intake || isIntakeInviteExpired(intake.intake_token_expires_at as string | null | undefined)) {
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
