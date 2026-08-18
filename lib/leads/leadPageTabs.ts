// 'plan' here is the opportunity's plan-of-record, not the task plan — the
// dated task plan is the Tasks tab's second view, reached with ?view=plan.
export const LEAD_TABS = ['plan', 'tasks', 'timeline', 'communications', 'intake', 'people', 'assets', 'documents', 'notes'] as const

export type LeadTab = (typeof LEAD_TABS)[number]

const LEGACY_TAB_MAP: Record<string, LeadTab> = {
  // The SLA plan is now the Tasks tab's plan view.
  sla: 'tasks',
}

export function parseLeadTab(value: string | null | undefined): LeadTab {
  if (value && (LEAD_TABS as readonly string[]).includes(value)) return value as LeadTab
  return (value ? LEGACY_TAB_MAP[value] : undefined) ?? 'plan'
}
