import { NextRequest, NextResponse } from 'next/server'
import { HeadBucketCommand } from '@aws-sdk/client-s3'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getR2Client, r2Bucket } from '@/lib/r2'
import { isSmsConfigured, isVoiceConfigured } from '@/lib/communications/config'
import { smsProvider, voiceProvider } from '@/lib/communications/providers'

// Default GET returns liveness only (200 {ok:true}) for Vercel uptime checks
// and any external synthetic monitor.
//
// GET /api/health?check=full performs readiness probes against critical
// dependencies (Supabase, R2). 503 if any required dependency fails.

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
    await withTimeout('r2', client.send(new HeadBucketCommand({ Bucket: r2Bucket() })))
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    return { status: 'fail', latencyMs: Date.now() - start, detail: (e as Error).message }
  }
}

function checkCommunications(): Check {
  const smsSelected = false // SMS delivery is retired.
  const voiceSelected = Boolean(process.env.VOICE_PROVIDER?.trim()) && voiceProvider() !== 'none'
  if (!smsSelected && !voiceSelected) return { status: 'skip' }
  const missing = [
    ...(smsSelected && !isSmsConfigured() ? [`${smsProvider()} SMS`] : []),
    ...(voiceSelected && !isVoiceConfigured() ? [`${voiceProvider()} voice`] : []),
  ]
  return missing.length
    ? { status: 'fail', detail: `Incomplete configuration: ${missing.join(', ')}` }
    : { status: 'ok' }
}

// Config-only, like checkCommunications above. It exists because the absence of
// this one variable is otherwise discovered halfway through the agreement
// workspace — after creating a lead, drafting an agreement and clicking approve
// — as a bare "not configured" error. It went unset in production for months
// because nothing asked for it until someone walked that flow by hand.
//
// It gates readiness rather than merely reporting, because approve and send both
// fail without it whichever e-signature provider is selected: the workspace is
// genuinely unusable, not degraded.
export function checkEngagementSigning(): Check {
  return process.env.ENGAGEMENT_APPROVAL_SECRET?.trim()
    ? { status: 'ok' }
    : {
        status: 'fail',
        detail: 'ENGAGEMENT_APPROVAL_SECRET is not set; engagement approve and send will fail',
      }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (url.searchParams.get('check') !== 'full') {
    return NextResponse.json({ ok: true })
  }

  const [supabase, r2] = await Promise.all([checkSupabase(), checkR2()])

  const checks = {
    supabase,
    r2,
    communications: checkCommunications(),
    engagementSigning: checkEngagementSigning(),
  }
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
