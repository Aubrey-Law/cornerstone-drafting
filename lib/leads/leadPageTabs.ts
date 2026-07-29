export const LEAD_TABS = ['plan', 'tasks', 'timeline', 'intake', 'documents', 'notes'] as const

export type LeadTab = (typeof LEAD_TABS)[number]

export function parseLeadTab(value: string | null | undefined): LeadTab {
  if (value && (LEAD_TABS as readonly string[]).includes(value)) return value as LeadTab
  return 'plan'
}
