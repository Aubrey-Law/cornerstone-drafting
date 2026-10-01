import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { ActionServiceError, getActionProposalPreview, rejectActionProposal } from '@/lib/actions/server'

type Params = { params: Promise<{ id: string }> }

function actionError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Action proposal request failed'
  return NextResponse.json(
    { error: message, code: error instanceof ActionServiceError ? error.code : 'proposal_error' },
    { status: error instanceof ActionServiceError ? error.status : 409 },
  )
}

export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.user) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid proposal' }, { status: 400 })
  try {
    return NextResponse.json(await getActionProposalPreview(id, auth.user))
  } catch (error) {
    return actionError(error)
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.user) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid proposal' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { status?: unknown }
  if (body.status !== 'rejected') return NextResponse.json({ error: 'Only rejection is supported' }, { status: 400 })
  try {
    return NextResponse.json(await rejectActionProposal(id, auth.user))
  } catch (error) {
    return actionError(error)
  }
}
