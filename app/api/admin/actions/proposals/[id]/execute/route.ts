import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { ActionServiceError, executeActionProposal } from '@/lib/actions/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.user) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid proposal' }, { status: 400 })
  try {
    const body = await req.json().catch(() => ({})) as { confirmationDigest?: unknown }
    return NextResponse.json(await executeActionProposal(id, auth.user, {
      confirmationDigest: typeof body.confirmationDigest === 'string' ? body.confirmationDigest : undefined,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action execution failed'
    return NextResponse.json(
      { error: message, code: error instanceof ActionServiceError ? error.code : 'execution_failed' },
      { status: error instanceof ActionServiceError ? error.status : message === 'Action proposal not found' ? 404 : 409 },
    )
  }
}
