import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { IntegrationError, safeIntegrationError } from '@/lib/integrations/errors'
import { isMercuryConfigured, loadMercuryDepositProposals } from '@/lib/integrations/mercury/deposits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(120).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/**
 * GET /api/admin/billing/mercury/deposits — bank deposits matched against open
 * invoices.
 *
 * Read-only in both directions: it reads Mercury, reads the ledger, and writes
 * nothing. The response carries only what the card renders — no account
 * numbers, balances, card or tracking identifiers.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  // An unset token is a first-class off state, not an error to page anyone about.
  if (!isMercuryConfigured()) {
    return NextResponse.json({ error: 'Mercury is not configured.' }, { status: 503 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    days: url.searchParams.get('days') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid query' }, { status: 400 })
  }

  try {
    const view = await loadMercuryDepositProposals(parsed.data)
    return NextResponse.json(view)
  } catch (error) {
    if (error instanceof IntegrationError) {
      const status = error.code === 'rate_limited' ? 429 : error.kind === 'retryable' ? 503 : 502
      const headers = error.retryAfterMs
        ? { 'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) }
        : undefined
      return NextResponse.json(safeIntegrationError(error), { status, headers })
    }
    console.error('[mercury deposits]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Bank deposits are temporarily unavailable.' }, { status: 503 })
  }
}
