import { isUuid } from '@/lib/queries/tasks'
import { setTaskStatus } from '@/lib/tasks/statusMutation'
import { TASK_STATUSES, type TaskStatus } from '@/lib/tasks/types'
import { getDesignSheetImportFieldMeta, buildDesignSheetImportPreview } from '@/lib/designSheetImport/shared'
import { sanitizeEmailHtml } from '@/lib/email/templateShared'
import { coerceFiduciaryProposals } from '@/lib/designSheet/fiduciaryProposal'
import { DOCUMENT_KINDS as EXECUTION_DOCUMENT_KINDS, type DocumentKind as ExecutionDocumentKind } from '@/lib/execution/requirements'
import { isTaskAssigneeRole } from '@/lib/tasks/assignees'
import { STAGES, stageLabel, type MatterStage } from '@/types/database'
import type { ActionDefinition, ActionExecutionContext } from '@/lib/actions/types'
import { parseTimeEntryInput, formatHours } from '@/lib/timeEntries/model'
import { formatCents, parseDepositPaymentInput } from '@/lib/integrations/mercury/autoApply'

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

function annualReviewSendInput(value: unknown): { outreachId: string } {
  const input = objectInput(value)
  if (typeof input.outreachId !== 'string' || !isUuid(input.outreachId)) throw new Error('A valid invitation identifier is required')
  return { outreachId: input.outreachId }
}

function closingNoticeSendInput(value: unknown): { matterId: string } {
  const input = objectInput(value)
  if (typeof input.matterId !== 'string' || !isUuid(input.matterId)) throw new Error('A valid matter identifier is required')
  return { matterId: input.matterId }
}

function documentRequestCreateInput(value: unknown): {
  matterId: string
  title: string
  description: string | null
  dueOn: string | null
  source: 'staff' | 'meeting_notes' | 'automation'
} {
  const input = objectInput(value)
  const matterId = optionalUuid(input, 'matterId')
  if (!matterId) throw new Error('A document request needs a matter')
  const title = requiredText(input, 'title', 160)
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 1_000) || null : null
  const dueOn = typeof input.dueOn === 'string' && input.dueOn.trim() ? input.dueOn.trim() : null
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new Error('dueOn must be a YYYY-MM-DD date')
  const source = input.source === 'meeting_notes' || input.source === 'automation' ? input.source : 'staff'
  return { matterId, title, description, dueOn, source }
}

function planStatusPublishInput(value: unknown): {
  matterId: string
  stage: MatterStage
  body: string
  facts: Record<string, unknown>
} {
  const input = objectInput(value)
  const matterId = optionalUuid(input, 'matterId')
  if (!matterId) throw new Error('A plan status update needs a matter')
  const stage = input.stage
  if (typeof stage !== 'string' || !STAGES.some(entry => entry.key === stage)) {
    throw new Error('stage must be a known matter stage')
  }
  const body = requiredText(input, 'body', 1_200)
  if (body.length < 40) throw new Error('body must say something: at least 40 characters')
  const facts = input.facts && typeof input.facts === 'object' && !Array.isArray(input.facts)
    ? input.facts as Record<string, unknown>
    : {}
  return { matterId, stage: stage as MatterStage, body, facts }
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

function overrideInput(value: unknown): { workKey: string; state: 'open' | 'blocked' | 'snoozed'; snoozedUntil: string | null } {
  const input = objectInput(value)
  const workKey = typeof input.workKey === 'string' ? input.workKey.trim() : ''
  const state = input.state === 'snoozed'
    ? 'snoozed'
    : input.state === 'blocked'
      ? 'blocked'
      : input.state === 'open'
        ? 'open'
        : null
  const snoozedUntil = typeof input.snoozedUntil === 'string' && !Number.isNaN(Date.parse(input.snoozedUntil))
    ? new Date(input.snoozedUntil).toISOString() : null
  if (workKey.length < 3 || workKey.length > 300 || !state) throw new Error('A valid work override is required')
  if (state === 'snoozed' && !snoozedUntil) throw new Error('Snoozed work needs a wake time')
  return { workKey, state, snoozedUntil }
}

function triageReplyInput(value: unknown): { triageId: string } {
  const input = objectInput(value)
  if (typeof input.triageId !== 'string' || !isUuid(input.triageId)) throw new Error('A valid triage thread identifier is required')
  return { triageId: input.triageId }
}

function reminderSendInput(value: unknown): { reminderId: string } {
  const input = objectInput(value)
  if (typeof input.reminderId !== 'string' || !isUuid(input.reminderId)) throw new Error('A valid reminder identifier is required')
  return { reminderId: input.reminderId }
}

function confirmationSendInput(value: unknown): { appointmentId: string; event: 'booked' | 'rescheduled'; manageToken: string | null } {
  const input = objectInput(value)
  if (typeof input.appointmentId !== 'string' || !isUuid(input.appointmentId)) throw new Error('A valid appointment identifier is required')
  if (input.event !== 'booked' && input.event !== 'rescheduled') throw new Error('event must be booked or rescheduled')
  const manageToken = typeof input.manageToken === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(input.manageToken)
    ? input.manageToken
    : null
  return { appointmentId: input.appointmentId, event: input.event, manageToken }
}

function appointmentBookInput(value: unknown) {
  const input = objectInput(value)
  const typeKey = requiredText(input, 'typeKey', 60)
  const start = typeof input.startIso === 'string' ? Date.parse(input.startIso) : Number.NaN
  if (!Number.isFinite(start) || start <= Date.now()) throw new Error('A future start time is required')
  const email = requiredText(input, 'email', 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid attendee email is required')
  const firstName = requiredText(input, 'firstName', 80)
  const lastName = requiredText(input, 'lastName', 80)
  return {
    typeKey,
    startIso: new Date(start).toISOString(),
    firstName,
    lastName,
    email,
    phone: typeof input.phone === 'string' ? input.phone.trim().slice(0, 40) || null : null,
    notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, 2000) || null : null,
    leadId: optionalUuid(input, 'leadId'),
  }
}

function schedulingLinkInput(value: unknown) {
  const input = objectInput(value)
  const email = requiredText(input, 'email', 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid recipient email is required')
  return {
    email,
    name: typeof input.name === 'string' ? input.name.trim().slice(0, 200) || null : null,
    meetingTypeKey: requiredText(input, 'meetingTypeKey', 60),
    leadId: optionalUuid(input, 'leadId'),
    matterId: optionalUuid(input, 'matterId'),
  }
}

function designSheetProposalInput(value: unknown) {
  const input = objectInput(value)
  const matterId = optionalUuid(input, 'matterId')
  if (!matterId) throw new Error('A valid matter identifier is required')
  const raw = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields)
    ? input.fields as Record<string, unknown>
    : {}
  // Only fields the import knows survive; anything else a model or a person
  // slipped in is dropped before it can reach the sheet.
  const fields: Record<string, unknown> = {}
  for (const [field, fieldValue] of Object.entries(raw).slice(0, 80)) {
    if (getDesignSheetImportFieldMeta(field) && fieldValue !== undefined) fields[field] = fieldValue
  }
  // Appointments are people, not strings, so they ride beside the field map and
  // are matched to the matter's contacts when previewed and again when applied.
  const fiduciaries = coerceFiduciaryProposals(input.fiduciaries)
  if (!Object.keys(fields).length && !fiduciaries.length) {
    throw new Error('At least one known design-sheet field or fiduciary appointment is required')
  }
  return { matterId, fields, fiduciaries }
}

function signingKitInput(value: unknown) {
  const input = objectInput(value)
  const matterId = optionalUuid(input, 'matterId')
  if (!matterId) throw new Error('A valid matter identifier is required')
  let scheduledFor: string | null = null
  if (typeof input.scheduledFor === 'string' && input.scheduledFor.trim()) {
    const parsed = new Date(input.scheduledFor)
    if (Number.isNaN(parsed.getTime())) throw new Error('scheduledFor must be a valid date')
    scheduledFor = parsed.toISOString()
  }
  return { matterId, scheduledFor }
}

function executedRecordInput(value: unknown) {
  const input = objectInput(value)
  const matterId = optionalUuid(input, 'matterId')
  if (!matterId) throw new Error('A valid matter identifier is required')
  const documentId = optionalUuid(input, 'documentId')
  if (!documentId) throw new Error('A valid document identifier is required')
  const kind = typeof input.kind === 'string' && (EXECUTION_DOCUMENT_KINDS as readonly string[]).includes(input.kind)
    ? input.kind as ExecutionDocumentKind
    : null
  if (!kind) throw new Error('A known document kind is required')
  const signedOn = typeof input.signedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.signedOn) && !Number.isNaN(Date.parse(input.signedOn))
    ? input.signedOn
    : null
  if (!signedOn) throw new Error('The signing date is required to record an executed document')
  const witnessCount = typeof input.witnessCount === 'number' && Number.isInteger(input.witnessCount) && input.witnessCount >= 0 && input.witnessCount <= 4
    ? input.witnessCount
    : null
  if (witnessCount === null) throw new Error('witnessCount must be a whole number between 0 and 4')
  const text = (key: string, max: number) => (typeof input[key] === 'string' && (input[key] as string).trim() ? (input[key] as string).trim().slice(0, max) : null)
  const list = (key: string) => Array.isArray(input[key]) ? (input[key] as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim().slice(0, 120)).slice(0, 4) : []
  return {
    matterId,
    documentId,
    kind,
    signedOn,
    signers: list('signers'),
    witnessCount,
    witnessNames: list('witnessNames'),
    notarized: input.notarized === true,
    notaryName: text('notaryName', 120),
    selfProvingAffidavit: input.selfProvingAffidavit === true,
    originalsLocation: text('originalsLocation', 300),
  }
}

