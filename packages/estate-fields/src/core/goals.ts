import type { FieldOption } from './types'

/** Estate-planning goal chips on intake; summarized to design-sheet `goals_notes`. */
export const PLANNING_GOAL_OPTIONS: readonly (FieldOption & { desc?: string })[] = [
  { value: 'avoid_probate', label: 'Avoid probate', desc: 'Keep estate settlement private and faster' },
  { value: 'protect_spouse', label: 'Protect my spouse', desc: 'Ensure my spouse is provided for' },
  { value: 'protect_children', label: 'Protect my children', desc: 'Provide for children and protect their inheritance' },
  { value: 'minimize_taxes', label: 'Minimize estate taxes', desc: 'Reduce tax burden on the estate' },
  { value: 'charitable_giving', label: 'Charitable giving', desc: 'Include donations to causes I care about' },
  { value: 'incapacity_planning', label: 'Plan for incapacity', desc: 'Ensure someone can act on my behalf if needed' },
  { value: 'business_succession', label: 'Business succession', desc: 'Plan for business continuity' },
  { value: 'medicaid_planning', label: 'Medicaid planning', desc: 'Protect assets for long-term care' },
]

const GOAL_LABEL_BY_VALUE = new Map(PLANNING_GOAL_OPTIONS.map((o) => [o.value, o.label]))

export function planningGoalLabel(value: string): string {
  return GOAL_LABEL_BY_VALUE.get(value) ?? value.replace(/_/g, ' ')
}

/** Intake `planning_goals[]` → human-readable design-sheet text. */
export function formatPlanningGoalsForDesign(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const labels = raw
    .map((item) => (typeof item === 'string' ? planningGoalLabel(item.trim()) : ''))
    .filter(Boolean)
  return labels.length > 0 ? labels.join(', ') : null
}

const OBJECTIVE_FIELD_LABELS: Record<string, string> = {
  why_choose_firm: 'Why Aubrey Law',
  why_now: 'Why planning now',
  make_things_easy: 'Ease for loved ones',
}

/** Fallback when no goal chips selected — summarize free-text objectives object. */
export function formatPlanningObjectivesForDesign(raw: unknown): string | null {
  // The column is text, so the object often arrives as its JSON serialization.
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const parts = Object.entries(raw as Record<string, unknown>)
    .map(([key, val]) => {
      const text = typeof val === 'string' ? val.trim() : ''
      if (!text) return null
      const label = OBJECTIVE_FIELD_LABELS[key] ?? key.replace(/_/g, ' ')
      return `${label}: ${text}`
    })
    .filter((line): line is string => line !== null)
  return parts.length > 0 ? parts.join('\n') : null
}

export function syncGoalsNotesFromIntake(intake: Record<string, unknown>): string | undefined {
  const fromGoals =
    formatPlanningGoalsForDesign(intake.planning_goals) ??
    formatPlanningGoalsForDesign(intake.goals)
  const fromObjectives = formatPlanningObjectivesForDesign(intake.planning_objectives)
  const merged = fromGoals ?? fromObjectives
  return merged ?? undefined
}

export function syncConcernsFromIntake(intake: Record<string, unknown>): string | undefined {
  const notes =
    (typeof intake.special_notes === 'string' ? intake.special_notes.trim() : '') ||
    (typeof intake.additional_notes === 'string' ? intake.additional_notes.trim() : '')
  return notes || undefined
}

export const GOALS_TEXTAREA_MAX_LENGTH = 2000
