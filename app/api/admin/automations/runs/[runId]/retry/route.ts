import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { retryAutomationRun } from '@/lib/automations/server'
import { isUuid } from '@/lib/queries/tasks'

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { runId } = await params
  if (!isUuid(runId)) return NextResponse.json({ error: 'Invalid automation run' }, { status: 400 })
  try {
    return NextResponse.json(await retryAutomationRun(runId))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Retry failed' }, { status: 409 })
  }
}
