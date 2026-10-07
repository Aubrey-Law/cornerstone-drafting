import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizePracticeArea } from '@/lib/practiceArea'
import {
  ANCHOR_FIELDS,
  DEADLINE_ANCHORS,
  DEADLINE_TARGET_FIELDS,
  computeDeadlines,
  deadlineBatchTag,
  deadlineTaskDescription,
  patchChangesTiming,
  planDeadlineTasks,
  planTargetWrites,
  ruleFromRow,
  type DeadlineRule,
  type DeadlineRulePatch,
  type DeadlineTargetField,
  type ProbateFacts,
} from '@/lib/probateDeadlines/model'

/**
 * Probate deadlines: the half that touches records.
 *
 * `syncProbateDeadlines` runs when a probate matter's anchor dates or tax
 * flags change, and for every probate matter when a rule is confirmed or
 * edited. It writes one task per rule per matter (source `deadline`) and
 * fills the matter's own due-date fields the rule names. Deadline tasks are a
 * record of a period the attorney confirmed, not a decision, so they are
 * written directly rather than proposed through the dial. Every read tolerates
 * a database the migration has not reached yet.
 */

type Admin = ReturnType<typeof getAdminClient>

const RULE_COLUMNS = 'key, title, description, anchor, offset_months, offset_days, applies_when, roll_weekend, target_field, citation, active, confirmed_at, confirmed_by, sort_order'
const FACT_COLUMNS = [
  'client_id', 'practice_area',
  ...Object.values(ANCHOR_FIELDS),
  'pb_federal_estate_tax_required', 'pb_state_estate_tax_required',
  ...DEADLINE_TARGET_FIELDS,
].join(', ')

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  return /does not exist|could not find/i.test(error.message ?? '')
}

export class ProbateDeadlinesUnavailableError extends Error {
  constructor() {
    super('Probate deadlines are not available until the probate deadlines migration has run')
  }
}

export async function listDeadlineRules(admin: Admin = getAdminClient()): Promise<DeadlineRule[] | null> {
  const { data, error } = await admin.from('probate_deadline_rules').select(RULE_COLUMNS).order('sort_order').order('key')
  if (error) {
    if (isMissingRelation(error)) return null
    throw new Error(error.message)
  }
  return ((data ?? []) as Record<string, unknown>[]).map(ruleFromRow)
}

function factsFromRow(row: Record<string, unknown> | null): ProbateFacts {
  const anchors: ProbateFacts['anchors'] = {}
  for (const anchor of DEADLINE_ANCHORS) {
    const value = row?.[ANCHOR_FIELDS[anchor]]
    anchors[anchor] = typeof value === 'string' ? value.slice(0, 10) : null
  }
  return {
    isProbate: normalizePracticeArea(typeof row?.practice_area === 'string' ? row.practice_area : null) === 'Probate',
    anchors,
    federalEstateTaxRequired: typeof row?.pb_federal_estate_tax_required === 'boolean' ? row.pb_federal_estate_tax_required : null,
    stateEstateTaxRequired: typeof row?.pb_state_estate_tax_required === 'boolean' ? row.pb_state_estate_tax_required : null,
  }
}

export interface DeadlineSyncResult {
  matterId: string
  probate: boolean
  created: number
  redated: number
  unchanged: number
  fieldsFilled: string[]
}

/**
 * Brings one matter's deadline tasks and due-date fields in line with its
 * facts and the confirmed rules. Idempotent: running it twice changes nothing
 * the second time.
 */
