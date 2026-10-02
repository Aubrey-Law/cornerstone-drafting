import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { DEFAULT_WORK_PREFERENCES, type WorkItem } from '@/lib/work/types'
import { fetchDailyPlan } from '@/lib/work/plans'
import { buildMorningBrief } from '@/lib/work/morningBrief'
import { firmTodayKey } from '@/lib/firmDate'

export const READ_FIRM_TODAY_TOOL_NAME = 'read_firm_today'

const ROW_LIMIT = 20

const READ_FIRM_TODAY_TOOL: Anthropic.Tool = {
  name: READ_FIRM_TODAY_TOOL_NAME,
  description:
    'Read the deterministic, deduplicated work graph behind the Daily Command Center. Returns the one ' +
    'recommended action, must-do work, a communication batch, waiting/blocked work, later work, capacity, ' +
    'overload, and the server-computed reasons and order. Use it for planning and firm-wide status. Read-only.',
  input_schema: { type: 'object', properties: {} },
}

export function firmTodaySystemPromptNote() {
  return `\n\nFIRM TODAY: For "plan my day" or any firm-wide planning or risk question, call \`${READ_FIRM_TODAY_TOOL_NAME}\` first. It returns the same canonical, deterministic order as the Daily Command Center. Preserve its priority bands and item order; do not silently add, remove, or reorder work. Client-, automation-, blocked-, and snoozed-owned items are context, not Focus Mode work. Include the supplied links.`
}

function compact(item: WorkItem) {
  return {
    work_key: item.workKey,
    source: item.sourceType,
    title: item.title,
    record: item.record,
    action: item.actionLabel,
    url: item.href,
    owner: item.owner,
    state: item.state,
    priority_band: item.priorityBand,
    reasons: item.priorityReasons.slice(0, 2).map(reason => reason.label),
    estimate_minutes: item.estimateMinutes,
    due_at: item.dueAt ?? null,
    hard_due_at: item.hardDueAt ?? null,
  }
}

export const firmTodayToolExecutor: AdminChatToolExecutor = {
  tool: READ_FIRM_TODAY_TOOL,
  execute: async (_input, { toolUseId, emit, userId }) => {
    try {
      const now = new Date()
      const date = firmTodayKey(now)
      const [graph, preferences, stored] = await Promise.all([
        fetchWorkGraphForUser(userId),
        userId ? fetchWorkPreferences(userId) : Promise.resolve(DEFAULT_WORK_PREFERENCES),
        userId ? fetchDailyPlan(userId, date) : Promise.resolve(null),
      ])
      const plan = createDailyPlanPreview({
        items: graph.items,
        appointments: graph.appointments,
        preferences,
        date,
        now,
      })
      const brief = buildMorningBrief(plan, stored)
      const result = {
        ok: true,
        generated_at: graph.generatedAt,
        plan_status: brief.planStatus,
        agenda_committed: brief.usesCommittedAgenda,
        now: brief.now ? compact(brief.now) : null,
        must_do: brief.mustDo.slice(0, ROW_LIMIT).map(compact),
        communication_batch: brief.communication.slice(0, ROW_LIMIT).map(compact),
        suggested: brief.suggested.slice(0, ROW_LIMIT).map(compact),
        waiting_or_blocked: plan.waiting.slice(0, ROW_LIMIT).map(compact),
        later: plan.later.slice(0, ROW_LIMIT).map(compact),
        capacity_minutes: plan.capacityMinutes,
        planned_minutes: plan.plannedMinutes,
        overload: plan.overload,
        overload_minutes: plan.overloadMinutes,
        source_errors: graph.sourceErrors,
      }
      emit({
        tool: READ_FIRM_TODAY_TOOL_NAME,
        tool_use_id: toolUseId,
        status: 'done',
        result: {
          must_do_count: brief.mustDo.length,
          communication_count: brief.communication.length,
          waiting_count: plan.waiting.length,
          overload: plan.overload,
          plan_status: brief.planStatus,
        },
      })
      return { content: JSON.stringify(result) }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read the firm\'s day'
      emit({ tool: READ_FIRM_TODAY_TOOL_NAME, tool_use_id: toolUseId, status: 'error', error: message })
      return { content: JSON.stringify({ ok: false, error: message }), isError: true }
    }
  },
}
