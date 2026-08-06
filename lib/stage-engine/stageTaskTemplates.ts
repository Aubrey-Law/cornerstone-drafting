import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * config/stage-task-templates.json, typed.
 *
 * v2 adds two keys and changes nothing else. `gate` decides whether a template
 * or a checklist item applies to this matter at all; `produces_document` marks
 * an item that *is* a document's status — which is why there is no
 * document_checklist column set, and none is coming.
 */

/** The plan-flag keys a gate can name. */
export const PLAN_FLAG_KEYS = [
  'real_estate',
  'credit_shelter',
  'minor_children',
  'pets',
  'diy_signing',
  'legal_plan',
] as const

export type PlanFlagKey = (typeof PLAN_FLAG_KEYS)[number]

/** What a matter's flags and plan type look like to the gates. */
export interface PlanGateContext {
  flags: Partial<Record<PlanFlagKey, boolean>>
  /** A lib/designPlanType.ts DesignPlanType key, or null when undecided. */
  planType: string | null
}

/** A plan-flag key, or the plan types the item applies to. Absent means always. */
export type TemplateGate = PlanFlagKey | string[]

export interface ChecklistItemTemplate {
  text: string
  gate?: TemplateGate
  /** This item is the named document's status. */
  produces_document?: string
}

export interface StageTaskTemplate {
  stage_key: string
  fires_on: string
  track: string
  gate?: TemplateGate
  task: {
    title: string
    type: 'single' | 'checklist'
    owner?: string
    soft_lead_days: number
    /** Null means no hard deadline — the task recurs on its soft date. */
    sla_days: number | null
    priority?: 'high' | 'normal' | 'low'
    description?: string
    checklist?: ChecklistItemTemplate[]
    batch_tag?: string
  }
}

export interface StageTaskTemplatesFile {
  $schema?: string
  scope?: { untasked_engine_keys?: Record<string, string> }
  templates: StageTaskTemplate[]
}

export interface StageChecklistItem {
  text: string
  done: boolean
  gate?: TemplateGate
  produces_document?: string
}

let cached: StageTaskTemplatesFile | null = null

export function loadStageTaskTemplates(): StageTaskTemplatesFile {
  if (cached) return cached
  const raw = readFileSync(resolve(process.cwd(), 'config/stage-task-templates.json'), 'utf-8')
  cached = JSON.parse(raw) as StageTaskTemplatesFile
  return cached
}

/** Test seam — the file is read once per process otherwise. */
export function resetStageTaskTemplateCache(): void {
  cached = null
}

export function findStageTaskTemplate(stageKey: string): StageTaskTemplate | null {
  return loadStageTaskTemplates().templates.find(t => t.stage_key === stageKey) ?? null
}

function isPlanFlagKey(value: unknown): value is PlanFlagKey {
  return typeof value === 'string' && (PLAN_FLAG_KEYS as readonly string[]).includes(value)
}

/**
 * An absent gate always passes. A plan-flag gate passes when the flag is on. A
 * plan-type gate passes when the matter's plan is in the list — and, while the
 * plan is still undecided, it passes too: the design meeting has not happened
 * yet, and hiding the drafting items would read as "no documents needed".
 */
export function gatePasses(gate: TemplateGate | undefined, context: PlanGateContext): boolean {
  if (gate === undefined) return true
  if (Array.isArray(gate)) {
    if (!context.planType) return true
    return gate.includes(context.planType)
  }
  if (isPlanFlagKey(gate)) return Boolean(context.flags[gate])
  // An unknown gate key is a config typo. Show the item rather than silently
  // dropping work from the checklist.
  return true
}

/** The checklist as it should look for this matter right now. */
export function buildStageChecklist(
  template: StageTaskTemplate,
  context: PlanGateContext,
): StageChecklistItem[] {
  return (template.task.checklist ?? [])
    .filter(item => gatePasses(item.gate, context))
    .map(item => ({
      text: item.text,
      done: false,
      ...(item.gate === undefined ? {} : { gate: item.gate }),
      ...(item.produces_document === undefined
        ? {}
        : { produces_document: item.produces_document }),
    }))
}

/**
 * Fold a flag change into a checklist that already exists.
 *
 * Newly-applicable items are appended unchecked. Items whose gate no longer
 * passes come out — but only if nobody has ticked them. A completed item
 * records work that actually happened; the flag being wrong afterwards does
 * not undo the work, and deleting it would erase the only record of it.
 */
export function reconcileStageChecklist(
  template: StageTaskTemplate,
  existing: StageChecklistItem[],
  context: PlanGateContext,
): StageChecklistItem[] {
  const desired = buildStageChecklist(template, context)
  const desiredText = new Set(desired.map(item => item.text))
  const seen = new Set<string>()

  const kept: StageChecklistItem[] = []
  for (const item of existing) {
    if (desiredText.has(item.text) || item.done) {
      kept.push(item)
      seen.add(item.text)
    }
  }

  for (const item of desired) {
    if (!seen.has(item.text)) kept.push(item)
  }

  return kept
}
