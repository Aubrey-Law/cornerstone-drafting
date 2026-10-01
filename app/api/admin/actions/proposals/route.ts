import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createActionProposal } from '@/lib/actions/server'
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
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to propose action' }, { status: 400 })
  }
}
