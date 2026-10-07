/**
 * Probate deadlines: the pure half.
 *
 * A probate matter runs on statutory clocks that start from facts on the
 * record: the date of death, the personal representative's appointment, the
 * letters issuing. Until now each due date was worked out by hand and typed
 * into the matter. Here the attorney authors each clock once, as a rule in
 * Settings, and every probate matter gets its dates and a task from it.
 *
 * Rules are the attorney's, not the software's. The seed rules ship
 * unconfirmed and compute nothing until the attorney checks the period and
 * confirms it; changing a confirmed rule's timing sends it back to draft.
 *
 * Every date here is a `YYYY-MM-DD` key, so month arithmetic cannot drift
 * with the runtime's zone.
 */

export const DEADLINE_ANCHORS = ['date_of_death', 'appointment_date', 'letters_issued_date', 'petition_filed_date'] as const
export type DeadlineAnchor = typeof DEADLINE_ANCHORS[number]

/** Which matter_details column holds each anchor. */
export const ANCHOR_FIELDS: Record<DeadlineAnchor, string> = {
  date_of_death: 'pb_date_of_death',
  appointment_date: 'pb_pr_appointment_date',
  letters_issued_date: 'pb_letters_issued_date',
  petition_filed_date: 'pb_petition_filed_date',
}

export const ANCHOR_LABELS: Record<DeadlineAnchor, string> = {
  date_of_death: 'Date of death',
  appointment_date: 'Appointment of the personal representative',
  letters_issued_date: 'Letters issued',
  petition_filed_date: 'Petition filed',
}

export const DEADLINE_CONDITIONS = ['always', 'federal_estate_tax', 'state_estate_tax'] as const
export type DeadlineCondition = typeof DEADLINE_CONDITIONS[number]

export const CONDITION_LABELS: Record<DeadlineCondition, string> = {
  always: 'Every probate matter',
  federal_estate_tax: 'Only when a federal estate tax return is required',
  state_estate_tax: 'Only when a Massachusetts estate tax return is required',
}

/** Matter fields a rule may keep filled with the date it computes. */
export const DEADLINE_TARGET_FIELDS = [
  'pb_claims_period_end_date',
  'pb_inventory_due_date',
  'pb_m706_due_date',
  'pb_706_due_date',
  'pb_fiduciary_return_due_date',
] as const
export type DeadlineTargetField = typeof DEADLINE_TARGET_FIELDS[number]

export const TARGET_FIELD_LABELS: Record<DeadlineTargetField, string> = {
  pb_claims_period_end_date: 'Creditor claims period ends',
  pb_inventory_due_date: 'Inventory due',
  pb_m706_due_date: 'M-706 due',
  pb_706_due_date: 'Form 706 due',
  pb_fiduciary_return_due_date: 'Fiduciary return due',
}

/** Matter fields whose change can move a deadline. */
export const DEADLINE_INPUT_FIELDS = new Set<string>([
  ...Object.values(ANCHOR_FIELDS),
  'pb_federal_estate_tax_required',
  'pb_state_estate_tax_required',
  'practice_area',
])

export interface DeadlineRule {
  key: string
  title: string
  description: string | null
  anchor: DeadlineAnchor
  offsetMonths: number
  offsetDays: number
  appliesWhen: DeadlineCondition
  /** Move a deadline that lands on a Saturday or Sunday to the Monday after. */
  rollWeekend: boolean
  targetField: DeadlineTargetField | null
  citation: string | null
  active: boolean
  confirmedAt: string | null
  confirmedBy: string | null
  sortOrder: number
}

export interface ProbateFacts {
  isProbate: boolean
  anchors: Partial<Record<DeadlineAnchor, string | null>>
  federalEstateTaxRequired: boolean | null
  stateEstateTaxRequired: boolean | null
}

export interface ComputedDeadline {
  ruleKey: string
  title: string
  dueDate: string
  anchor: DeadlineAnchor
  anchorDate: string
  targetField: DeadlineTargetField | null
  /** "12 months after the date of death (2026-03-04)" */
  basis: string
  citation: string | null
}

export type DeadlineSkipReason = 'not_confirmed' | 'inactive' | 'no_anchor' | 'not_applicable'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_RE.exec(value)
  if (!match) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Adds whole months, clamping to the last day of a shorter month (Jan 31 + 1 → Feb 28). */
