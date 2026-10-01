import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { dryRunAutomation } from '@/lib/automations/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid automation' }, { status: 400 })
  try {
    return NextResponse.json(await dryRunAutomation(id, auth.userId))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dry run failed'
    return NextResponse.json({ error: message }, { status: message === 'Automation not found' ? 404 : 500 })
  }
}
