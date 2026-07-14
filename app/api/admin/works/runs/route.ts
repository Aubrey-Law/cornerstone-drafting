import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { callAnthropic } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { worksDb } from '@/lib/works/data'
import { canLaunchSkill } from '@/lib/works/run'

async function loadMatterSnapshot(matterId: string | null) {
  if (!matterId) return null
  const db = worksDb()
  const { data: matter } = await db.from('matters').select('id, name, stage, status, client_intake_id').eq('id', matterId).maybeSingle()
  if (!matter) return null
  const { data: intake } = matter.client_intake_id
    ? await db.from('client_intake').select('*').eq('id', matter.client_intake_id).maybeSingle()
    : { data: null }
  return { matter, intake }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { skillId?: unknown; matterId?: unknown; input?: unknown }
  if (typeof body.skillId !== 'string') return NextResponse.json({ error: 'skillId is required' }, { status: 400 })
  const db = worksDb()
  const { data: skill, error: skillError } = await db.from('work_skills').select('*').eq('id', body.skillId).maybeSingle()
  if (skillError) return NextResponse.json({ error: skillError.message }, { status: 500 })
  if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  const launch = canLaunchSkill({ is_active: skill.is_active, is_owner: skill.owner_id === auth.userId || skill.is_system })
  if (!launch.ok) return NextResponse.json({ error: 'This skill is inactive' }, { status: 409 })
  const matterId = typeof body.matterId === 'string' ? body.matterId : null
  const snapshot = await loadMatterSnapshot(matterId)
  const requestedInput = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : null
  const inputSnapshot = {
    matterId,
    requestedInput,
    context: snapshot,
    ...(skill.skill_type === 'tabular' ? {
      tabular_review_proposal: {
        title: skill.name,
        columns_config: skill.columns_config ?? [],
        document_ids: Array.isArray(requestedInput?.documentIds) ? requestedInput?.documentIds : [],
      },
    } : {}),
  }
  const { data: run, error: runError } = await db.from('work_runs').insert({
    skill_id: skill.id,
    matter_id: matterId,
    created_by: auth.userId,
    execution_mode: skill.execution_mode,
    status: 'running',
    input_snapshot: inputSnapshot,
    confirmation_state: 'pending',
  }).select('*').single()
  if (runError || !run) return NextResponse.json({ error: runError?.message ?? 'Unable to create run' }, { status: 500 })

  try {
    const model = await resolveFirmModel('assistant')
    const response = await callAnthropic({
      model,
      max_tokens: 4096,
      system: `You are an attorney-support workflow in Cornerstone. Follow the supplied skill instructions exactly. Use only the supplied matter facts. Never invent facts, legal conclusions, dates, names, or documents. Clearly mark missing information as [UNKNOWN]. Produce a draft or analysis for attorney review; do not claim that any matter record was changed.\n\nSKILL.md:\n${skill.skill_md}`,
      messages: [{ role: 'user', content: `Run this skill for the following approved context:\n${JSON.stringify(inputSnapshot, null, 2)}` }],
    }, { route: 'admin/works/run', matterId, userId: auth.userId, contextType: 'matter' })
    const output = response.content.filter(part => part.type === 'text').map(part => (part as { text: string }).text).join('\n').trim()
    const { data: completed, error } = await db.from('work_runs').update({ status: 'awaiting_confirmation', output_text: output, updated_at: new Date().toISOString() }).eq('id', run.id).select('*').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ run: completed }, { status: 201 })
  } catch (error) {
    await db.from('work_runs').update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Workflow failed', updated_at: new Date().toISOString() }).eq('id', run.id)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Workflow failed', runId: run.id }, { status: 502 })
  }
}
