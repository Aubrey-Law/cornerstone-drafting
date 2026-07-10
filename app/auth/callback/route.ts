import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabaseServer'
import {
  DEFAULT_ADMIN_HOME,
  safeAdminRedirectPath,
  safeClientRedirectPath,
} from '@/lib/auth/safeRedirect'
import { ensureUserProfile, isFirmEmail } from '@/lib/auth/ensureUserProfile'

const ADMIN_ROLES = ['attorney', 'admin'] as const

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
  const rawRedirect = searchParams.get('redirectTo')

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

  const role = await ensureUserProfile(supabase, data.user)

  if (role && ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    if (!isFirmEmail(data.user.email)) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/auth/login?error=firm_domain_required`)
    }
    const destination = safeAdminRedirectPath(rawRedirect) ?? DEFAULT_ADMIN_HOME
    return NextResponse.redirect(new URL(destination, origin))
  }

  if (role === 'client') {
    const destination = safeClientRedirectPath(rawRedirect) ?? '/dashboard'
    return NextResponse.redirect(new URL(destination, origin))
  }

  await supabase.auth.signOut()
  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
}