function emailComposeInput(value: unknown) {
  const input = objectInput(value)
  const contextType = input.contextType === 'matter' || input.contextType === 'lead' ? input.contextType : null
  if (!contextType) throw new Error('contextType must be matter or lead')
  const contextId = optionalUuid(input, 'contextId')
  if (!contextId) throw new Error('A valid record identifier is required')
  const to = requiredText(input, 'to', 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('A valid recipient email is required')
  const subject = requiredText(input, 'subject', 300)
  const bodyHtml = sanitizeEmailHtml(requiredText(input, 'bodyHtml', 20_000))
  if (!bodyHtml.trim()) throw new Error('The email body is empty after sanitizing')
  return { contextType, contextId, to, subject, bodyHtml }
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
    async undo(input, record, context) {
      // Restore exactly what was recorded before the change; a guess at the
      // "usual" prior status would silently rewrite history.
      const before = typeof record.beforeState?.status === 'string' ? record.beforeState.status : null
      if (!before || !(TASK_STATUSES as readonly string[]).includes(before)) {
        throw new Error('The task\u2019s earlier status was not recorded, so it cannot be restored')
      }
      return setTaskStatus(context.admin, { taskId: input.taskId, status: before as TaskStatus, actor: context.actor })
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
    async undo(input, record, context) {
      // Restore exactly what was recorded before the change; a guess at the
      // "usual" prior status would silently rewrite history.
      const before = typeof record.beforeState?.status === 'string' ? record.beforeState.status : null
      if (!before || !(TASK_STATUSES as readonly string[]).includes(before)) {
        throw new Error('The task\u2019s earlier status was not recorded, so it cannot be restored')
      }
      return setTaskStatus(context.admin, { taskId: input.taskId, status: before as TaskStatus, actor: context.actor })
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
        display: {
          action: input.state === 'open'
            ? 'Resume work'
            : input.state === 'snoozed'
              ? 'Snooze work'
              : 'Block work',
          workKey: input.workKey,
          state: input.state,
          snoozedUntil: input.snoozedUntil,
          hasOverride: Boolean(data),
        },
        auditBefore: data ? { workKey: input.workKey, state: data.state, snoozedUntil: data.snoozed_until, updatedAt: data.updated_at } : null,
        auditAfter: input.state === 'open'
          ? { workKey: input.workKey, state: 'open', overrideCleared: true }
          : { workKey: input.workKey, state: input.state, snoozedUntil: input.snoozedUntil },
      }
    },
    async execute(input, context) {
      // "Open" means remove the personal planning disposition entirely. It
      // must not change the source task, message, or record: the override is
      // only the user's decision about what appears in their Focus Mode.
      if (input.state === 'open') {
        const { error } = await context.admin.from('work_item_overrides').delete()
          .eq('user_id', context.actor.id).eq('work_key', input.workKey)
        if (error) throw new Error(error.message)
        return { workKey: input.workKey, cleared: true }
      }
      const { data, error } = await context.admin.from('work_item_overrides').upsert({
        user_id: context.actor.id,
        work_key: input.workKey,
        state: input.state,
        snoozed_until: input.state === 'snoozed' ? input.snoozedUntil : null,
      }, { onConflict: 'user_id,work_key' }).select('id, work_key, state, snoozed_until').single()
      if (error) throw new Error(error.message)
      return data
    },
    auditResult(result) {
      const value = result as { workKey?: string; cleared?: boolean; state?: string; snoozed_until?: string | null }
      return value.cleared
        ? { workKey: value.workKey, state: 'open', overrideCleared: true }
        : { workKey: value.workKey, state: value.state, snoozedUntil: value.snoozed_until ?? null }
    },
  } as ActionDefinition<{ workKey: string; state: 'open' | 'blocked' | 'snoozed'; snoozedUntil: string | null }>,
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
    async undo(_input, record, context) {
      const taskId = typeof record.afterState?.taskId === 'string' ? record.afterState.taskId : null
      if (!taskId) throw new Error('The created task was not recorded, so it cannot be removed')
      // A task created with a calendar block owns one planning hold; take the
      // hold off the calendar before the task row goes.
      const { data: hold, error: holdError } = await context.admin.from('appointments')
        .select('id, google_event_id')
        .eq('status', 'scheduled')
        .contains('raw', { source: 'task_calendar_hold', taskId })
        .limit(1)
        .maybeSingle()
      if (holdError) throw new Error(holdError.message)
      if (hold) {
        if (hold.google_event_id) {
          const { cancelCalendarEvent } = await import('@/lib/appointments/googleEvents')
          await cancelCalendarEvent(String(hold.google_event_id))
        }
        const { error: cancelError } = await context.admin.from('appointments').update({ status: 'cancelled' }).eq('id', hold.id)
        if (cancelError) throw new Error(cancelError.message)
      }
      const { error } = await context.admin.from('tasks').delete().eq('id', taskId)
      if (error) throw new Error(error.message)
      return { taskId, deleted: true, holdCancelled: Boolean(hold) }
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
    async undo(_input, record) {
      const eventId = typeof record.afterState?.eventId === 'string' ? record.afterState.eventId : null
      if (!eventId) throw new Error('The calendar hold was not recorded, so it cannot be removed')
      const { cancelCalendarEvent } = await import('@/lib/appointments/googleEvents')
      await cancelCalendarEvent(eventId)
      return { eventId, cancelled: true }
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
    async undo(input, record, context) {
      const noteId = typeof record.afterState?.noteId === 'string' ? record.afterState.noteId : null
      if (!noteId) throw new Error('The created note was not recorded, so it cannot be removed')
      if (input.recordType === 'lead') {
        const { error } = await context.admin.rpc('delete_lead_note_with_activity', {
          p_lead_id: input.recordId,
          p_note_id: noteId,
          p_actor_id: context.actor.id,
        })
        if (error) throw new Error(error.message)
        return { noteId, deleted: true }
      }
      const { error } = await context.admin.from('matter_notes').delete().eq('id', noteId).eq('matter_id', input.recordId)
      if (error) throw new Error(error.message)
      return { noteId, deleted: true }
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
    key: 'email.triage.reply.send',
    risk: 'external_write',
    validate: triageReplyInput,
    async preview(input) {
      const { fetchEmailTriageRow } = await import('@/lib/queries/emailTriage')
      const { replySubject } = await import('@/lib/emailTriage/prompt')
      const { isSendableStatus, unsendableReason } = await import('@/lib/emailTriage/sendReply')
      const row = await fetchEmailTriageRow(input.triageId)
      if (!row) throw new Error('Triage thread not found')
      if (!isSendableStatus(row.status)) throw new Error(unsendableReason(row.status))
      if (!row.draft_body?.trim()) throw new Error('There is no drafted reply to send')
      // The exact text that would go out belongs in the preview, so a stale
      // draft fails the digest check; the audit keeps only references.
      return {
        display: {
          action: 'Send triage reply',
          recipient: row.sender_email,
          recipientName: row.sender_name,
          subject: replySubject(row.draft_subject ?? row.subject),
          content: row.draft_body,
          classification: row.classification,
          inReplyTo: row.subject,
        },
        auditBefore: { triageId: row.id, status: row.status, gmailMessageId: row.gmail_message_id },
        auditAfter: {
          triageId: row.id,
          channel: 'email',
          classification: row.classification,
          matterId: row.matter_id,
          leadId: row.client_intake_id,
        },
      }
    },
    async execute(input, context) {
      const { fetchEmailTriageRow } = await import('@/lib/queries/emailTriage')
      const { sendTriageReply } = await import('@/lib/emailTriage/sendReply')
      const row = await fetchEmailTriageRow(input.triageId)
      if (!row) throw new Error('Triage thread not found')
      const outcome = await sendTriageReply({
        admin: context.admin,
        row,
        subject: row.draft_subject ?? '',
        text: row.draft_body ?? '',
        userId: context.actor.id,
      })
      if (!outcome.ok) throw new Error(outcome.refusal)
      return { sent: true, triageId: row.id, messageId: outcome.messageId, label: outcome.label, notices: outcome.notices }
    },
    auditResult(result) {
      const send = result as { sent?: boolean; triageId?: string; label?: string | null; notices?: string[] }
      return { sent: send.sent, triageId: send.triageId, label: send.label ?? null, noticeCount: send.notices?.length ?? 0 }
    },
  } as ActionDefinition<{ triageId: string }>,
  {
    key: 'annual_review.outreach.send',
    risk: 'external_write',
    validate: annualReviewSendInput,
    async preview(input, context) {
      const { fetchAnnualReviewOutreach } = await import('@/lib/annualReview/server')
      const row = await fetchAnnualReviewOutreach(context.admin, input.outreachId)
      if (!row) throw new Error('Annual review invitation not found')
      if (row.status !== 'drafted') throw new Error('This invitation has already been sent or set aside')
      // The words the client would read belong in the preview, so a redrafted
      // invitation fails the digest check; the audit keeps references only.
      return {
        display: {
          action: 'Send annual review invitation',
          recipient: row.toEmail,
          clientName: row.clientName,
          matterName: row.matterName,
          reviewDueOn: row.cycleDueOn,
          bookingUrl: row.bookingUrl,
          subject: row.subject,
          content: row.bodyText,
        },
        auditBefore: { outreachId: row.id, status: row.status, matterId: row.matterId },
        auditAfter: { outreachId: row.id, matterId: row.matterId, channel: 'email', reviewDueOn: row.cycleDueOn },
      }
    },
    async execute(input, context) {
      const { sendAnnualReviewOutreach } = await import('@/lib/annualReview/server')
      return sendAnnualReviewOutreach({ admin: context.admin, outreachId: input.outreachId, actorId: context.actor.id })
    },
    auditResult(result) {
      const send = result as { sent?: boolean; status?: string; outreachId?: string; matterId?: string; messageId?: string | null }
      return { sent: send.sent, status: send.status, outreachId: send.outreachId, matterId: send.matterId, portalMessage: Boolean(send.messageId) }
    },
  } as ActionDefinition<{ outreachId: string }>,
  {
    key: 'matter.closing.notice.send',
    risk: 'external_write',
    validate: closingNoticeSendInput,
    async preview(input, context) {
      const { draftClosingNotice } = await import('@/lib/fileClosing/server')
      const draft = await draftClosingNotice(input.matterId, context.admin)
      if (!draft) throw new Error('This matter has no client email to send the closing notice to')
      // The words the client would read belong in the preview, so a record
      // that changed since fails the digest check; the audit keeps references.
      return {
        display: {
          action: 'Send closing notice',
          recipient: draft.to,
          clientName: draft.clientName,
          matterName: draft.matterName,
          retentionUntil: draft.retentionUntil,
          portalCopy: draft.hasPortalAccount,
          subject: draft.subject,
          content: draft.text,
        },
        auditBefore: { matterId: draft.matterId },
        auditAfter: { matterId: draft.matterId, channel: 'email', retentionUntil: draft.retentionUntil },
      }
    },
    async execute(input, context) {
      const { sendClosingNotice } = await import('@/lib/fileClosing/server')
      return sendClosingNotice({ admin: context.admin, matterId: input.matterId, actorId: context.actor.id })
    },
    auditResult(result) {
      const send = result as { sent?: boolean; status?: string; matterId?: string; messageId?: string | null }
      return { sent: send.sent, status: send.status, matterId: send.matterId, portalMessage: Boolean(send.messageId) }
    },
  } as ActionDefinition<{ matterId: string }>,
  {
    // Record a Mercury deposit as a payment on an invoice. The daily deposit
    // run offers these: an exact match (amount equals the balance and the memo
    // names the invoice) may run up to Act and report; anything less waits on
    // Today. Recording re-reads the deposit and the invoice first.
    key: 'billing.payment.record',
    risk: 'internal_write',
    validate: parseDepositPaymentInput,
    async preview(input, context) {
      const { loadInvoiceForPayment } = await import('@/lib/integrations/mercury/autoApplyServer')
      const invoice = await loadInvoiceForPayment(context.admin, input.invoiceId)
      return {
        display: {
          action: 'Record a payment from a Mercury deposit',
          invoice: invoice.number,
          amount: formatCents(input.amountCents),
          invoiceBalance: formatCents(invoice.balanceCents),
          received: input.receivedAt ? input.receivedAt.slice(0, 10) : null,
          method: input.method === 'check' ? 'Check' : 'Bank transfer',
          match: input.tier === 'exact' ? 'Exact: the memo names this invoice' : 'Likely: not confirmed by the memo',
          basis: input.basis || null,
          note: input.note,
        },
        auditBefore: { invoiceId: invoice.id, status: invoice.status, balanceCents: invoice.balanceCents },
        auditAfter: { invoiceId: invoice.id, amountCents: input.amountCents, reference: input.externalReference },
      }
    },
    async execute(input, context) {
      const { recordDepositPayment } = await import('@/lib/integrations/mercury/autoApplyServer')
      return recordDepositPayment(context.admin, input, context.actor.id)
    },
    auditResult(result) {
      const value = result as { invoiceId?: string; invoiceStatus?: string; amountCents?: number; reference?: string; reused?: boolean }
      return { invoiceId: value.invoiceId, invoiceStatus: value.invoiceStatus, amountCents: value.amountCents, reference: value.reference, reused: value.reused === true }
    },
  } as ActionDefinition<ReturnType<typeof parseDepositPaymentInput>>,
  {
    // Record time on a matter. The daily suggestion pass offers one per matter
    // from the activity log; the dial decides whether it waits on Today or
    // lands straight away. Time is internal, so nothing leaves the firm.
    key: 'billing.time_entry.create',
    risk: 'internal_write',
    validate: parseTimeEntryInput,
    async preview(input, context) {
      const { matterLabel } = await import('@/lib/timeEntries/server')
      const matter = await matterLabel(context.admin, input.matterId)
      return {
        display: {
          action: 'Log time',
          matter,
          date: input.workDate,
          time: formatHours(input.minutes),
          description: input.description,
          source: input.source,
        },
        auditBefore: null,
        auditAfter: { matterId: input.matterId, workDate: input.workDate, minutes: input.minutes, source: input.source },
      }
    },
    async execute(input, context) {
      const { insertTimeEntry } = await import('@/lib/timeEntries/server')
      const { entry, reused } = await insertTimeEntry(context.admin, input, context.actor.id)
      return { ...entry, reused }
    },
    auditResult(result) {
      const value = result as { id?: string; matterId?: string; minutes?: number; reused?: boolean }
      return { entryId: value.id, matterId: value.matterId, minutes: value.minutes, reused: value.reused === true }
    },
    async undo(input, record, context) {
      const entryId = typeof record.afterState?.entryId === 'string' ? record.afterState.entryId : null
      if (!entryId) throw new Error('The time entry was not recorded, so it cannot be removed')
      if (record.afterState?.reused === true) return { entryId, deleted: false, reason: 'the entry already existed' }
      const { deleteTimeEntry } = await import('@/lib/timeEntries/server')
      const deleted = await deleteTimeEntry(context.admin, { matterId: input.matterId, entryId })
      return { entryId, deleted }
    },
  } as ActionDefinition<ReturnType<typeof parseTimeEntryInput>>,
  {
    key: 'billing.reminder.send',
    risk: 'external_write',
    validate: reminderSendInput,
    async preview(input, context) {
      const { fetchInvoiceReminder } = await import('@/lib/billing/sendInvoiceReminder')
      const { reloadInvoice } = await import('@/lib/invoices/issue')
      const reminder = await fetchInvoiceReminder(context.admin, input.reminderId)
      if (!reminder) throw new Error('Reminder not found')
      if (reminder.status !== 'draft') throw new Error('This reminder has already been sent or set aside')
      const invoice = await reloadInvoice(reminder.invoice_id)
      // The message the client would read belongs in the preview; the audit
      // keeps references and the escalation level only.
      return {
        display: {
          action: 'Send invoice reminder',
          recipient: reminder.recipient_email,
          clientName: invoice.clientName,
          invoiceNumber: invoice.number,
          escalation: reminder.escalation_level,
          balanceDueCents: invoice.balance,
          daysPastDue: invoice.daysPastDue,
          subject: reminder.subject,
          content: reminder.body,
        },
        auditBefore: { reminderId: reminder.id, status: reminder.status, invoiceId: invoice.id, lastRemindedAt: invoice.lastRemindedAt },
        auditAfter: {
          reminderId: reminder.id,
          invoiceId: invoice.id,
          channel: 'email',
          escalation: reminder.escalation_level,
          matterId: invoice.matterId,
        },
      }
    },
    async execute(input, context) {
      const { sendInvoiceReminder } = await import('@/lib/billing/sendInvoiceReminder')
      return sendInvoiceReminder({ admin: context.admin, reminderId: input.reminderId, actorId: context.actor.id })
    },
    auditResult(result) {
      const send = result as { sent?: boolean; reminderId?: string; invoiceId?: string; invoiceNumber?: string | null }
      return { sent: send.sent, reminderId: send.reminderId, invoiceId: send.invoiceId, invoiceNumber: send.invoiceNumber ?? null }
    },
  } as ActionDefinition<{ reminderId: string }>,
  {
    key: 'appointment.confirmation.send',
    risk: 'external_write',
    validate: confirmationSendInput,
    async preview(input, context) {
      const { loadConfirmationContext } = await import('@/lib/appointments/confirmationContext')
      const { buildAppointmentConfirmationEmail } = await import('@/lib/appointments/confirmationEmail')
      const ctx = await loadConfirmationContext(context.admin, input.appointmentId)
      const email = buildAppointmentConfirmationEmail({ ...ctx.email, manageToken: input.manageToken, event: input.event })
      return {
        display: {
          action: 'Send appointment confirmation',
          recipient: ctx.appointment.attendee_email,
          cc: ctx.appointment.second_attendee_email,
          attendee: ctx.appointment.attendee_name,
          appointmentType: ctx.type.label,
          when: email.when,
          subject: email.subject,
          content: email.html,
        },
        auditBefore: { appointmentId: ctx.appointment.id, status: ctx.appointment.status, startTime: ctx.appointment.start_time },
        auditAfter: {
          appointmentId: ctx.appointment.id,
          channel: 'email',
          event: input.event,
          leadId: ctx.appointment.linked_lead_id,
          matterId: ctx.appointment.linked_matter_id,
        },
      }
    },
    async execute(input, context) {
      const { loadConfirmationContext } = await import('@/lib/appointments/confirmationContext')
      const { buildAppointmentConfirmationEmail } = await import('@/lib/appointments/confirmationEmail')
      const { sendEmail } = await import('@/lib/email/send')
      const ctx = await loadConfirmationContext(context.admin, input.appointmentId)
      if (ctx.appointment.status !== 'scheduled') throw new Error('This appointment is no longer scheduled, so no confirmation was sent')
      const email = buildAppointmentConfirmationEmail({ ...ctx.email, manageToken: input.manageToken, event: input.event })
      const result = await sendEmail({
        category: 'appointment_confirmation',
        to: ctx.appointment.attendee_email,
        cc: ctx.appointment.second_attendee_email ?? undefined,
        subject: email.subject,
        html: email.html,
        leadId: ctx.appointment.linked_lead_id,
        matterId: ctx.appointment.linked_matter_id,
      })
      if (!result.ok) throw new Error(result.error || 'Confirmation email could not be sent')
      return { sent: result.status === 'sent', status: result.status, appointmentId: ctx.appointment.id, event: input.event }
    },
    auditResult(result) {
      const send = result as { sent?: boolean; status?: string; appointmentId?: string; event?: string }
      return { sent: send.sent, status: send.status, appointmentId: send.appointmentId, event: send.event }
    },
  } as ActionDefinition<ReturnType<typeof confirmationSendInput>>,
  {
    key: 'appointment.book',
    risk: 'external_write',
    validate: appointmentBookInput,
    async preview(input) {
      const { getAppointmentTypeByKey, getSchedulingSettings } = await import('@/lib/appointments/settings')
      const { formatWhen } = await import('@/lib/appointments/emailFormat')
      const [type, settings] = await Promise.all([getAppointmentTypeByKey(input.typeKey), getSchedulingSettings()])
      if (!type || !type.active) throw new Error('Unknown appointment type')
      return {
        display: {
          action: 'Book appointment',
          appointmentType: type.label,
          when: formatWhen(input.startIso, settings.timezone),
          attendee: `${input.firstName} ${input.lastName}`,
          email: input.email,
          phone: input.phone,
          notes: input.notes,
          availabilityNote: 'The slot is checked against the calendar at booking time.',
        },
        auditBefore: null,
        auditAfter: { typeKey: input.typeKey, startIso: input.startIso, leadId: input.leadId },
      }
    },
    async execute(input) {
      const { getAppointmentTypeByKey } = await import('@/lib/appointments/settings')
      const { bookAppointment } = await import('@/lib/appointments/book')
      const type = await getAppointmentTypeByKey(input.typeKey)
      if (!type || !type.active) throw new Error('Unknown appointment type')
      // Booked on the caller's behalf: a public booking creates or links the
      // lead, alerts the firm, and sends the confirmation through the dial.
      const result = await bookAppointment({
        type,
        startIso: input.startIso,
        attendeeFirstName: input.firstName,
        attendeeLastName: input.lastName,
        attendeeEmail: input.email,
        attendeePhone: input.phone,
        notes: input.notes,
        source: 'public',
        bookedByUserId: null,
      })
      return { appointmentId: result.appointmentId, startIso: result.startIso, endIso: result.endIso }
    },
    auditResult(result) {
      const booked = result as { appointmentId?: string; startIso?: string }
      return { appointmentId: booked.appointmentId, startIso: booked.startIso }
    },
  } as ActionDefinition<ReturnType<typeof appointmentBookInput>>,
  {
    key: 'scheduling.link.send',
    risk: 'external_write',
    validate: schedulingLinkInput,
    async preview(input) {
      const { resolveBookingLink, schedulingLinkMessage } = await import('@/lib/bookings/bookingLink')
      const link = await resolveBookingLink({ ...input, channel: 'email' })
      const firstName = input.name?.split(/\s+/)[0] ?? null
      const message = schedulingLinkMessage(firstName, link.label, link.url)
      return {
        display: { action: 'Send scheduling link', recipient: input.email, recipientName: input.name, subject: `Schedule your ${link.label}`, content: message },
        auditBefore: null,
        auditAfter: { channel: 'email', meetingTypeKey: input.meetingTypeKey, leadId: input.leadId, matterId: input.matterId, provider: link.provider },
      }
    },
    async execute(input, context) {
      const { resolveBookingLink, schedulingLinkHtml, schedulingLinkMessage } = await import('@/lib/bookings/bookingLink')
      const { sendEmail } = await import('@/lib/email/send')
      const link = await resolveBookingLink({ ...input, channel: 'email' })
      const firstName = input.name?.split(/\s+/)[0] ?? null
      const message = schedulingLinkMessage(firstName, link.label, link.url)
      const result = await sendEmail({
        category: 'scheduling_link',
        to: input.email,
        subject: `Schedule your ${link.label}`,
        text: message,
        html: schedulingLinkHtml(message, link.url),
        useStoredTemplate: false,
        userId: context.actor.id,
        leadId: input.leadId,
        matterId: input.matterId,
      })
      if (!result.ok) throw new Error(result.error || 'Scheduling link could not be sent')
      return { sent: result.status === 'sent', status: result.status, to: input.email, meetingTypeKey: input.meetingTypeKey }
    },
    auditResult(result) {
      const send = result as { sent?: boolean; status?: string; meetingTypeKey?: string }
      return { sent: send.sent, status: send.status, meetingTypeKey: send.meetingTypeKey }
    },
  } as ActionDefinition<ReturnType<typeof schedulingLinkInput>>,
  {
    key: 'design_sheet.proposal.apply',
    risk: 'legal_financial',
    validate: designSheetProposalInput,
    async preview(input) {
      const { loadFiduciaryResolutionContext, resolveChangingFiduciaryProposals, describeFiduciaryChange } = await import('@/lib/designSheet/fiduciaryProposalServer')
      const context = await loadFiduciaryResolutionContext(input.matterId)
      const sheet = context.sheet as unknown as Record<string, unknown> & { id?: string; updated_at?: string }
      const rows = buildDesignSheetImportPreview({ currentSheet: sheet, proposed: input.fields })
      const appointments = resolveChangingFiduciaryProposals(context, input.fiduciaries)
      if (!rows.length && !appointments.length) throw new Error('None of the proposed decisions would change the design sheet')
      // The current values ride in the preview on purpose: if the sheet moves
      // before this is accepted, the digest no longer matches and the card
      // asks for a fresh look rather than writing over the newer answer.
      return {
        display: {
          action: 'Apply design sheet decisions',
          matterId: input.matterId,
          changes: [
            ...rows.map(row => `${row.section} · ${row.label}: ${row.currentDisplay || '(empty)'} → ${row.proposedDisplay}`),
            ...appointments.map(describeFiduciaryChange),
          ],
        },
        auditBefore: { matterId: input.matterId, sheetId: sheet.id ?? null, updatedAt: sheet.updated_at ?? null },
        auditAfter: { matterId: input.matterId, fields: rows.map(row => row.field), fiduciaries: appointments.map(row => row.id) },
      }
    },
    async execute(input) {
      const { loadFiduciaryResolutionContext, resolveChangingFiduciaryProposals } = await import('@/lib/designSheet/fiduciaryProposalServer')
      const { applyDesignSheetProposal } = await import('@/lib/designSheet/applyProposal')
      // Resolved afresh so a contact added since the proposal is reused, not duplicated.
      const fiduciaries = input.fiduciaries.length
        ? resolveChangingFiduciaryProposals(await loadFiduciaryResolutionContext(input.matterId), input.fiduciaries)
        : []
      const result = await applyDesignSheetProposal({ matterId: input.matterId, fields: input.fields, fiduciaries })
      if (!result.ok) throw new Error(result.error)
      return { sheetId: result.id, updatedAt: result.updatedAt, appliedFields: result.appliedFields, appliedFiduciaries: result.appliedFiduciaries }
    },
    auditResult(result) {
      const applied = result as { sheetId?: string; updatedAt?: string; appliedFields?: number; appliedFiduciaries?: number }
      return { sheetId: applied.sheetId, updatedAt: applied.updatedAt, appliedFields: applied.appliedFields ?? 0, appliedFiduciaries: applied.appliedFiduciaries ?? 0 }
    },
  } as ActionDefinition<ReturnType<typeof designSheetProposalInput>>,
  {
    key: 'signing.record.executed',
    risk: 'legal_financial',
    validate: executedRecordInput,
    async preview(input, context) {
      const { loadCeremony } = await import('@/lib/ceremony/repository')
      const { documentProblems } = await import('@/lib/ceremony/validation')
      const { documentLabel } = await import('@/lib/execution/requirements')
      const { reviewClient } = await import('@/lib/review/staff')
      const [{ data: document }, ceremony] = await Promise.all([
        context.admin.from('matter_documents').select('id, name').eq('id', input.documentId).eq('matter_id', input.matterId).maybeSingle(),
        loadCeremony(reviewClient(), input.matterId).catch(() => null),
      ])
      if (!document) throw new Error('The filed scan could not be found on this matter')
      const existing = ceremony?.documents.find(record => record.documentKind === input.kind) ?? null
      const roles = {
        witnessOneName: ceremony?.witnessOneName ?? input.witnessNames[0] ?? null,
        witnessTwoName: ceremony?.witnessTwoName ?? input.witnessNames[1] ?? null,
        notaryName: ceremony?.notaryName ?? input.notaryName,
        healthCareAgentName: ceremony?.healthCareAgentName ?? null,
      }
      const problems = documentProblems(roles, {
        documentKind: input.kind, executed: true, signedOn: input.signedOn, witnessCount: input.witnessCount, notarized: input.notarized, recordedOn: null,
      })
      return {
        display: {
          action: `Record the ${documentLabel(input.kind)} as executed`,
          matterId: input.matterId,
          scan: String(document.name),
          signedOn: input.signedOn,
          signers: input.signers,
          witnesses: `${input.witnessCount}${input.witnessNames.length ? ` (${input.witnessNames.join(', ')})` : ''}`,
          notarized: input.notarized ? `yes${input.notaryName ? ` (${input.notaryName})` : ''}` : 'no',
          selfProvingAffidavit: input.kind === 'will' ? (input.selfProvingAffidavit ? 'complete' : 'not complete') : undefined,
          originalsLocation: input.originalsLocation ?? undefined,
          currentRecord: existing ? (existing.executed ? `already recorded as executed on ${existing.signedOn ?? 'an unknown date'}` : 'not yet recorded') : 'no signing record yet',
          problems: problems.map(problem => problem.message),
        },
        auditBefore: { matterId: input.matterId, ceremonyId: ceremony?.id ?? null, existingExecuted: existing?.executed ?? false },
        auditAfter: { matterId: input.matterId, kind: input.kind, signedOn: input.signedOn, witnessCount: input.witnessCount, notarized: input.notarized, documentId: input.documentId },
      }
    },
    async execute(input, context) {
      const { loadCeremony, saveCeremony, saveCeremonyDocument } = await import('@/lib/ceremony/repository')
      const { reviewClient } = await import('@/lib/review/staff')
      const client = reviewClient()
      let ceremony = await loadCeremony(client, input.matterId).catch(() => null)
      let ceremonyId = ceremony && ceremony.status !== 'cancelled' ? ceremony.id : null
      if (!ceremonyId) {
        const saved = await saveCeremony(client, {
          matterId: input.matterId,
          ceremonyId: null,
          scheduledFor: `${input.signedOn}T12:00:00.000Z`,
          location: null,
          originalsLocation: input.originalsLocation,
          notaryName: input.notaryName,
          witnessOneName: input.witnessNames[0] ?? null,
          witnessTwoName: input.witnessNames[1] ?? null,
          healthCareAgentName: null,
          status: 'scheduled',
          note: 'Opened when the executed originals were scanned in.',
          userId: context.actor.id,
        })
        if (!saved.ok) throw new Error(saved.message)
        ceremonyId = saved.ceremonyId
        ceremony = null
      } else if (ceremony && (input.originalsLocation || (!ceremony.witnessOneName && input.witnessNames.length) || (!ceremony.notaryName && input.notaryName))) {
        // Fill only what the record does not yet say; the attorney's own entries stand.
        const saved = await saveCeremony(client, {
          matterId: input.matterId,
          ceremonyId,
          scheduledFor: ceremony.scheduledFor,
          location: ceremony.location,
          originalsLocation: input.originalsLocation ?? ceremony.originalsLocation,
          notaryName: ceremony.notaryName ?? input.notaryName,
          witnessOneName: ceremony.witnessOneName ?? input.witnessNames[0] ?? null,
          witnessTwoName: ceremony.witnessTwoName ?? input.witnessNames[1] ?? null,
          healthCareAgentName: ceremony.healthCareAgentName,
          status: ceremony.status,
          note: ceremony.note,
          userId: context.actor.id,
        })
        if (!saved.ok) throw new Error(saved.message)
      }
      const recorded = await saveCeremonyDocument(client, {
        matterId: input.matterId,
        ceremonyId,
        documentKind: input.kind,
        executed: true,
        signedOn: input.signedOn,
        witnessCount: input.witnessCount,
        notarized: input.notarized,
        recordedOn: null,
        recordingReference: null,
        note: input.selfProvingAffidavit ? 'Self-proving affidavit complete (from the scan).' : null,
        executedDocumentId: input.documentId,
      })
      if (!recorded.ok) throw new Error(recorded.message)
      return { ceremonyId, kind: input.kind, signedOn: input.signedOn, documentId: input.documentId }
    },
    auditResult(result) {
      const value = result as { ceremonyId?: string; kind?: string; signedOn?: string; documentId?: string }
      return { ceremonyId: value.ceremonyId, kind: value.kind, signedOn: value.signedOn, documentId: value.documentId }
    },
  } as ActionDefinition<ReturnType<typeof executedRecordInput>>,
  {
    // Ask the client for a document: a row on the matter that the portal
    // lists and the client uploads against. An internal record, so a widened
    // dial may add it unattended; the undo removes a request nothing has
    // arrived against.
    key: 'document_request.create',
    risk: 'internal_write',
    validate: documentRequestCreateInput,
    async preview(input, context) {
      const { listDocumentRequests } = await import('@/lib/documentRequests/repository')
      const { findMatchingRequest } = await import('@/lib/documentRequests/model')
      const existing = findMatchingRequest(await listDocumentRequests(input.matterId, context.admin), input.title)
      return {
        display: {
          action: 'Request a document from the client',
          title: input.title,
          description: input.description,
          dueOn: input.dueOn,
          source: input.source,
          alreadyRequested: existing ? { id: existing.id, status: existing.status } : null,
        },
        auditBefore: null,
        auditAfter: { matterId: input.matterId, title: input.title, dueOn: input.dueOn, source: input.source },
      }
    },
    async execute(input, context) {
      const { createDocumentRequest, listDocumentRequests } = await import('@/lib/documentRequests/repository')
      const { findMatchingRequest } = await import('@/lib/documentRequests/model')
      // A request already open for the same ask is the answer, not a second row.
      const existing = findMatchingRequest(await listDocumentRequests(input.matterId, context.admin), input.title)
      if (existing && existing.status !== 'accepted') return { ...existing, reused: true }
      const created = await createDocumentRequest({
        matterId: input.matterId,
        title: input.title,
        description: input.description,
        dueOn: input.dueOn,
        source: input.source,
        sourceRef: context.idempotencyKey,
        requestedBy: context.actor.id,
      }, context.admin)
      return { ...created, reused: false }
    },
    auditResult(result) {
      const value = result as { id?: string; matterId?: string; status?: string; reused?: boolean }
      return { requestId: value.id, matterId: value.matterId, status: value.status, reused: value.reused === true }
    },
    async undo(_input, record, context) {
      const requestId = typeof record.afterState?.requestId === 'string' ? record.afterState.requestId : null
      if (!requestId) throw new Error('The created request was not recorded, so it cannot be removed')
      if (record.afterState?.reused === true) return { requestId, deleted: false, reason: 'the request already existed' }
      const { deleteUnansweredDocumentRequest } = await import('@/lib/documentRequests/repository')
      const deleted = await deleteUnansweredDocumentRequest(requestId, context.admin)
      if (!deleted) throw new Error('The client has already sent something against this request, so it stays')
      return { requestId, deleted: true }
    },
  } as ActionDefinition<ReturnType<typeof documentRequestCreateInput>>,
  {
    // Tell the client where their plan stands: a plain-language update drafted
    // from the record, posted to their portal conversation and kept on the
    // matter. Client-facing, so it never runs silently; the dial defaults it
    // to Propose and the attorney reads the words before they go.
    key: 'portal.status.publish',
    risk: 'external_write',
    validate: planStatusPublishInput,
    async preview(input) {
      return {
        display: {
          action: 'Post a plan update to the client',
          stage: stageLabel(input.stage),
          body: input.body,
          facts: input.facts,
        },
        auditBefore: null,
        auditAfter: { matterId: input.matterId, stage: input.stage, bodyLength: input.body.length },
      }
    },
    async execute(input, context) {
      const { publishPlanStatus } = await import('@/lib/portal/planStatusServer')
      return publishPlanStatus({
        matterId: input.matterId,
        stage: input.stage,
        body: input.body,
        facts: input.facts,
        actorId: context.actor.id,
        source: context.source === 'automation' ? 'automation' : 'staff',
      }, context.admin)
    },
    auditResult(result) {
      const value = result as { updateId?: string; messageId?: string | null }
      return { updateId: value.updateId, messageId: value.messageId ?? null }
    },
  } as ActionDefinition<ReturnType<typeof planStatusPublishInput>>,
  {
    key: 'signing.kit.prepare',
    risk: 'prepare',
    validate: signingKitInput,
    async preview(input) {
      const { loadSigningKit } = await import('@/lib/signing/loadKit')
      const { summariseSigningKit } = await import('@/lib/signing/kit')
      const loaded = await loadSigningKit(input.matterId)
      if (!loaded) throw new Error('This matter has no drafted documents to sign yet')
      const existing = loaded.ceremony && loaded.ceremony.status === 'scheduled' ? loaded.ceremony : null
      return {
        display: {
          action: existing ? 'Add a task to print the signing-day kit' : 'Open the signing record and add a task to print the kit',
          matterId: input.matterId,
          scheduledFor: input.scheduledFor ?? loaded.appointment?.startIso ?? null,
          needs: summariseSigningKit(loaded.kit),
          documents: loaded.kit.documents.map(document => `${document.order}. ${document.label}`),
          unmatched: loaded.kit.unmatchedDocuments,
        },
        auditBefore: { matterId: input.matterId, ceremonyId: existing?.id ?? null },
        auditAfter: { matterId: input.matterId, kinds: loaded.kinds, taskPlanned: true },
      }
    },
    async execute(input, context) {
      const { loadSigningKit } = await import('@/lib/signing/loadKit')
      const { summariseSigningKit } = await import('@/lib/signing/kit')
      const { saveCeremony, saveCeremonyDocument } = await import('@/lib/ceremony/repository')
      const { reviewClient } = await import('@/lib/review/staff')
      const loaded = await loadSigningKit(input.matterId)
      if (!loaded) throw new Error('This matter has no drafted documents to sign yet')
      const client = reviewClient()
      const scheduledFor = input.scheduledFor ?? loaded.appointment?.startIso ?? null

      // The firm's record of the appointment is opened once; a record already
      // open for this signing is kept exactly as the attorney left it.
      let ceremonyId = loaded.ceremony?.status === 'scheduled' ? loaded.ceremony.id : null
      let createdCeremony = false
      if (!ceremonyId) {
        const saved = await saveCeremony(client, {
          matterId: input.matterId,
          ceremonyId: null,
          scheduledFor,
          location: loaded.appointment?.location ?? null,
          notaryName: null,
          witnessOneName: null,
          witnessTwoName: null,
          healthCareAgentName: null,
          status: 'scheduled',
          note: 'Opened by the signing-day kit when the appointment was booked.',
          userId: context.actor.id,
        })
        if (!saved.ok) throw new Error(saved.message)
        ceremonyId = saved.ceremonyId
        createdCeremony = true
        for (const kind of loaded.kinds) {
          const row = await saveCeremonyDocument(client, {
            matterId: input.matterId, ceremonyId, documentKind: kind, executed: false, signedOn: null,
            witnessCount: 0, notarized: false, recordedOn: null, recordingReference: null, note: null,
          })
          if (!row.ok) throw new Error(row.message)
        }
      }

      const { acceptTaskProposal } = await import('@/lib/adminChat/calendarTools')
      const dueAt = scheduledFor
        ? new Date(Math.max(Date.now() + 60 * 60 * 1000, new Date(scheduledFor).getTime() - 24 * 60 * 60 * 1000)).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const task = await acceptTaskProposal({
        title: `Print the signing-day kit: ${loaded.kit.matterName}`,
        description: `${summariseSigningKit(loaded.kit)}. Tab the originals as the kit lists and bring it to the table.
/admin/matters/${input.matterId}/signing-kit`,
        priority: 'high',
        source: 'automation',
        task_type: 'single',
        matter_id: input.matterId,
        lead_id: null,
        due_at: dueAt,
        estimate_minutes: 20,
      }, context.actor) as { id?: string }
      return { ceremonyId, createdCeremony, taskId: task?.id ?? null, needs: summariseSigningKit(loaded.kit) }
    },
    auditResult(result) {
      const value = result as { ceremonyId?: string; createdCeremony?: boolean; taskId?: string | null; needs?: string }
      return { ceremonyId: value.ceremonyId, createdCeremony: value.createdCeremony, taskId: value.taskId ?? null, needs: value.needs }
    },
    async undo(_input, record, context) {
      const taskId = typeof record.afterState?.taskId === 'string' ? record.afterState.taskId : null
      if (taskId) {
        const { error } = await context.admin.from('tasks').delete().eq('id', taskId)
        if (error) throw new Error(error.message)
      }
      // The record is removed only if this action opened it and nothing has
      // been recorded as signed since; the attorney's own record is never undone.
      const ceremonyId = typeof record.afterState?.ceremonyId === 'string' ? record.afterState.ceremonyId : null
      let removedCeremony = false
      if (ceremonyId && record.afterState?.createdCeremony === true) {
        const { data: executed } = await context.admin.from('ceremony_documents').select('id').eq('ceremony_id', ceremonyId).eq('executed', true).limit(1)
        if (!executed?.length) {
          const { error } = await context.admin.from('signing_ceremonies').delete().eq('id', ceremonyId).eq('status', 'scheduled')
          if (error) throw new Error(error.message)
          removedCeremony = true
        }
      }
      return { taskId, removedTask: Boolean(taskId), removedCeremony }
    },
  } as ActionDefinition<ReturnType<typeof signingKitInput>>,
  {
    key: 'email.draft.compose',
    risk: 'prepare',
    validate: emailComposeInput,
    async preview(input, context) {
      const { data: existing, error } = await context.admin.from('email_drafts')
        .select('id, subject, updated_at')
        .eq('user_id', context.actor.id).eq('context_type', input.contextType).eq('context_id', input.contextId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return {
        display: {
          action: existing ? 'Keep the email draft already in the composer' : 'Prepare email draft',
          recipient: input.to,
          subject: existing ? existing.subject : input.subject,
          content: existing ? '(an existing draft is kept as it stands)' : input.bodyHtml,
        },
        auditBefore: { contextType: input.contextType, contextId: input.contextId, existingDraftId: existing?.id ?? null },
        auditAfter: { contextType: input.contextType, contextId: input.contextId, channel: 'email' },
      }
    },
    async execute(input, context) {
      const { data: existing } = await context.admin.from('email_drafts').select('id')
        .eq('user_id', context.actor.id).eq('context_type', input.contextType).eq('context_id', input.contextId)
        .maybeSingle()
      // Never replace work a person already has open in the composer.
      if (existing) return { id: existing.id, prepared: false, preservedExisting: true }
      const { data, error } = await context.admin.from('email_drafts').insert({
        user_id: context.actor.id,
        context_type: input.contextType,
        context_id: input.contextId,
        to_email: input.to,
        cc: [],
        bcc: [],
        subject: input.subject,
        body_html: input.bodyHtml,
        document_ids: [],
        include_signature: true,
      }).select('id').single()
      if (error) {
        if (error.code === '23505') {
          const { data: raced } = await context.admin.from('email_drafts').select('id')
            .eq('user_id', context.actor.id).eq('context_type', input.contextType).eq('context_id', input.contextId).maybeSingle()
          if (raced) return { id: raced.id, prepared: false, preservedExisting: true }
        }
        throw new Error(error.message)
      }
      return { id: data.id, prepared: true, preservedExisting: false }
    },
    auditResult(result) {
      const value = result as { id?: string; prepared?: boolean; preservedExisting?: boolean }
      return { draftId: value.id, prepared: value.prepared, preservedExisting: value.preservedExisting }
    },
    async undo(_input, record, context) {
      const draftId = typeof record.afterState?.draftId === 'string' ? record.afterState.draftId : null
      if (!draftId) throw new Error('The prepared draft was not recorded, so it cannot be removed')
      // Only a draft this action created is removed; one it preserved was a
      // person's work and stays.
      if (record.afterState?.prepared !== true) return { draftId, removed: false }
      const { error } = await context.admin.from('email_drafts').delete().eq('id', draftId).eq('user_id', context.actor.id)
      if (error) throw new Error(error.message)
      return { draftId, removed: true }
    },
  } as ActionDefinition<ReturnType<typeof emailComposeInput>>,
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
    async undo(input, record, context) {
      const before = record.beforeState?.assigneeId
      if (before !== null && typeof before !== 'string') throw new Error('The earlier assignee was not recorded, so it cannot be restored')
      const { data, error } = await context.admin.from('tasks').update({ assignee_id: before ?? null })
        .eq('id', input.taskId).select('id, assignee_id, updated_at').single()
      if (error) throw new Error(error.message)
      return data
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
        .eq('payer', 'client')
        .in('status', ['issued', 'partial']).not('due_date', 'is', null).lt('due_date', today)
      if (error) throw new Error(error.message)
      return {
        display: { action: 'Prepare invoice reminders', overdueInvoiceCount: count ?? 0, cycleKey: input.cycleKey },
        auditBefore: null,
        auditAfter: { cycleKey: input.cycleKey, overdueInvoiceCount: count ?? 0 },
      }
    },
    async execute(_input, context) {
      const { prepareInvoiceReminderDrafts } = await import('@/lib/billing/prepareInvoiceReminders')
      return prepareInvoiceReminderDrafts({ actorId: context.actor.id })
    },
    auditResult(result) {
      const value = result as { drafted?: number; unavailable?: boolean; sent?: number; observed?: number }
      return { drafted: value.drafted ?? 0, unavailable: value.unavailable === true, sent: value.sent ?? 0, observed: value.observed ?? 0 }
    },
  } as ActionDefinition<ReturnType<typeof billingReminderPrepareInput>>,
]

export function getActionDefinition(key: string): ActionDefinition | null {
  return definitions.find(definition => definition.key === key) ?? null
}

export function listActionDefinitions() {
  return definitions.map(({ key, risk }) => ({ key, risk }))
}
