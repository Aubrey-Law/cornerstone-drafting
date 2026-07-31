export const MATTER_TABS = [
  'overview',
  'tasks',
  'people',
  'assets',
  'documents',
  'billing',
  'communications',
  'notes',
  'activity',
] as const

export type MatterTab = (typeof MATTER_TABS)[number]

export const COMMUNICATION_CHANNELS = ['portal', 'sms', 'email', 'calls'] as const

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number]

const LEGACY_TAB_MAP: Record<string, MatterTab> = {
  contacts: 'people',
  messages: 'communications',
  calls: 'communications',
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
  return 'portal'
}
