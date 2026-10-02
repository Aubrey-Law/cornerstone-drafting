import { isUuid } from '@/lib/queries/tasks'
import { setTaskStatus } from '@/lib/tasks/statusMutation'
import { isTaskAssigneeRole } from '@/lib/tasks/assignees'
import { STAGES, type MatterStage } from '@/types/database'
import type { ActionDefinition, ActionExecutionContext } from '@/lib/actions/types'

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Action input must be an object')
  return value as Record<string, unknown>
}

async function requireActorRole(context: ActionExecutionContext, roles: string[], message: string) {
  const { data, error } = await context.admin.from('users').select('role').eq('id', context.actor.id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || !roles.includes(data.role)) throw new Error(message)
}

function taskInput(value: unknown): { taskId: string } {
  const input = objectInput(value)
  if (typeof input.taskId !== 'string' || !isUuid(input.taskId)) throw new Error('A valid task is required')
  return { taskId: input.taskId }
}

function requiredText(input: Record<string, unknown>, key: string, max: number): string {
  const value = typeof input[key] === 'string' ? input[key].trim() : ''
  if (!value || value.length > max) throw new Error(`${key} is required and must be ${max} characters or fewer`)
  return value
}

function optionalUuid(input: Record<string, unknown>, key: string): string | null {
  const value = typeof input[key] === 'string' ? input[key].trim() : ''
  if (!value) return null
  if (!isUuid(value)) throw new Error(`${key} must be a valid identifier`)
  return value
}

function taskCreateInput(value: unknown): Record<string, unknown> {
  const input = objectInput(value)
  const title = requiredText(input, 'title', 300)
  const matterId = optionalUuid(input, 'matter_id')
  const leadId = optionalUuid(input, 'lead_id')
  if ((!matterId && !leadId) || (matterId && leadId)) throw new Error('A task requires exactly one matter or lead')
  // Persist only fields the task service understands. Client-authored text can
  // reach the Assistant tool, so an arbitrary model-supplied key must never be
  // smuggled into a proposal and later treated as executable configuration.
  return {
    title,
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 2_000) || null : null,
    priority: input.priority,
    source: input.source,
    task_type: input.task_type,
    checklist: Array.isArray(input.checklist) ? input.checklist.slice(0, 100) : [],
    matter_id: matterId,
    lead_id: leadId,
    due_at: input.due_at,
    assignee_id: input.assignee_id,
    estimate_minutes: input.estimate_minutes,
    remind_at: input.remind_at,
    recurrence: input.recurrence,
    template_id: input.template_id,
    document_id: input.document_id,
    calendarAddToCalendar: input.calendarAddToCalendar === true,
    calendarStartAt: input.calendarStartAt,
    calendarDurationMinutes: input.calendarDurationMinutes,
    calendarShowAsBusy: input.calendarShowAsBusy !== false,
  }
}

function leadCreateInput(value: unknown) {
  const input = objectInput(value)
  const clientName = requiredText(input, 'client_name', 200)
  const clientEmail = requiredText(input, 'client_email', 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw new Error('A valid client email is required')
  return {
    clientName,
    clientEmail,
    clientPhone: typeof input.client_phone === 'string' ? input.client_phone.trim().slice(0, 50) || null : null,
    practiceArea: typeof input.practice_area === 'string' ? input.practice_area : 'EP',
    feeQuoted: typeof input.fee_quoted === 'number' && Number.isFinite(input.fee_quoted) ? input.fee_quoted : null,
  }
}

function calendarHoldInput(value: unknown) {
  const input = objectInput(value)
  const title = requiredText(input, 'title', 300)
  const start = typeof input.start === 'string' ? input.start : ''
  const end = typeof input.end === 'string' ? input.end : ''
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
    throw new Error('Valid start and end times are required')
  }
  return {
    title,
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
    matterId: optionalUuid(input, 'matter_id'),
    showAsBusy: input.calendarShowAsBusy !== false,
  }
}

function dailyPlanCalendarSyncInput(value: unknown) {
  const input = objectInput(value)
  const planId = optionalUuid(input, 'planId')
  if (!planId) throw new Error('A valid daily plan is required')
  return { planId }
}

function dailyPlanCloseInput(value: unknown) {
  const input = objectInput(value)
  const planId = optionalUuid(input, 'planId')
  if (!planId) throw new Error('A valid daily plan is required')
  return { planId }
}

