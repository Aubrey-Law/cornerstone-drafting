import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/lawmatics'
import { requireAdmin } from '@/lib/apiAuth'

const STATE_COOKIE = 'lawmatics_oauth_state'
const STATE_TTL_SECONDS = 600

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const state = randomBytes(32).toString('hex')
  const url = getAuthUrl(state)
  const res = NextResponse.redirect(url)
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  })
  return res
}
