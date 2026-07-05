import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabaseServer'
import { safeAdminRedirectPath } from '@/lib/auth/safeRedirect'

const ADMIN_ROLES = ['attorney', 'admin'] as const
const FIRM_EMAIL_DOMAIN = 'aubreylegal.com'

function isFirmEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${FIRM_EMAIL_DOMAIN}`)
}

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
  const redirectTo = safeAdminRedirectPath(searchParams.get('redirectTo'))

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

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

  if (!role || !ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/auth/login?error=staff_only`)
  }

  if (!isFirmEmail(data.user.email)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/auth/login?error=firm_domain_required`)
  }

  const destination = redirectTo ?? '/admin/drafting'
  return NextResponse.redirect(new URL(destination, origin))
}
