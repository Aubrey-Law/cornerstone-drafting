import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchMatterPlan } from '@/lib/slaTasks/queries'
import { summarizeSlaProgress } from '@/lib/slaTasks/schedule'
import { firmDateKey } from '@/lib/firmDate'
import { TASK_STATUSES, type TaskStatus } from '@/lib/tasks/types'

/**
 * GET /api/matters/[matterId]/tasks — the matter's plan: every task on the
 * matter in plan order, with the phase/progress summary the Plan view renders
 * above it.
 *
 * Since the SLA plan and the task queue became one table this is not a separate
 * checklist — it is the same rows the Tasks queue shows, grouped by phase
 * instead of by due date.
 *
 * `?status=open,in_progress` narrows the list. The summary is always computed
 * from the unfiltered set, so "8 of 21 complete" stays true while you filter.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ matterId: string }> },
) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { matterId } = await params
  const statusParam = new URL(req.url).searchParams.get('status')
  const statuses = (statusParam?.split(',') ?? [])
    .map(value => value.trim())
    .filter((value): value is TaskStatus => (TASK_STATUSES as readonly string[]).includes(value))

  const admin = getAdminClient()
  try {
    const allTasks = await fetchMatterPlan(admin, matterId)
    const templateId = allTasks.find(task => task.plan_template_id)?.plan_template_id ?? null

    // The target is a property of the template the matter was generated from,
    // not of the tasks, so it takes a second read to compute "days remaining".
    let targetDays: number | null = null
    if (templateId) {
      const { data } = await admin
        .from('sla_task_templates')
        .select('target_days')
        .eq('id', templateId)
        .maybeSingle()
      targetDays = (data?.target_days as number | undefined) ?? null
    }

    const tasks =
      statuses.length > 0 ? allTasks.filter(task => statuses.includes(task.status)) : allTasks

    // The dates the plan hangs off. Returned alongside the tasks because the
    // tab needs both to explain why something is still unscheduled.
    const { data: matter } = await admin
      .from('matters')
      .select('discovery_call_at, pmps_at, recommendations_sent_at, engagement_signed_at, fit_decision')
      .eq('id', matterId)
      .maybeSingle()

    return NextResponse.json({
      tasks,
      progress: summarizeSlaProgress(allTasks, { targetDays }),
      anchors: {
        discoveryCallAt: firmDateKey(matter?.discovery_call_at ?? null),
        pmpsAt: firmDateKey(matter?.pmps_at ?? null),
        recommendationsSentAt: firmDateKey(matter?.recommendations_sent_at ?? null),
        engagementSignedAt: firmDateKey(matter?.engagement_signed_at ?? null),
        fitDecision: (matter?.fit_decision as string | null) ?? null,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load matter tasks' },
      { status: 500 },
    )
  }
}
