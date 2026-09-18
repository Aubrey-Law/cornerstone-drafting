import type Anthropic from '@anthropic-ai/sdk'
import type { AdminChatToolExecutor } from '@/lib/adminChat/engine'
import { fetchTodayData } from '@/lib/queries/today'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import { stageLabel, type MatterStage } from '@/types/database'

export const READ_FIRM_TODAY_TOOL_NAME = 'read_firm_today'

/** Rows per list in the result. Enough to plan a day from; small enough to stay in context. */
const ROW_LIMIT = 15

const READ_FIRM_TODAY_TOOL: Anthropic.Tool = {
  name: READ_FIRM_TODAY_TOOL_NAME,
  description:
    'Read what needs the attorney\'s attention across the whole firm today — the same facts the Today page ' +
    'shows: matters and leads over their stage SLA (worst first, with whose court the ball is in), unread ' +
    'client portal messages, intakes waiting for review or still to be sent, today\'s appointments, overdue ' +
    'and due-today tasks, and money to clear (overdue invoices, unbilled charges). Each row carries the link ' +
    'to act on it. Call it for "plan my day", "what needs attention", "what am I missing", or any ' +
    'firm-wide status question before answering. Read-only.',
  input_schema: { type: 'object', properties: {} },
}

export function firmTodaySystemPromptNote() {
  return `\n\nFIRM TODAY: For "plan my day", "what needs attention", "what's at risk", "what am I missing" or any question about the firm as a whole, call \`${READ_FIRM_TODAY_TOOL_NAME}\` first and plan from what it returns — at-risk matters and leads with days over SLA and whose court the ball is in, unread client messages, the intake queue, today's appointments, overdue tasks, and money to clear. Lead with the items where the ball is in the attorney's court. Include each item's link. Do not answer a firm-wide question from the calendar tools alone.`
}

function dollars(cents: number | null | undefined): number {
  return Math.round(Number(cents ?? 0)) / 100
}

function recordUrl(entity: 'matter' | 'lead', id: string): string {
  return entity === 'lead' ? `/admin/crm/opportunities/${id}` : `/admin/matters/${id}`
}

/**
 * The Today page's data, in a shape the assistant can plan from.
 *
 * "Plan my day" used to answer from the calendar range and due tasks only,
 * while the Today page showed at-risk matters, unread messages and the intake
 * queue. One read of the same query behind that page closes the gap.
 */
export const firmTodayToolExecutor: AdminChatToolExecutor = {
  tool: READ_FIRM_TODAY_TOOL,
  execute: async (_input, { toolUseId, emit }) => {
    try {
      const today = await fetchTodayData({ includeCalendar: false })

      const atRisk = today.atRisk.slice(0, ROW_LIMIT).map(row => ({
        type: row.entity,
        id: row.id,
        client_name: row.client_name,
        stage: engineStageLabel(row.current_stage),
        health: row.health,
        ball_in: row.owner,
        days_in_stage: row.days_in_stage,
        days_over_sla: row.days_over_sla,
        url: recordUrl(row.entity, row.id),
      }))
      const unread = today.unreadThreads.slice(0, ROW_LIMIT).map(thread => ({
        matter_id: thread.matter_id,
        client_name: thread.client_name,
        unread_count: thread.unread_count,
        latest_at: thread.latest_at,
        url: `/admin/matters/${thread.matter_id}?tab=communications`,
      }))
      const intakeRows = (rows: typeof today.intakeReview, urlFor: (matterId: string) => string) =>
        rows.slice(0, ROW_LIMIT).map(matter => ({
          matter_id: matter.matter_id,
          client_name: matter.client_name ?? matter.matter_name ?? null,
          stage: stageLabel(matter.stage as MatterStage),
          url: urlFor(matter.matter_id),
        }))
      const tasks = (rows: typeof today.overdueTasks) =>
        rows.slice(0, ROW_LIMIT).map(task => ({
          title: task.title,
          due_at: task.due_at ?? task.hard_due_at ?? task.soft_due_at ?? null,
          priority: task.priority,
          matter_id: task.matter_id,
          lead_id: task.lead_id,
          url: task.matter_id ? `/admin/matters/${task.matter_id}?tab=tasks` : '/admin/tasks',
        }))

      const result = {
        ok: true,
        active_matter_count: today.activeMatterCount,
        needs_you_count: today.needsYou,
        over_sla_count: today.overdueCount,
        at_risk: atRisk,
        at_risk_total: today.atRisk.length,
        unread_client_messages: unread,
        intakes_to_review: intakeRows(today.intakeReview, matterId => `/admin/drafting/${matterId}`),
        intakes_to_send: intakeRows(today.intakeToSend, matterId => `/admin/matters/${matterId}`),
        appointments_today: today.appointmentsToday.slice(0, ROW_LIMIT).map(appointment => ({
          client_name: appointment.client_name,
          starts_at: appointment.next_appointment,
          type: appointment.next_appointment_type,
          all_day: appointment.is_all_day,
          url: appointment.href,
        })),
        ...(today.appointmentsError ? { appointments_error: true } : {}),
        overdue_tasks: tasks(today.overdueTasks),
        overdue_task_total: today.overdueTasks.length,
        tasks_due_today: tasks(today.tasksDueToday),
        billing: {
          ...(today.billing.error ? { error: today.billing.error } : {}),
          unbilled_count: today.billing.unbilledCount,
          unbilled_dollars: dollars(today.billing.unbilledCents),
          overdue_invoice_count: today.billing.overdueInvoices.length,
          overdue_dollars: dollars(today.billing.overdueCents),
          overdue_invoices: today.billing.overdueInvoices.slice(0, ROW_LIMIT).map(invoice => ({
            number: invoice.number,
            client_name: invoice.clientName,
            balance_dollars: dollars(invoice.balanceCents),
            days_past_due: invoice.daysPastDue,
            url: `/admin/matters/${invoice.matterId}?tab=billing`,
          })),
        },
      }

      emit({
        tool: READ_FIRM_TODAY_TOOL_NAME,
        tool_use_id: toolUseId,
        status: 'done',
        result: {
          at_risk_count: today.atRisk.length,
          unread_count: today.unreadThreads.length,
          overdue_task_count: today.overdueTasks.length,
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
