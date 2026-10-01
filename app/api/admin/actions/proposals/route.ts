import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { ActionServiceError, createActionProposal } from '@/lib/actions/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { ActionProposalRequest } from '@/lib/actions/types'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId || !auth.user) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json() as ActionProposalRequest
    if (!body.displaySummary?.trim()) return NextResponse.json({ error: 'A display summary is required' }, { status: 400 })
    const result = await createActionProposal(body, auth.user)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to propose action', code: error instanceof ActionServiceError ? error.code : 'invalid_action' },
      { status: error instanceof ActionServiceError ? error.status : 400 },
    )
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'pending'
  if (!['pending', 'accepted', 'rejected', 'expired', 'executed', 'failed'].includes(status)) {
    return NextResponse.json({ error: 'Invalid proposal status' }, { status: 400 })
  }
  const { data, error } = await getAdminClient().from('action_proposals')
    .select('id, action_key, risk, status, record_type, record_id, display_summary, idempotency_key, expires_at, source, preview_digest, confirmation_policy, created_at, updated_at')
    .eq('actor_id', auth.userId).eq('status', status)
    .order('created_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ proposals: data ?? [] })
}