export function addMonths(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Saturday and Sunday move to Monday. Court holidays are not modelled; the rule's citation is the check. */
export function rollPastWeekend(dateKey: string): string {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay()
  if (day === 6) return addDays(dateKey, 2)
  if (day === 0) return addDays(dateKey, 1)
  return dateKey
}

function periodWords(rule: Pick<DeadlineRule, 'offsetMonths' | 'offsetDays'>): string {
  const parts: string[] = []
  if (rule.offsetMonths) parts.push(`${rule.offsetMonths} ${Math.abs(rule.offsetMonths) === 1 ? 'month' : 'months'}`)
  if (rule.offsetDays) parts.push(`${rule.offsetDays} ${Math.abs(rule.offsetDays) === 1 ? 'day' : 'days'}`)
  return parts.length ? parts.join(' and ') : 'the same day as'
}

export function ruleSummary(rule: Pick<DeadlineRule, 'offsetMonths' | 'offsetDays' | 'anchor'>): string {
  const period = periodWords(rule)
  const anchor = ANCHOR_LABELS[rule.anchor].toLowerCase()
  return period === 'the same day as' ? `On the ${anchor}` : `${period} after the ${anchor}`
}

export function dueDateFor(rule: Pick<DeadlineRule, 'offsetMonths' | 'offsetDays' | 'rollWeekend'>, anchorDate: string): string {
  const shifted = addDays(addMonths(anchorDate, rule.offsetMonths), rule.offsetDays)
  return rule.rollWeekend ? rollPastWeekend(shifted) : shifted
}

/**
 * The deadlines a matter's facts produce under the confirmed rules. A rule
 * whose anchor date is missing, or whose condition the matter does not meet,
 * produces nothing yet; it will when the fact is recorded.
 */
export function computeDeadlines(rules: readonly DeadlineRule[], facts: ProbateFacts): {
  deadlines: ComputedDeadline[]
  skipped: Array<{ ruleKey: string; reason: DeadlineSkipReason }>
} {
  const deadlines: ComputedDeadline[] = []
  const skipped: Array<{ ruleKey: string; reason: DeadlineSkipReason }> = []
  if (!facts.isProbate) return { deadlines, skipped }
  for (const rule of [...rules].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))) {
    if (!rule.active) { skipped.push({ ruleKey: rule.key, reason: 'inactive' }); continue }
    if (!rule.confirmedAt) { skipped.push({ ruleKey: rule.key, reason: 'not_confirmed' }); continue }
    if (rule.appliesWhen === 'federal_estate_tax' && facts.federalEstateTaxRequired !== true) {
      skipped.push({ ruleKey: rule.key, reason: 'not_applicable' }); continue
    }
    if (rule.appliesWhen === 'state_estate_tax' && facts.stateEstateTaxRequired !== true) {
      skipped.push({ ruleKey: rule.key, reason: 'not_applicable' }); continue
    }
    const anchorDate = facts.anchors[rule.anchor]
    if (!isDateKey(anchorDate)) { skipped.push({ ruleKey: rule.key, reason: 'no_anchor' }); continue }
    deadlines.push({
      ruleKey: rule.key,
      title: rule.title,
      dueDate: dueDateFor(rule, anchorDate),
      anchor: rule.anchor,
      anchorDate,
      targetField: rule.targetField,
      basis: `${ruleSummary(rule)} (${anchorDate})${rule.rollWeekend ? ', moved off a weekend' : ''}`,
      citation: rule.citation,
    })
  }
  return { deadlines, skipped }
}

// ---------------------------------------------------------------------------
// Turning deadlines into tasks and matter dates
// ---------------------------------------------------------------------------

export function deadlineBatchTag(matterId: string, ruleKey: string): string {
  return `deadline:${matterId}:${ruleKey}`
}

export interface ExistingDeadlineTask {
  id: string
  batchTag: string | null
  status: string
  dueDate: string | null
}

export interface DeadlineTaskPlan {
  inserts: ComputedDeadline[]
  /** Open tasks whose rule now computes a different date. */
  updates: Array<{ taskId: string; deadline: ComputedDeadline }>
  unchanged: number
}

const SETTLED_STATUSES = new Set(['done', 'archived'])

/**
 * One task per matter per rule, keyed by batch tag. A finished or archived
 * task is the attorney's record and is never reopened or redated; an open one
 * follows the rule when an anchor date is corrected.
 */
export function planDeadlineTasks(matterId: string, deadlines: readonly ComputedDeadline[], existing: readonly ExistingDeadlineTask[]): DeadlineTaskPlan {
  const byTag = new Map(existing.filter(task => task.batchTag).map(task => [task.batchTag as string, task]))
  const plan: DeadlineTaskPlan = { inserts: [], updates: [], unchanged: 0 }
  for (const deadline of deadlines) {
    const task = byTag.get(deadlineBatchTag(matterId, deadline.ruleKey))
    if (!task) { plan.inserts.push(deadline); continue }
    if (SETTLED_STATUSES.has(task.status) || task.dueDate === deadline.dueDate) { plan.unchanged += 1; continue }
    plan.updates.push({ taskId: task.id, deadline })
  }
  return plan
}

/**
 * Which matter date fields to fill. A field is written when it is empty, or
 * when it still holds the date this rule computed before (so a corrected
 * anchor moves it). A date the attorney typed over is left alone.
 */
