import { NextRequest, NextResponse } from 'next/server'
import { checkEnv } from '@/lib/env'

/**
 * GET /api/health            — liveness. 200 {ok:true} for uptime monitors.
 * GET /api/health?check=env  — readiness of configuration. 503 with the missing
 *                              variable names when the environment is incomplete.
 *
 * Dependency probes (Supabase, R2) join this route when the workbench gains
 * code that talks to them; until then a probe would be checking credentials
 * nothing uses.
 */
export async function GET(request: NextRequest) {
  const check = request.nextUrl.searchParams.get('check')
  if (check === 'env') {
    const env = checkEnv(process.env)
    return NextResponse.json({ ok: env.ok, app: 'workbench', env }, { status: env.ok ? 200 : 503 })
  }
  return NextResponse.json({ ok: true, app: 'workbench' })
}
