import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { ActionServiceError } from '@/lib/actions/errors'
import { undoActionExecution } from '@/lib/actions/delegation'

export const dynamic = 'force-dynamic'

/** Reverse a delegated action from the digest or Today. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.user) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid execution' }, { status: 400 })
  try {
    return NextResponse.json(await undoActionExecution(id, auth.user))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Undo failed'
    return NextResponse.json(
      { error: message, code: error instanceof ActionServiceError ? error.code : 'undo_failed' },
      { status: error instanceof ActionServiceError ? error.status : 409 },
    )
  }
}
