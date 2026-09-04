import { NextResponse } from 'next/server'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Sign-out is POST only.
 *
 * On GET, any link, image or link prefetch pointed at this path signs the user
 * out — including one on a page the firm does not control, and including Next's
 * own prefetching. Refusing the method is what makes the form the only way.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  // 303 so the browser follows with GET rather than re-POSTing to the login page.
  return NextResponse.redirect(new URL(LOGIN_PATH, request.url), 303)
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    { status: 405, headers: { allow: 'POST' } },
  )
}
