import { NextRequest, NextResponse } from 'next/server'
import { HeadBucketCommand } from '@aws-sdk/client-s3'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getR2Client, R2_BUCKET } from '@/lib/r2'

// Default GET returns liveness only (200 {ok:true}) for Vercel uptime checks
// and any external synthetic monitor.
//
// GET /api/health?check=full performs readiness probes against critical
// dependencies (Supabase, R2). Resend and Anthropic are env-presence only —
// we don't make billable API calls from a healthcheck. 503 if any required
// dependency fails.

type CheckStatus = 'ok' | 'fail' | 'skip'
type Check = { status: CheckStatus; latencyMs?: number; detail?: string }

const CHECK_TIMEOUT_MS = 3000

async function withTimeout<T>(label: string, p: Promise<T>): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS)
    ),
  ])
}

async function checkSupabase(): Promise<Check> {
  const start = Date.now()
  try {
    const admin = getAdminClient()
    // HEAD count against a tiny lookup table — cheap and exercises auth.
    const { error } = await withTimeout(
      'supabase',
      Promise.resolve(admin.from('matter_stage_rules').select('id', { count: 'exact', head: true }))
    )
    if (error) return { status: 'fail', latencyMs: Date.now() - start, detail: error.message }
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    return { status: 'fail', latencyMs: Date.now() - start, detail: (e as Error).message }
  }
}

async function checkR2(): Promise<Check> {
  const start = Date.now()
  try {
    const client = getR2Client()
    await withTimeout('r2', client.send(new HeadBucketCommand({ Bucket: R2_BUCKET })))
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    return { status: 'fail', latencyMs: Date.now() - start, detail: (e as Error).message }
  }
}

function checkResendEnv(): Check {
  const key = process.env.RESEND_API_KEY
  if (!key) return { status: 'fail', detail: 'RESEND_API_KEY missing' }
  if (!key.startsWith('re_')) return { status: 'fail', detail: 'RESEND_API_KEY malformed' }
  return { status: 'ok' }
}

function checkAnthropicEnv(): Check {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { status: 'fail', detail: 'ANTHROPIC_API_KEY missing' }
  if (!key.startsWith('sk-ant-')) return { status: 'fail', detail: 'ANTHROPIC_API_KEY malformed' }
  return { status: 'ok' }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (url.searchParams.get('check') !== 'full') {
    return NextResponse.json({ ok: true })
  }

  const [supabase, r2] = await Promise.all([checkSupabase(), checkR2()])
  const resend = checkResendEnv()
  const anthropic = checkAnthropicEnv()

  const checks = { supabase, r2, resend, anthropic }
  const ok = Object.values(checks).every((c) => c.status !== 'fail')

  return NextResponse.json(
    {
      ok,
      checks,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? null,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    },
    { status: ok ? 200 : 503 }
  )
}
