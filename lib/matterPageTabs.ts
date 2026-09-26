export const MATTER_TABS = [
  'overview',
  // Both the working queue and the dated plan. They were separate tabs over
  // separate tables until the plan moved into `public.tasks`; a plan task and a
  // queue task are now the same row, so they are two views of one tab.
  'tasks',
  'people',
  'assets',
  'documents',
  'billing',
  'communications',
  'notes',
  'reviews',
  'activity',
] as const

export type MatterTab = (typeof MATTER_TABS)[number]

/** Which face of the Tasks tab to show. */
export const TASK_VIEWS = ['queue', 'plan'] as const

export type TaskView = (typeof TASK_VIEWS)[number]

export function parseTaskView(value: string | null | undefined): TaskView {
  return value && (TASK_VIEWS as readonly string[]).includes(value) ? (value as TaskView) : 'queue'
}

export const COMMUNICATION_CHANNELS = ['all', 'portal', 'sms', 'email'] as const

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number]

const LEGACY_TAB_MAP: Record<string, MatterTab> = {
  contacts: 'people',
  messages: 'communications',
  calls: 'communications',
  // The SLA plan is now the Tasks tab's plan view. `?view=plan` opens it there.
  sla: 'tasks',
}

export function parseMatterTab(value: string | null | undefined): MatterTab {
  if (!value) return 'overview'
  if ((MATTER_TABS as readonly string[]).includes(value)) return value as MatterTab
  return LEGACY_TAB_MAP[value] ?? 'overview'
}

export function parseCommunicationChannel(value: string | null | undefined): CommunicationChannel {
  if (value && (COMMUNICATION_CHANNELS as readonly string[]).includes(value)) {
    return value as CommunicationChannel
  }
  // Old ?channel=portal links still resolve; everything else lands on the
  // merged timeline.
  return 'all'
}
