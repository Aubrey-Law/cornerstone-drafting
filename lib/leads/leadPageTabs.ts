export const LEAD_TABS = ['intake', 'assets', 'tasks', 'communications', 'documents', 'notes'] as const

export type LeadTab = (typeof LEAD_TABS)[number]

const LEGACY_TAB_MAP: Record<string, LeadTab> = {
  // The SLA plan is now the Tasks tab's plan view.
  sla: 'tasks',
  // The plan of record, the timeline, and the people all read as one intake
  // story now, so the three old tabs land on Intake rather than 404-ing a
  // bookmark into the default.
  plan: 'intake',
  timeline: 'intake',
  people: 'intake',
}

export function parseLeadTab(value: string | null | undefined): LeadTab {
  if (value && (LEAD_TABS as readonly string[]).includes(value)) return value as LeadTab
  return (value ? LEGACY_TAB_MAP[value] : undefined) ?? 'intake'
}
