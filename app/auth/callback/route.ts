import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { pickCanonicalClientIntakeRow } from '@/lib/auth/pickCanonicalClientIntake'
import { safeClientRedirectPath } from '@/lib/auth/safeRedirect'
import { portalUrl, appUrl } from '@/lib/urls'

const ADMIN_ROLES = ['attorney', 'admin']
const VA_ROLES = ['va', 'staff']
const STAFF_ROLES = [...ADMIN_ROLES, ...VA_ROLES]

// Staff (attorney/admin/va/staff) accounts may only be accessed from a firm
// email identity. This is a code-level guarantee that a staff role cannot be
// exercised through a non-firm Google/Microsoft account, independent of the
// OAuth provider's own org restrictions.
const FIRM_EMAIL_DOMAIN = 'aubreylegal.com'

function isFirmEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${FIRM_EMAIL_DOMAIN}`)
}

// Prefer the request's actual host (set by the reverse proxy) so that magic
// links work on whichever host the user arrived from. Fall back to env only
// when no forwarded headers are present (rare; mostly local dev).
function getPublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = (request.headers.get('x-forwarded-proto') ?? 'https')
    .split(',')[0]
    ?.trim() || 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost.split(',')[0].trim()}`
  const host = request.headers.get('host')
  if (host && !host.startsWith('0.0.0.0') && !host.startsWith('127.') && !host.startsWith('localhost')) {
    return `https://${host}`
  }
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (envOrigin) return envOrigin.replace(/\/$/, '')
  return new URL(request.url).origin
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = getPublicOrigin(request)
  const code = searchParams.get('code')
  const next = safeClientRedirectPath(searchParams.get('next'))

  if (code) {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // ── Invite-based intake path ───────────────────────────────────────────
      // Client followed a magic link from the intake email.
      // Link the intake record by email, then follow the next redirect.
      if (next) {
        const admin = getAdminClient()
        const email = data.user.email ?? ''
        if (email) {
          const { data: intakeCandidates } = await admin
            .from('client_intake')
            .select(
              'id, client_user_id, user_id, status, lead_id, intake_sent_at, created_at',
            )
            .eq('email', email)

          const intake = pickCanonicalClientIntakeRow(intakeCandidates ?? [], data.user.id)

          if (intake && !intake.client_user_id) {
            await admin
              .from('client_intake')
              .update({
                client_user_id: data.user.id,
                account_created_at: new Date().toISOString(),
              })
              .eq('id', intake.id)
          }
        }

        return NextResponse.redirect(new URL(next, origin))
      }

      // ── Standard sign-in / sign-up path ────────────────────────────────────
      // Ensure a public.users row exists and get the role.
      const admin = getAdminClient()

      const { data: existingUser } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', data.user.id)
        .single()

      let role = existingUser?.role

      if (!existingUser) {
        await supabase.from('users').insert({
          id: data.user.id,
          email: data.user.email,
          display_name: data.user.user_metadata?.full_name ?? null,
          role: 'client',
        })
        role = 'client'
      }

      // ── Firm-domain gate for staff roles ───────────────────────────────────
      // A staff role may only be exercised from an @aubreylegal.com identity.
      // If a staff-role account is reached via a non-firm email (e.g. signing in
      // through a personal Google account), refuse: sign out and bounce back to
      // the attorney login with an explanatory error.
      if (role && STAFF_ROLES.includes(role) && !isFirmEmail(data.user.email)) {
        await supabase.auth.signOut()
        return NextResponse.redirect(
          `${origin}/auth/login?type=admin&error=firm_domain_required`,
        )
      }

      // ── Client matter bootstrap ─────────────────────────────────────────────
      // For client accounts: ensure a client_intake and matter exist so the
      // dashboard shows something useful immediately after sign-in.
      let clientIntakeStatus: string | null = null
      if (role === 'client') {
        // 1. Find an existing intake row (same email may have duplicates if both
        //    self-signup and firm-sent invites created drafts — pick canonically).
        const { data: intakeCandidates } = await admin
          .from('client_intake')
          .select(
            'id, client_user_id, user_id, status, lead_id, intake_sent_at, created_at',
          )
          .or(
            `email.eq.${data.user.email},client_user_id.eq.${data.user.id},user_id.eq.${data.user.id}`,
          )

        const intake = pickCanonicalClientIntakeRow(intakeCandidates ?? [], data.user.id)
        clientIntakeStatus = (intake?.status as string | undefined) ?? null

        let intakeId: string

        if (intake) {
          // Link account if not yet linked.
          if (!intake.client_user_id) {
            await admin
              .from('client_intake')
              .update({
                client_user_id: data.user.id,
                account_created_at: new Date().toISOString(),
              })
              .eq('id', intake.id)

            // Backfill matters.client_id for matters that were converted before
            // this user had an account. The convert RPC sets client_id via
            // email->users lookup, which returns NULL when no user exists yet.
            // Without this backfill, RLS-gated client-side matters reads
            // silently fail for the converted-before-signup cohort. The
            // `is('client_id', null)` predicate is a safety belt: never
            // overwrites an already-set client_id.
            const { error: mattersErr } = await admin
              .from('matters')
              .update({ client_id: data.user.id })
              .eq('client_intake_id', intake.id)
              .is('client_id', null)
            if (mattersErr) {
              // Non-fatal — matches the spec's handling of the intake-create
              // error path below. Log and continue.
              console.error('[auth/callback] matters client_id backfill error:', mattersErr)
            }
          }
          intakeId = intake.id as string
        } else {
          // No intake record found — create one so the dashboard isn't empty.
          const displayName = (data.user.user_metadata?.full_name as string | undefined) ?? ''
          const [firstName, ...rest] = displayName.trim().split(/\s+/)
          const lastName = rest.join(' ')

          // Reuse an existing lead for this email if one exists (e.g. they
          // submitted the public lead form before creating an account).
          const { data: existingLead } = await admin
            .from('leads')
            .select('id')
            .eq('email', data.user.email)
            .maybeSingle()

          let newLead = existingLead
          if (!existingLead) {
            const { data: createdLead, error: leadError } = await admin
              .from('leads')
              .insert({
                first_name: firstName || 'Unknown',
                last_name: lastName || '',
                email: data.user.email,
                status: 'new',
                source_channel: 'website',
              })
              .select('id')
              .single()

            if (leadError) {
              console.error('[auth/callback] lead create error:', leadError)
            }
            newLead = createdLead
          }

          // Log an activity on the lead so the signup is visible in the pipeline.
          if (newLead) {
            await admin.from('crm_activity').insert({
              lead_id: newLead.id,
              type: existingLead ? 'signup_linked' : 'created',
              payload: { source: 'portal_signup' },
            })
          }

          const { data: newIntake, error: intakeError } = await admin
            .from('client_intake')
            .insert({
              client_user_id: data.user.id,
              email: data.user.email,
              first_name: firstName || null,
              last_name: lastName || null,
              status: 'draft',
              state: 'MA',
              is_us_citizen: true,
              lead_id: newLead?.id ?? null,
            })
            .select('id')
            .single()

          if (intakeError || !newIntake) {
            console.error('[auth/callback] intake create error:', intakeError)
            // Non-fatal — continue to dashboard, which will show the "set up" message
            return NextResponse.redirect(portalUrl('/dashboard'))
          }
          intakeId = newIntake.id as string
        }

        // No matter is auto-created at signup. Leads remain in the pipeline
        // until the attorney explicitly converts them, regardless of whether
        // the intake was attorney-initiated or self-started.
        void intakeId
      }

      // Route to the correct portal based on role, on the correct host.
      let destinationUrl: string
      if (ADMIN_ROLES.includes(role)) destinationUrl = appUrl('/admin/dashboard')
      else if (VA_ROLES.includes(role)) destinationUrl = appUrl('/va/dashboard')
      else if (role === 'client' && clientIntakeStatus !== 'submitted' && clientIntakeStatus !== 'approved') {
        // New / in-progress clients land directly in the questionnaire.
        destinationUrl = portalUrl('/intake')
      } else {
        destinationUrl = portalUrl('/dashboard')
      }
      return NextResponse.redirect(destinationUrl)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
}
