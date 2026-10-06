import { NextResponse } from 'next/server'
import { requireAdmin, requireAdministrator } from '@/lib/apiAuth'
import { parseRulePatch } from '@/lib/probateDeadlines/model'
import {
  listDeadlineRules,
  ProbateDeadlinesUnavailableError,
  syncAllProbateDeadlines,
  updateDeadlineRule,
} from '@/lib/probateDeadlines/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** GET — the deadline rules, confirmed and draft. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  try {
    const rules = await listDeadlineRules()
    if (rules === null) return NextResponse.json({ rules: [], unavailable: true })
    return NextResponse.json({ rules, unavailable: false })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load probate deadlines' }, { status: 500 })
  }
}

/**
 * PATCH — edit or confirm one rule, then bring every probate matter in line.
 * Administrators only: a rule dates every probate matter in the firm.
 */
export async function PATCH(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let patch
  try {
    patch = parseRulePatch(await req.json().catch(() => null))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid rule' }, { status: 400 })
  }
  const admin = getAdminClient()
  try {
    const rule = await updateDeadlineRule(admin, patch, auth.userId)
    const sync = await syncAllProbateDeadlines(admin)
    return NextResponse.json({ rule, sync })
  } catch (error) {
    const status = error instanceof ProbateDeadlinesUnavailableError ? 503 : error instanceof Error && error.message === 'Rule not found' ? 404 : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save the rule' }, { status })
  }
}
