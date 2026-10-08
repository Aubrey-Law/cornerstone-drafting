export const ACTIVITY_EVENT_OPTIONS = [
  ['task_created', 'Task added'],
  ['task_completed', 'Task completed'],
  ['draft_generation_started', 'Document generation'],
  ['review_started', 'Document review'],
  ['field_audit_started', 'Field audit'],
  ['proofread_started', 'Proofreading'],
  ['issues_started', 'Issue spotting'],
  ['note', 'Note added'],
  ['stage_changed', 'Stage changed'],
  ['email_sent', 'Email sent'],
  ['sms_sent', 'Text sent'],
] as const

export function activityLabel(value: string): string {
  const known = ACTIVITY_EVENT_OPTIONS.find(([key]) => key === value)
  if (known) return known[1]
  const words = value.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Omit only identical display text; keep every recorded event and its identity. */
export function activityTypeDetail(row: { event_type: string; summary: string }): string | null {
  const label = activityLabel(row.event_type)
  return label.trim().toLowerCase() === row.summary.trim().toLowerCase() ? null : label
}
