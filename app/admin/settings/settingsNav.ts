/**
 * The Settings side menu. Most entries are tabs of `StaffSettingsClient`
 * (`/admin/settings?tab=…`); a few are their own server-rendered routes with
 * their own data fetching. Both kinds sit in the same groups so the menu reads
 * by subject rather than by how a page happens to be implemented.
 */

export type SettingsTab =
  | 'models'
  | 'api-keys'
  | 'connectors'
  | 'google'
  | 'email'
  | 'scheduling'
  | 'lawmatics'
  | 'statular'
  | 'sla'
  | 'delegation'
  | 'annual-review'
  | 'file-closing'
  | 'ai-usage'

export type SettingsNavItem =
  | { kind: 'tab'; tab: SettingsTab; label: string; description: string; adminOnly?: boolean }
  | { kind: 'route'; href: string; label: string }

export interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: 'AI',
    items: [
      {
        kind: 'tab',
        tab: 'models',
        label: 'Models',
        description: 'Default AI provider and the model used for each provider.',
      },
      {
        kind: 'tab',
        tab: 'api-keys',
        label: 'API keys',
        description: 'Your personal provider keys. Requests fall back to the firm key when none is set.',
      },
      {
        kind: 'tab',
        tab: 'connectors',
        label: 'Connectors',
        description: 'MCP servers whose tools the drafting assistant can call.',
      },
      {
        kind: 'tab',
        tab: 'ai-usage',
        label: 'AI usage',
        description: 'Model calls and spend across the firm.',
      },
    ],
  },
  {
    label: 'Communication',
    items: [
      {
        kind: 'tab',
        tab: 'google',
        label: 'Google & Teams',
        description: 'Calendar, Gmail, and Microsoft Teams connections.',
      },
      {
        kind: 'tab',
        tab: 'email',
        label: 'Email',
        description: 'Sender, branding, and which mailbox each email category sends from.',
      },
      {
        kind: 'tab',
        tab: 'scheduling',
        label: 'Scheduling',
        description: 'Appointment types, office hours, blocking calendars, and Calendly links.',
      },
    ],
  },
  {
    label: 'Integrations',
    items: [
      {
        kind: 'tab',
        tab: 'lawmatics',
        label: 'Lawmatics',
        description: 'Lawmatics connection and picklist mapping.',
      },
      {
        kind: 'tab',
        tab: 'statular',
        label: 'Statular',
        description: 'Statular connection and document package mapping.',
      },
      { kind: 'route', href: '/admin/settings/sync', label: 'Sync log' },
    ],
  },
  {
    label: 'Documents',
    items: [
      { kind: 'route', href: '/admin/settings/style-sets', label: 'Style sets' },
      { kind: 'route', href: '/admin/settings/estate-tax', label: 'Estate tax' },
    ],
  },
  {
    label: 'Workflow',
    items: [
      {
        kind: 'tab',
        tab: 'sla',
        label: 'Stage SLA',
        description: 'How long a matter may sit in each pipeline stage before it is flagged.',
      },
      {
        kind: 'tab',
        tab: 'delegation',
        label: 'Delegation',
        description: 'How far the assistant may act on its own, for each kind of action.',
      },
      {
        kind: 'tab',
        tab: 'annual-review',
        label: 'Annual reviews',
        description: 'When clients with a signed plan are invited to a review call, and who is due next.',
      },
      {
        kind: 'tab',
        tab: 'file-closing',
        label: 'File closing',
        description: 'How long closed files are kept, which are due for review, and the closing notice to the client.',
      },
      { kind: 'route', href: '/admin/settings/command-center', label: 'Command center' },
    ],
  },
]

export const DEFAULT_SETTINGS_TAB: SettingsTab = 'models'

/** The menu as the given user sees it — admin-only entries dropped for everyone else. */
export function settingsNavFor(isAdministrator: boolean): SettingsNavGroup[] {
  return SETTINGS_NAV.map(group => ({
    ...group,
    items: group.items.filter(item => item.kind === 'route' || !item.adminOnly || isAdministrator),
  })).filter(group => group.items.length > 0)
}

export function settingsTabItem(tab: SettingsTab) {
  for (const group of SETTINGS_NAV) {
    for (const item of group.items) {
      if (item.kind === 'tab' && item.tab === tab) return item
    }
  }
  return null
}

/**
 * Resolves `?tab=` to a tab the user may open. Unknown values, and admin-only
 * tabs for everyone else, land on the default tab rather than a blank page.
 */
export function resolveSettingsTab(raw: string | null | undefined, isAdministrator: boolean): SettingsTab {
  const item = raw ? settingsTabItem(raw as SettingsTab) : null
  if (!item || item.kind !== 'tab') return DEFAULT_SETTINGS_TAB
  if (item.adminOnly && !isAdministrator) return DEFAULT_SETTINGS_TAB
  return item.tab
}

export function settingsTabHref(tab: SettingsTab): string {
  return `/admin/settings?tab=${tab}`
}
