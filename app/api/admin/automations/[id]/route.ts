import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { updateAutomationControl, updateAutomationRule, validateAutomationRule } from '@/lib/automations/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid automation' }, { status: 400 })
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (body?.controlOnly === true) {
      return NextResponse.json({ rule: await updateAutomationControl(id, body, auth.userId) })
    }
    const input = validateAutomationRule(body)
    return NextResponse.json({ rule: await updateAutomationRule(id, input, auth.userId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update automation' }, { status: 400 })
  }
}
