// Shared tabs run in the matter page's order, so a lead reads the same once it
// is hired. `communications` is labelled Messages, as on the matter.
export const LEAD_TABS = ['overview', 'intake', 'tasks', 'people', 'assets', 'documents', 'communications', 'notes'] as const

export type LeadTab = (typeof LEAD_TABS)[number]

const LEGACY_TAB_MAP: Record<string, LeadTab> = {
  // The SLA plan is now the Tasks tab's plan view.
  sla: 'tasks',
  // The plan of record and the timeline read as one intake story now, so the
  // old tabs land on Overview rather than 404-ing a bookmark into the default.
  plan: 'overview',
  timeline: 'overview',
}

export function parseLeadTab(value: string | null | undefined): LeadTab {
  if (value && (LEAD_TABS as readonly string[]).includes(value)) return value as LeadTab
  return (value ? LEGACY_TAB_MAP[value] : undefined) ?? 'overview'
}