export function planTargetWrites(
  deadlines: readonly ComputedDeadline[],
  current: Partial<Record<DeadlineTargetField, string | null>>,
  previousDueByRule: ReadonlyMap<string, string | null>,
): Partial<Record<DeadlineTargetField, string>> {
  const patch: Partial<Record<DeadlineTargetField, string>> = {}
  for (const deadline of deadlines) {
    if (!deadline.targetField) continue
    const now = current[deadline.targetField] ?? null
    const previous = previousDueByRule.get(deadline.ruleKey) ?? null
    if (now === deadline.dueDate) continue
    if (now === null || (previous !== null && now === previous)) patch[deadline.targetField] = deadline.dueDate
  }
  return patch
}

export function deadlineTaskDescription(deadline: ComputedDeadline): string {
  return [
    `Due ${deadline.dueDate}: ${deadline.basis}.`,
    deadline.citation ? `Authority: ${deadline.citation}.` : null,
    'Computed from the confirmed rule in Settings → Workflow → Probate deadlines; correct the matter’s date and this task follows.',
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Validating an edit from Settings
// ---------------------------------------------------------------------------

export interface DeadlineRulePatch {
  key: string
  title?: string
  description?: string | null
  anchor?: DeadlineAnchor
  offsetMonths?: number
  offsetDays?: number
  appliesWhen?: DeadlineCondition
  rollWeekend?: boolean
  targetField?: DeadlineTargetField | null
  citation?: string | null
  active?: boolean
  /** true confirms the rule as it stands after this patch; false returns it to draft. */
  confirm?: boolean
}

/** Fields whose change alters the date a rule computes, and so needs confirming again. */
export const TIMING_FIELDS = ['anchor', 'offsetMonths', 'offsetDays', 'appliesWhen', 'rollWeekend', 'targetField'] as const

export function parseRulePatch(value: unknown): DeadlineRulePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A rule change must be an object')
  const input = value as Record<string, unknown>
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  if (!/^[a-z0-9_]{1,64}$/.test(key)) throw new Error('A valid rule key is required')
  const patch: DeadlineRulePatch = { key }
  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title || title.length > 200) throw new Error('A title is required (200 characters or fewer)')
    patch.title = title
  }
  for (const field of ['description', 'citation'] as const) {
    if (input[field] === undefined) continue
    const text = typeof input[field] === 'string' ? (input[field] as string).trim() : ''
    if (text.length > 1000) throw new Error(`${field} must be 1000 characters or fewer`)
    patch[field] = text || null
  }
  if (input.anchor !== undefined) {
    if (!(DEADLINE_ANCHORS as readonly string[]).includes(input.anchor as string)) throw new Error('Unknown anchor')
    patch.anchor = input.anchor as DeadlineAnchor
  }
  for (const [field, min, max] of [['offsetMonths', 0, 120], ['offsetDays', -366, 3660]] as const) {
    if (input[field] === undefined) continue
    const n = input[field]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Error(`${field} must be a whole number from ${min} to ${max}`)
    patch[field] = n
  }
  if (input.appliesWhen !== undefined) {
    if (!(DEADLINE_CONDITIONS as readonly string[]).includes(input.appliesWhen as string)) throw new Error('Unknown condition')
    patch.appliesWhen = input.appliesWhen as DeadlineCondition
  }
  if (input.targetField !== undefined) {
    if (input.targetField !== null && !(DEADLINE_TARGET_FIELDS as readonly string[]).includes(input.targetField as string)) throw new Error('Unknown matter date field')
    patch.targetField = input.targetField as DeadlineTargetField | null
  }
  for (const field of ['rollWeekend', 'active', 'confirm'] as const) {
    if (input[field] === undefined) continue
    if (typeof input[field] !== 'boolean') throw new Error(`${field} must be true or false`)
    patch[field] = input[field] as boolean
  }
  return patch
}

/** True when the patch changes when the rule's deadline falls. */
export function patchChangesTiming(rule: DeadlineRule, patch: DeadlineRulePatch): boolean {
  return TIMING_FIELDS.some(field => patch[field] !== undefined && patch[field] !== rule[field])
}

export function ruleFromRow(row: Record<string, unknown>): DeadlineRule {
  const anchor = (DEADLINE_ANCHORS as readonly string[]).includes(row.anchor as string) ? row.anchor as DeadlineAnchor : 'date_of_death'
  const appliesWhen = (DEADLINE_CONDITIONS as readonly string[]).includes(row.applies_when as string) ? row.applies_when as DeadlineCondition : 'always'
  const targetField = (DEADLINE_TARGET_FIELDS as readonly string[]).includes(row.target_field as string) ? row.target_field as DeadlineTargetField : null
  return {
    key: String(row.key),
    title: String(row.title ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    anchor,
    offsetMonths: Number(row.offset_months) || 0,
    offsetDays: Number(row.offset_days) || 0,
    appliesWhen,
    rollWeekend: row.roll_weekend === true,
    targetField,
    citation: typeof row.citation === 'string' ? row.citation : null,
    active: row.active !== false,
    confirmedAt: typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
    confirmedBy: typeof row.confirmed_by === 'string' ? row.confirmed_by : null,
    sortOrder: Number(row.sort_order) || 0,
  }
}