function dailyPlanCommitInput(value: unknown) {
  const input = objectInput(value)
  const planId = optionalUuid(input, 'planId')
  if (!planId) throw new Error('A valid daily plan is required')
  return { planId }
}

function noteCreateInput(value: unknown) {
  const input = objectInput(value)
  const recordType = input.recordType === 'lead' ? 'lead' : input.recordType === 'matter' ? 'matter' : null
  const recordId = optionalUuid(input, 'recordId')
  const content = requiredText(input, 'content', 20_000)
  if (!recordType || !recordId) throw new Error('A valid lead or matter is required')
  return { recordType, recordId, content, noteType: input.noteType === 'client_comm' ? 'client_comm' as const : 'internal' as const }
}

function smsLinkInput(value: unknown) {
  const input = objectInput(value)
  const phone = requiredText(input, 'phone', 30)
  const leadId = optionalUuid(input, 'leadId')
  const matterId = optionalUuid(input, 'matterId')
  const contactId = optionalUuid(input, 'contactId')
  if ([leadId, matterId, contactId].filter(Boolean).length !== 1) throw new Error('Choose exactly one record for the text thread')
  return { phone, leadId, matterId, contactId }
}

function templateRegisterInput(value: unknown) {
  const input = objectInput(value)
  const uploadId = requiredText(input, 'upload_id', 200)
  const label = requiredText(input, 'label', 200)
  const outputFilename = typeof input.output_filename === 'string' ? input.output_filename.trim().slice(0, 240) || null : null
  return { uploadId, label, outputFilename }
}

function matterStageInput(value: unknown) {
  const input = objectInput(value)
  const matterId = optionalUuid(input, 'matterId')
  const stage = typeof input.stage === 'string' && STAGES.some(candidate => candidate.key === input.stage)
    ? input.stage as MatterStage
    : null
  if (!matterId || !stage) throw new Error('A valid matter and target stage are required')
  return { matterId, stage }
}

function emailDraftInput(value: unknown) {
  const input = objectInput(value)
  const draftId = optionalUuid(input, 'draftId')
  if (!draftId) throw new Error('A valid email draft is required')
  return { draftId }
}

function taskDelegateInput(value: unknown) {
  const input = objectInput(value)
  const taskId = optionalUuid(input, 'taskId')
  const assigneeId = optionalUuid(input, 'assigneeId')
  if (!taskId || !assigneeId) throw new Error('A valid task and assignee are required')
  return { taskId, assigneeId }
}

const AUTOMATION_WORKFLOW_TYPES = [
  'seed_design_sheet',
  'ensure_sla_plan',
  'fire_stage_task',
  'annual_review',
] as const

type AutomationWorkflowType = (typeof AUTOMATION_WORKFLOW_TYPES)[number]

function workflowEnqueueInput(value: unknown) {
  const input = objectInput(value)
  const type = typeof input.type === 'string' && AUTOMATION_WORKFLOW_TYPES.includes(input.type as AutomationWorkflowType)
    ? input.type as AutomationWorkflowType
    : null
  const dedupeKey = requiredText(input, 'dedupeKey', 300)
  const matterId = optionalUuid(input, 'matterId')
  if (!type) throw new Error('An allowlisted workflow type is required')
  if (!matterId) throw new Error('A workflow matter is required')
  const sourcePayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload as Record<string, unknown>
    : {}
  const payload = type === 'ensure_sla_plan'
    ? { practiceArea: typeof sourcePayload.practiceArea === 'string' ? sourcePayload.practiceArea.slice(0, 20) : undefined, retemplate: sourcePayload.retemplate === true }
    : type === 'fire_stage_task'
      ? { stage: requiredText(sourcePayload, 'stage', 80) }
      : {}
  return { type, dedupeKey, matterId, payload }
}

function emailDraftPrepareInput(value: unknown): {
  leadId: string
  purpose: 'intake_reminder' | 'stale_lead_follow_up'
} {
  const input = objectInput(value)
  const leadId = optionalUuid(input, 'leadId')
  const purpose: 'intake_reminder' | 'stale_lead_follow_up' | null = input.purpose === 'intake_reminder' || input.purpose === 'stale_lead_follow_up'
    ? input.purpose
    : null
  if (!leadId || !purpose) throw new Error('A valid lead draft purpose is required')
  return { leadId, purpose }
}

function billingReminderPrepareInput(value: unknown) {
  const input = objectInput(value)
  const cycleKey = requiredText(input, 'cycleKey', 40)
  return { cycleKey }
}

