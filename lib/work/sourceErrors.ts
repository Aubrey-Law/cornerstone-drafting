const SOURCE_LABEL: Record<string, string> = {
  future_tasks: 'tasks',
  today: 'today',
  calendar: 'calendar',
  email: 'mail',
  sms: 'texts',
  document_reviews: 'document reviews',
  automation_failures: 'automations',
  automation_rule_failures: 'automations',
  approvals: 'approvals',
  overrides: 'saved changes',
}

/** One sentence for a degraded Today or Communications page. */
export function describeSourceErrors(codes: readonly string[]): string | null {
  if (codes.length === 0) return null
  const labels = [...new Set(codes.map(code => SOURCE_LABEL[code] ?? code.replaceAll('_', ' ')))]
  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  return `Could not load ${list}. The rest of this page is still usable.`
}
