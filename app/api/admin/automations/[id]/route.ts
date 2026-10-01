import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import { validateAutomationRule } from '@/lib/automations/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid automation' }, { status: 400 })
  try {
    const input = validateAutomationRule(await req.json().catch(() => null))
    const { data, error } = await getAdminClient().from('automation_rules').update({
      name: input.name,
      description: input.description ?? null,
      trigger_key: input.triggerKey,
      action_key: input.actionKey,
      conditions: input.conditions ?? {},
      action_config: input.actionConfig ?? {},
      mode: input.mode ?? 'dry_run',
      approval_policy: input.approvalPolicy,
      updated_by: auth.userId,
    }).eq('id', id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    return NextResponse.json({ rule: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update automation' }, { status: 400 })
  }
}