function overrideInput(value: unknown): { workKey: string; state: 'blocked' | 'snoozed'; snoozedUntil: string | null } {
  const input = objectInput(value)
  const workKey = typeof input.workKey === 'string' ? input.workKey.trim() : ''
  const state = input.state === 'snoozed' ? 'snoozed' : input.state === 'blocked' ? 'blocked' : null
  const snoozedUntil = typeof input.snoozedUntil === 'string' && !Number.isNaN(Date.parse(input.snoozedUntil))
    ? new Date(input.snoozedUntil).toISOString() : null
  if (workKey.length < 3 || workKey.length > 300 || !state) throw new Error('A valid work override is required')
  if (state === 'snoozed' && !snoozedUntil) throw new Error('Snoozed work needs a wake time')
  return { workKey, state, snoozedUntil }
}

const definitions: ActionDefinition[] = [
  {
    key: 'task.start',
    risk: 'internal_write',
    validate: taskInput,
    async preview(input, context) {
      const { data, error } = await context.admin.from('tasks').select('id, title, status, updated_at').eq('id', input.taskId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Task not found')
      return {
        display: { action: 'Start task', task: data.title, fromStatus: data.status, toStatus: 'in_progress' },
        auditBefore: { taskId: data.id, status: data.status, updatedAt: data.updated_at },
        auditAfter: { taskId: data.id, status: 'in_progress' },
      }
    },
    async execute(input, context) {
      return setTaskStatus(context.admin, { taskId: input.taskId, status: 'in_progress', actor: context.actor })
    },
    auditResult(result) {
      const value = result as { task?: { id?: string; status?: string }; nextTask?: { id?: string } | null }
      return { taskId: value.task?.id, status: value.task?.status, nextTaskId: value.nextTask?.id ?? null }
    },
  } as ActionDefinition<{ taskId: string }>,
  {
    key: 'task.complete',
    risk: 'internal_write',
    validate: taskInput,
    async preview(input, context) {
      const { data, error } = await context.admin.from('tasks').select('id, title, status, updated_at').eq('id', input.taskId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Task not found')
      return {
        display: { action: 'Complete task', task: data.title, fromStatus: data.status, toStatus: 'done' },
        auditBefore: { taskId: data.id, status: data.status, updatedAt: data.updated_at },
        auditAfter: { taskId: data.id, status: 'done' },
      }
    },
    async execute(input, context) {
      return setTaskStatus(context.admin, { taskId: input.taskId, status: 'done', actor: context.actor })
    },
    auditResult(result) {
      const value = result as { task?: { id?: string; status?: string }; nextTask?: { id?: string } | null }
      return { taskId: value.task?.id, status: value.task?.status, nextTaskId: value.nextTask?.id ?? null }
    },
  } as ActionDefinition<{ taskId: string }>,
  {
    key: 'work.override',
    risk: 'internal_write',
    validate: overrideInput,
    async preview(input, context) {
      const { data, error } = await context.admin.from('work_item_overrides')
        .select('state, snoozed_until, assigned_to, updated_at')
        .eq('user_id', context.actor.id).eq('work_key', input.workKey).maybeSingle()
      if (error) throw new Error(error.message)
      return {
        display: { action: input.state === 'snoozed' ? 'Snooze work' : 'Block work', workKey: input.workKey, state: input.state, snoozedUntil: input.snoozedUntil },
        auditBefore: data ? { workKey: input.workKey, state: data.state, snoozedUntil: data.snoozed_until, updatedAt: data.updated_at } : null,
        auditAfter: { workKey: input.workKey, state: input.state, snoozedUntil: input.snoozedUntil },
      }
    },
    async execute(input, context) {
      const { data, error } = await context.admin.from('work_item_overrides').upsert({
        user_id: context.actor.id,
        work_key: input.workKey,
        state: input.state,
        snoozed_until: input.state === 'snoozed' ? input.snoozedUntil : null,
      }, { onConflict: 'user_id,work_key' }).select('id, work_key, state, snoozed_until').single()
      if (error) throw new Error(error.message)
      return data
    },
  } as ActionDefinition<{ workKey: string; state: 'blocked' | 'snoozed'; snoozedUntil: string | null }>,
  {
    key: 'task.create',
    risk: 'internal_write',
    validate: taskCreateInput,
    async preview(input) {
      return {
        display: {
          action: 'Create task',
          title: input.title,
          recordType: input.matter_id ? 'matter' : 'lead',
          dueAt: input.due_at ?? null,
          priority: input.priority ?? 'normal',
          calendarHold: input.calendarAddToCalendar === true,
        },
        auditBefore: null,
        auditAfter: {
          recordType: input.matter_id ? 'matter' : 'lead',
          recordId: input.matter_id ?? input.lead_id,
          dueAt: input.due_at ?? null,
          priority: input.priority ?? 'normal',
        },
      }
    },
    async execute(input, context) {
      const { acceptTaskProposal } = await import('@/lib/adminChat/calendarTools')
      return acceptTaskProposal(input, context.actor)
    },
    auditResult(result) {
      const task = result as { id?: string; matter_id?: string | null; lead_id?: string | null; status?: string }
      return { taskId: task.id, matterId: task.matter_id ?? null, leadId: task.lead_id ?? null, status: task.status ?? 'open' }
    },
  } as ActionDefinition<Record<string, unknown>>,
  {
    key: 'lead.create',
    risk: 'internal_write',
    validate: leadCreateInput,
    async preview(input) {
      return {
        display: {
          action: 'Create lead',
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          clientPhone: input.clientPhone,
          practiceArea: input.practiceArea,
          feeQuoted: input.feeQuoted,
        },
        auditBefore: null,
        auditAfter: { practiceArea: input.practiceArea },
      }
    },
    async execute(input) {
      const { createLead } = await import('@/lib/leads/createLead')
      return createLead(input)
    },
    auditResult(result) {
      const lead = result as { leadId?: string; practiceArea?: string }
      return { leadId: lead.leadId, practiceArea: lead.practiceArea }
    },
  } as ActionDefinition<ReturnType<typeof leadCreateInput>>,
  {
    key: 'calendar.hold.create',
    risk: 'internal_write',
    validate: calendarHoldInput,
    async preview(input) {
      return {
        display: { action: 'Create internal calendar hold', title: input.title, start: input.startIso, end: input.endIso, showAsBusy: input.showAsBusy },
        auditBefore: null,
        auditAfter: { start: input.startIso, end: input.endIso, matterId: input.matterId, showAsBusy: input.showAsBusy },
      }
    },
    async execute(input, context) {
      const { createCalendarHold } = await import('@/lib/appointments/googleEvents')
      return createCalendarHold({ ...input, idempotencyKey: context.idempotencyKey })
    },
    auditResult(result) {
      const event = result as { eventId?: string }
      return { eventId: event.eventId }
    },
  } as ActionDefinition<ReturnType<typeof calendarHoldInput>>,
  {
    key: 'daily_plan.calendar.sync',
    risk: 'internal_write',
    validate: dailyPlanCalendarSyncInput,
    async preview(input, context) {
      const { fetchDailyPlanById } = await import('@/lib/work/plans')
      const plan = await fetchDailyPlanById(context.actor.id, input.planId)
      if (!plan) throw new Error('Daily plan not found')
      const blockCount = plan.items.filter(item => item.block_start && item.block_end
        && item.lane !== 'later' && item.status !== 'skipped').length
      return {
        display: {
          action: 'Sync committed daily plan to calendar',
          planDate: plan.plan_date,
          generatedAt: plan.generated_at,
          blockCount,
        },
        auditBefore: { planId: plan.id, status: plan.status, generatedAt: plan.generated_at, blockCount },
        auditAfter: { planId: plan.id, planDate: plan.plan_date, blockCount },
      }
    },
    async execute(input, context) {
      const [{ fetchDailyPlanById }, { fetchWorkGraphForUser }, { syncDailyPlanCalendar }] = await Promise.all([
        import('@/lib/work/plans'),
        import('@/lib/work/server'),
        import('@/lib/work/dailyPlanCalendar'),
      ])
      const [plan, graph] = await Promise.all([
        fetchDailyPlanById(context.actor.id, input.planId),
        fetchWorkGraphForUser(context.actor.id),
      ])
      if (!plan) throw new Error('Daily plan not found')
      return syncDailyPlanCalendar({
        admin: context.admin,
        plan,
        workItems: graph.items,
        actorId: context.actor.id,
        actorEmail: context.actor.email ?? null,
      })
    },
    auditResult(result) {
      const value = result as {
        desiredBlocks?: number
        syncedBlocks?: number
        pendingBlocks?: number
        staleBlocks?: number
        created?: number
        moved?: number
        removed?: number
        failures?: unknown[]
      }
      return {
        desiredBlocks: value.desiredBlocks ?? 0,
        syncedBlocks: value.syncedBlocks ?? 0,
        pendingBlocks: value.pendingBlocks ?? 0,
        staleBlocks: value.staleBlocks ?? 0,
        created: value.created ?? 0,
        moved: value.moved ?? 0,
        removed: value.removed ?? 0,
        failureCount: value.failures?.length ?? 0,
      }
    },
  } as ActionDefinition<ReturnType<typeof dailyPlanCalendarSyncInput>>,
  {
    key: 'daily_plan.close',
    risk: 'internal_write',
    validate: dailyPlanCloseInput,
    async preview(input, context) {
      const [{ fetchDailyPlanById }, { fetchWorkGraphForUser }, { buildEndOfDayClosePreview }] = await Promise.all([
        import('@/lib/work/plans'),
        import('@/lib/work/server'),
        import('@/lib/work/endOfDay'),
      ])
      const [plan, graph] = await Promise.all([
        fetchDailyPlanById(context.actor.id, input.planId),
        fetchWorkGraphForUser(context.actor.id),
      ])
      if (!plan) throw new Error('Daily plan not found')
      if (plan.status !== 'committed') throw new Error('Only a committed daily plan can be closed')
      const close = buildEndOfDayClosePreview(plan, graph.items)
      return {
        // The display is part of the stale-preview digest. It intentionally
        // includes only currently visible operational titles, never raw
        // communications or inferred legal facts.
        display: {
          action: 'Close daily plan',
          planDate: plan.plan_date,
          completed: close.completed.map(item => item.workKey),
          blocked: close.blocked.map(item => item.workKey),
          snoozed: close.snoozed.map(item => item.workKey),
          interrupted: close.interrupted.map(item => item.workKey),
          newCritical: close.newCritical.map(item => item.workKey),
          unresolvedRisks: close.unresolvedRisks.map(item => item.workKey),
          tomorrowFirstAction: close.tomorrowFirstAction?.workKey ?? null,
        },
        auditBefore: {
          planId: plan.id,
          status: plan.status,
          itemStatuses: plan.items.map(item => ({ workKey: item.work_key, status: item.status })),
        },
        auditAfter: { planId: plan.id, status: 'closed' },
      }
    },
    async execute(input, context) {
      const { fetchDailyPlanById, updateDailyPlan } = await import('@/lib/work/plans')
      const plan = await fetchDailyPlanById(context.actor.id, input.planId)
      if (!plan) throw new Error('Daily plan not found')
      if (plan.status !== 'committed') throw new Error('Only a committed daily plan can be closed')
      return updateDailyPlan({ userId: context.actor.id, planId: input.planId, status: 'closed' })
    },
    auditResult(result) {
      const plan = result as { id?: string; status?: string; closed_at?: string | null }
      return { planId: plan.id, status: plan.status, closedAt: plan.closed_at ?? null }
    },
  } as ActionDefinition<ReturnType<typeof dailyPlanCloseInput>>,
  {
    key: 'daily_plan.commit',
    risk: 'internal_write',
    validate: dailyPlanCommitInput,
    async preview(input, context) {
      const { fetchDailyPlanById } = await import('@/lib/work/plans')
      const plan = await fetchDailyPlanById(context.actor.id, input.planId)
      if (!plan) throw new Error('Daily plan not found')
      if (plan.status !== 'draft') throw new Error('Only a draft daily plan can be committed')
      const blockCount = plan.items.filter(item => item.block_start && item.block_end
        && item.lane !== 'later' && item.status !== 'skipped').length
      return {
        display: {
          action: 'Commit daily plan',
          planDate: plan.plan_date,
          generatedAt: plan.generated_at,
          plannedMinutes: plan.planned_minutes,
          blockCount,
        },
        auditBefore: { planId: plan.id, status: plan.status, generatedAt: plan.generated_at, blockCount },
        auditAfter: { planId: plan.id, status: 'committed', blockCount },
      }
    },
    async execute(input, context) {
      const { fetchDailyPlanById, updateDailyPlan } = await import('@/lib/work/plans')
      const plan = await fetchDailyPlanById(context.actor.id, input.planId)
      if (!plan) throw new Error('Daily plan not found')
      if (plan.status !== 'draft') throw new Error('Only a draft daily plan can be committed')
      return updateDailyPlan({ userId: context.actor.id, planId: input.planId, status: 'committed' })
    },
    auditResult(result) {
      const plan = result as { id?: string; status?: string; committed_at?: string | null }
      return { planId: plan.id, status: plan.status, committedAt: plan.committed_at ?? null }
    },
  } as ActionDefinition<ReturnType<typeof dailyPlanCommitInput>>,
  {
    key: 'note.create',
    risk: 'internal_write',
    validate: noteCreateInput,
    async preview(input, context) {
      const table = input.recordType === 'lead' ? 'client_intake' : 'matters'
      const { data, error } = await context.admin.from(table).select('id').eq('id', input.recordId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error(`${input.recordType === 'lead' ? 'Lead' : 'Matter'} not found`)
      return {
        display: { action: 'Add internal note', recordType: input.recordType, content: input.content, noteType: input.noteType },
        auditBefore: null,
        auditAfter: { recordType: input.recordType, recordId: input.recordId, noteType: input.noteType },
      }
    },
    async execute(input, context) {
      if (input.recordType === 'lead') {
        const { data, error } = await context.admin.rpc('create_lead_note_with_activity', {
          p_lead_id: input.recordId,
          p_body: input.content,
          p_actor_id: context.actor.id,
          p_note_type: input.noteType,
        })
        if (error) throw new Error(error.message)
        return data
      }
      const { data, error } = await context.admin.from('matter_notes').insert({
        matter_id: input.recordId,
        body: input.content,
        note_type: input.noteType,
        author: context.actor.email ?? null,
      }).select('id, matter_id, note_type').single()
      if (error) throw new Error(error.message)
      return data
    },
    auditResult(result) {
      const note = result as { id?: string; lead_id?: string; matter_id?: string; note_type?: string }
      return { noteId: note.id, recordId: note.lead_id ?? note.matter_id, noteType: note.note_type }
    },
  } as ActionDefinition<ReturnType<typeof noteCreateInput>>,
  {
    key: 'sms.thread.link',
    risk: 'internal_write',
    validate: smsLinkInput,
    async preview(input) {
      return {
        display: { action: 'Link text conversation', phone: input.phone, leadId: input.leadId, matterId: input.matterId, contactId: input.contactId },
        auditBefore: { phoneKey: input.phone },
        auditAfter: { phoneKey: input.phone, leadId: input.leadId, matterId: input.matterId, contactId: input.contactId },
      }
    },
    async execute(input) {
      const { linkSmsThread } = await import('@/lib/queries/smsThreads')
      await linkSmsThread(input.phone, input)
      return { linked: true, ...input }
    },
    auditResult(result) {
      const link = result as ReturnType<typeof smsLinkInput> & { linked: boolean }
      return { linked: link.linked, phoneKey: link.phone, leadId: link.leadId, matterId: link.matterId, contactId: link.contactId }
    },
  } as ActionDefinition<ReturnType<typeof smsLinkInput>>,
  {
    key: 'template.register',
    risk: 'internal_write',
    validate: templateRegisterInput,
    async preview(input, context) {
      await requireActorRole(context, ['admin'], 'Registering a firm template requires an administrator')
      const { getTemplateBuilderUpload } = await import('@/lib/templateBuilder/uploads')
      const upload = await getTemplateBuilderUpload(input.uploadId)
      if (!upload) throw new Error('That template upload no longer exists')
      return {
        display: { action: 'Register firm template', label: input.label, outputFilename: input.outputFilename },
        auditBefore: null,
        auditAfter: { uploadId: input.uploadId, label: input.label },
      }
    },
    async execute(input, context) {
      await requireActorRole(context, ['admin'], 'Registering a firm template requires an administrator')
      const { getTemplateBuilderUpload, loadTemplateBuilderBuffer } = await import('@/lib/templateBuilder/uploads')
      const { createCustomTemplate } = await import('@/lib/documentTemplates/customTemplates')
      const upload = await getTemplateBuilderUpload(input.uploadId)
      if (!upload) throw new Error('That template upload no longer exists')
      return createCustomTemplate({
        label: input.label,
        buffer: await loadTemplateBuilderBuffer(upload),
        actorId: context.actor.id,
        outputFilename: input.outputFilename ?? undefined,
      })
    },
    auditResult(result) {
      const template = result as { id?: string; label?: string; sha256?: string }
      return { templateId: template.id, label: template.label, sha256: template.sha256 }
    },
  } as ActionDefinition<ReturnType<typeof templateRegisterInput>>,
  {
    key: 'matter.stage.transition',
    risk: 'legal_financial',
    validate: matterStageInput,
    async preview(input) {
      const { previewMatterStageTransition } = await import('@/lib/matters/stageMutation')
      const lifecycle = await previewMatterStageTransition(input.matterId, input.stage)
      return {
        display: { action: 'Change matter stage', matterId: input.matterId, ...lifecycle },
        auditBefore: { matterId: input.matterId, stage: lifecycle.fromStage, lifecycleVersion: lifecycle.version },
        auditAfter: { matterId: input.matterId, stage: input.stage, blockerKeys: lifecycle.blockers.map(blocker => blocker.key) },
      }
    },
    async execute(input, context) {
      const { transitionMatterStage } = await import('@/lib/matters/stageMutation')
      return transitionMatterStage(context.admin, { ...input, actor: context.actor })
    },
    auditResult(result) {
      const transition = result as { matterId?: string; previousStage?: string; stage?: string; unchanged?: boolean }
      return { matterId: transition.matterId, previousStage: transition.previousStage, stage: transition.stage, unchanged: transition.unchanged }
    },
  } as ActionDefinition<ReturnType<typeof matterStageInput>>,
  {
    key: 'email.draft.send',
    risk: 'external_write',
    validate: emailDraftInput,
    async preview(input, context) {
      const { emailDraftPreview, loadStoredEmailDraft } = await import('@/lib/email/sendStoredDraft')
      const draft = await loadStoredEmailDraft(context.admin, input.draftId, context.actor.id)
      const display = await emailDraftPreview(draft)
      return {
        display: { action: 'Send email', ...display },
        auditBefore: { draftId: input.draftId, updatedAt: display.draftUpdatedAt },
        auditAfter: { draftId: input.draftId, channel: 'email', contextType: display.contextType, contextId: display.contextId },
      }
    },
    async execute(input, context) {
      const { consumeRateLimit } = await import('@/lib/rateLimit')
      const { loadStoredEmailDraft, sendStoredEmailDraft } = await import('@/lib/email/sendStoredDraft')
      const rateLimit = await consumeRateLimit(
        { bucket: 'admin_email_send', limit: 30, windowSeconds: 600 },
        context.actor.id,
      )
      if (!rateLimit.ok) throw new Error('Too many emails sent — try again shortly')
      const draft = await loadStoredEmailDraft(context.admin, input.draftId, context.actor.id)
      return sendStoredEmailDraft(context.admin, draft, context.actor)
    },
    auditResult(result) {
      const send = result as { sent?: boolean; status?: string; draftId?: string; attachmentCount?: number }
      return { sent: send.sent, status: send.status, draftId: send.draftId, attachmentCount: send.attachmentCount }
    },
  } as ActionDefinition<ReturnType<typeof emailDraftInput>>,
  {
    key: 'task.delegate',
    risk: 'internal_write',
    validate: taskDelegateInput,
    async preview(input, context) {
      const [taskResult, userResult] = await Promise.all([
        context.admin.from('tasks').select('id, title, assignee_id, updated_at').eq('id', input.taskId).maybeSingle(),
        context.admin.from('users').select('id, display_name, email, role').eq('id', input.assigneeId).maybeSingle(),
      ])
      if (taskResult.error) throw new Error(taskResult.error.message)
      if (userResult.error) throw new Error(userResult.error.message)
      if (!taskResult.data) throw new Error('Task not found')
      if (!userResult.data || !isTaskAssigneeRole(userResult.data.role)) throw new Error('Assignee is not authorized staff')
      return {
        display: {
          action: 'Delegate task',
          task: taskResult.data.title,
          assignee: userResult.data.display_name ?? userResult.data.email,
        },
        auditBefore: { taskId: input.taskId, assigneeId: taskResult.data.assignee_id, updatedAt: taskResult.data.updated_at },
        auditAfter: { taskId: input.taskId, assigneeId: input.assigneeId },
      }
    },
    async execute(input, context) {
      const { data: user } = await context.admin.from('users').select('id, role').eq('id', input.assigneeId).maybeSingle()
      if (!user || !isTaskAssigneeRole(user.role)) throw new Error('Assignee is not authorized staff')
      const { data, error } = await context.admin.from('tasks').update({ assignee_id: input.assigneeId })
        .eq('id', input.taskId).select('id, assignee_id, updated_at').single()
      if (error) throw new Error(error.message)
      return data
    },
    auditResult(result) {
      const task = result as { id?: string; assignee_id?: string; updated_at?: string }
      return { taskId: task.id, assigneeId: task.assignee_id, updatedAt: task.updated_at }
    },
  } as ActionDefinition<ReturnType<typeof taskDelegateInput>>,
  {
    key: 'workflow.enqueue',
    risk: 'internal_write',
    validate: workflowEnqueueInput,
    async preview(input, context) {
      const { data, error } = await context.admin.from('matters').select('id, name, stage, updated_at').eq('id', input.matterId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Matter not found')
      return {
        display: { action: 'Queue workflow', workflow: input.type.replaceAll('_', ' '), matter: data.name, stage: data.stage },
        auditBefore: { matterId: data.id, stage: data.stage, updatedAt: data.updated_at },
        auditAfter: { matterId: data.id, workflow: input.type, dedupeKey: input.dedupeKey },
      }
    },
    async execute(input, context) {
      const { enqueueWorkflowJob } = await import('@/lib/workflowJobs')
      return enqueueWorkflowJob({
        type: input.type,
        dedupeKey: input.dedupeKey,
        matterId: input.matterId,
        payload: input.type === 'annual_review' ? { ...input.payload, actorId: context.actor.id } : input.payload,
        actorId: context.actor.id,
      })
    },
    auditResult(result) {
      return { workflowJobId: typeof result === 'string' ? result : null }
    },
  } as ActionDefinition<ReturnType<typeof workflowEnqueueInput>>,
  {
    key: 'email.draft.prepare',
    risk: 'prepare',
    validate: emailDraftPrepareInput,
    async preview(input, context) {
      const { previewAutomationLeadDraft } = await import('@/lib/email/prepareAutomationDraft')
      const draft = await previewAutomationLeadDraft(context.admin, { ...input, actorId: context.actor.id })
      return {
        display: {
          action: draft.existingDraftId ? 'Preserve existing email draft' : 'Prepare email draft',
          recipient: draft.recipient,
          channel: 'email',
          subject: draft.subject,
          content: draft.bodyHtml,
        },
        auditBefore: { leadId: draft.leadId, sourceUpdatedAt: draft.sourceUpdatedAt, existingDraftId: draft.existingDraftId },
        auditAfter: { leadId: draft.leadId, purpose: draft.purpose, channel: 'email' },
      }
    },
    async execute(input, context) {
      const { prepareAutomationLeadDraft, previewAutomationLeadDraft } = await import('@/lib/email/prepareAutomationDraft')
      const draft = await previewAutomationLeadDraft(context.admin, { ...input, actorId: context.actor.id })
      return prepareAutomationLeadDraft(context.admin, draft, context.actor.id)
    },
    auditResult(result) {
      const value = result as { id?: string; prepared?: boolean; preservedExisting?: boolean }
      return { draftId: value.id, prepared: value.prepared, preservedExisting: value.preservedExisting }
    },
  } as ActionDefinition<ReturnType<typeof emailDraftPrepareInput>>,
  {
    key: 'billing.reminders.prepare',
    risk: 'prepare',
    validate: billingReminderPrepareInput,
    async preview(input, context) {
      const today = new Date().toISOString().slice(0, 10)
      const { count, error } = await context.admin.from('invoices').select('id', { count: 'exact', head: true })
        .in('status', ['issued', 'partial']).not('due_date', 'is', null).lt('due_date', today)
      if (error) throw new Error(error.message)
      return {
        display: { action: 'Prepare invoice reminders', overdueInvoiceCount: count ?? 0, cycleKey: input.cycleKey },
        auditBefore: null,
        auditAfter: { cycleKey: input.cycleKey, overdueInvoiceCount: count ?? 0 },
      }
    },
    async execute() {
      const { prepareInvoiceReminderDrafts } = await import('@/lib/billing/prepareInvoiceReminders')
      return prepareInvoiceReminderDrafts()
    },
    auditResult(result) {
      const value = result as { drafted?: number; unavailable?: boolean }
      return { drafted: value.drafted ?? 0, unavailable: value.unavailable === true }
    },
  } as ActionDefinition<ReturnType<typeof billingReminderPrepareInput>>,
]

export function getActionDefinition(key: string): ActionDefinition | null {
  return definitions.find(definition => definition.key === key) ?? null
}

export function listActionDefinitions() {
  return definitions.map(({ key, risk }) => ({ key, risk }))
}