export async function syncProbateDeadlines(admin: Admin, matterId: string, rules?: DeadlineRule[] | null): Promise<DeadlineSyncResult> {
  const result: DeadlineSyncResult = { matterId, probate: false, created: 0, redated: 0, unchanged: 0, fieldsFilled: [] }
  const confirmedRules = rules === undefined ? await listDeadlineRules(admin) : rules
  if (!confirmedRules || confirmedRules.length === 0) return result

  const detail = await admin.from('matter_details').select(FACT_COLUMNS).eq('client_id', matterId).maybeSingle()
  if (detail.error) {
    if (isMissingRelation(detail.error)) return result
    throw new Error(detail.error.message)
  }
  const row = (detail.data as Record<string, unknown> | null) ?? null
  const facts = factsFromRow(row)
  result.probate = facts.isProbate
  const { deadlines } = computeDeadlines(confirmedRules, facts)
  if (deadlines.length === 0) return result

  const existing = await admin.from('tasks')
    .select('id, batch_tag, status, due_at')
    .eq('matter_id', matterId)
    .eq('source', 'deadline')
  if (existing.error) {
    if (isMissingRelation(existing.error)) return result
    throw new Error(existing.error.message)
  }
  const existingTasks = ((existing.data ?? []) as Array<{ id: string; batch_tag: string | null; status: string; due_at: string | null }>)
    .map(task => ({ id: task.id, batchTag: task.batch_tag, status: task.status, dueDate: task.due_at ? task.due_at.slice(0, 10) : null }))
  const previousDueByRule = new Map<string, string | null>()
  for (const task of existingTasks) {
    const ruleKey = task.batchTag?.startsWith(`deadline:${matterId}:`) ? task.batchTag.slice(`deadline:${matterId}:`.length) : null
    if (ruleKey) previousDueByRule.set(ruleKey, task.dueDate)
  }

  const plan = planDeadlineTasks(matterId, deadlines, existingTasks)
  result.unchanged = plan.unchanged
  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map(deadline => {
      const due = `${deadline.dueDate}T12:00:00.000Z`
      return {
        matter_id: matterId,
        source: 'deadline',
        status: 'open',
        priority: 'high',
        task_type: 'single',
        owner: 'firm',
        title: deadline.title,
        description: deadlineTaskDescription(deadline),
        due_at: due,
        hard_due_at: due,
        batch_tag: deadlineBatchTag(matterId, deadline.ruleKey),
      }
    })
    const inserted = await admin.from('tasks').insert(rows)
    if (inserted.error) throw new Error(inserted.error.message)
    result.created = rows.length
  }
  for (const { taskId, deadline } of plan.updates) {
    const due = `${deadline.dueDate}T12:00:00.000Z`
    const updated = await admin.from('tasks')
      .update({ due_at: due, hard_due_at: due, description: deadlineTaskDescription(deadline) })
      .eq('id', taskId)
      .not('status', 'in', '(done,archived)')
    if (updated.error) throw new Error(updated.error.message)
    result.redated += 1
  }

  const current: Partial<Record<DeadlineTargetField, string | null>> = {}
  for (const field of DEADLINE_TARGET_FIELDS) {
    const value = row?.[field]
    current[field] = typeof value === 'string' ? value.slice(0, 10) : null
  }
  const patch = planTargetWrites(deadlines, current, previousDueByRule)
  if (Object.keys(patch).length > 0) {
    const written = await admin.from('matter_details').update(patch).eq('client_id', matterId)
    if (written.error) throw new Error(written.error.message)
    result.fieldsFilled = Object.keys(patch)
  }
  return result
}

/** Every probate matter, after a rule changes. Errors on one matter do not stop the rest. */
export async function syncAllProbateDeadlines(admin: Admin = getAdminClient()): Promise<{ matters: number; created: number; redated: number; failed: number }> {
  const totals = { matters: 0, created: 0, redated: 0, failed: 0 }
  const rules = await listDeadlineRules(admin)
  if (!rules || !rules.some(rule => rule.confirmedAt && rule.active)) return totals
  const { data, error } = await admin.from('matter_details').select('client_id, practice_area').ilike('practice_area', '%probate%').limit(2000)
  if (error) {
    if (isMissingRelation(error)) return totals
    throw new Error(error.message)
  }
  for (const row of (data ?? []) as Array<{ client_id: string; practice_area: string | null }>) {
    if (normalizePracticeArea(row.practice_area) !== 'Probate') continue
    totals.matters += 1
    try {
      const synced = await syncProbateDeadlines(admin, row.client_id, rules)
      totals.created += synced.created
      totals.redated += synced.redated
    } catch (cause) {
      totals.failed += 1
      console.error('[probate deadlines] sync failed', { matterId: row.client_id, cause: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  return totals
}

/**
 * Applies an edit from Settings. A change to when the deadline falls returns
 * the rule to draft unless the same edit confirms it, so no matter is dated
 * by a period the attorney has not looked at.
 */
export async function updateDeadlineRule(admin: Admin, patch: DeadlineRulePatch, actorId: string): Promise<DeadlineRule> {
  const rules = await listDeadlineRules(admin)
  if (rules === null) throw new ProbateDeadlinesUnavailableError()
  const rule = rules.find(item => item.key === patch.key)
  if (!rule) throw new Error('Rule not found')
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) update.title = patch.title
  if (patch.description !== undefined) update.description = patch.description
  if (patch.citation !== undefined) update.citation = patch.citation
  if (patch.anchor !== undefined) update.anchor = patch.anchor
  if (patch.offsetMonths !== undefined) update.offset_months = patch.offsetMonths
  if (patch.offsetDays !== undefined) update.offset_days = patch.offsetDays
  if (patch.appliesWhen !== undefined) update.applies_when = patch.appliesWhen
  if (patch.rollWeekend !== undefined) update.roll_weekend = patch.rollWeekend
  if (patch.targetField !== undefined) update.target_field = patch.targetField
  if (patch.active !== undefined) update.active = patch.active
  if (patch.confirm === true) {
    update.confirmed_at = new Date().toISOString()
    update.confirmed_by = actorId
  } else if (patch.confirm === false || patchChangesTiming(rule, patch)) {
    update.confirmed_at = null
    update.confirmed_by = null
  }
  const { data, error } = await admin.from('probate_deadline_rules').update(update).eq('key', patch.key).select(RULE_COLUMNS).single()
  if (error) throw new Error(error.message)
  return ruleFromRow(data as Record<string, unknown>)
}
