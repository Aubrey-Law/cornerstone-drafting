export type MeetingTypeKey =
  | 'discovery_call'
  | 'pmps'
  | 'draft_review'
  | 'client_call'
  | 'signing_appointment'

export interface SchedulingMeetingType {
  key: MeetingTypeKey
  label: string
  portalLabel?: string
  description: string
  url: string
  eventSlug: string
}

const MEETING_TYPE_DEFS = {
  discovery_call: {
    key: 'discovery_call',
    label: 'Discovery Call',
    description: 'Book a first discovery call with Aubrey Law.',
    url: 'https://cal.com/aubreylaw/discoverycall',
    eventSlug: 'discoverycall',
    envVar: 'NEXT_PUBLIC_CALCOM_DISCOVERY_CALL_URL',
  },
  pmps: {
    key: 'pmps',
    label: 'Peace of Mind Planning Session',
    portalLabel: 'Design Meeting',
    description: 'Schedule the main estate planning session.',
    url: 'https://cal.com/aubreylaw/pmps',
    eventSlug: 'pmps',
    envVar: 'NEXT_PUBLIC_CALCOM_PMPS_URL',
  },
  draft_review: {
    key: 'draft_review',
    label: 'Estate Plan Draft Review',
    description: 'Review draft documents and planning decisions.',
    url: 'https://cal.com/aubreylaw/draft-review',
    eventSlug: 'draft-review',
    envVar: 'NEXT_PUBLIC_CALCOM_DRAFT_REVIEW_URL',
  },
  client_call: {
    key: 'client_call',
    label: 'Client Call',
    description: 'Schedule a call with an existing client.',
    url: 'https://cal.com/aubreylaw/currentclient',
    eventSlug: 'currentclient',
    envVar: 'NEXT_PUBLIC_CALCOM_CLIENT_CALL_URL',
  },
  signing_appointment: {
    key: 'signing_appointment',
    label: 'Signing Appointment',
    description: 'Schedule the execution meeting for final documents.',
    url: 'https://cal.com/aubreylaw/signing-appointment',
    eventSlug: 'signing-appointment',
    envVar: 'NEXT_PUBLIC_CALCOM_SIGNING_APPOINTMENT_URL',
  },
} as const satisfies Record<MeetingTypeKey, SchedulingMeetingType & { envVar: string }>

function configuredUrlFor(key: MeetingTypeKey): string {
  const def = MEETING_TYPE_DEFS[key]
  const configured = process.env[def.envVar]?.trim()
  if (configured) return configured

  if (key === 'pmps') {
    return process.env.NEXT_PUBLIC_PMPS_SCHEDULING_URL?.trim() || def.url
  }

  return def.url
}

export function getSchedulingMeetingType(key: MeetingTypeKey): SchedulingMeetingType {
  const def = MEETING_TYPE_DEFS[key]
  return {
    key: def.key,
    label: def.label,
    portalLabel: 'portalLabel' in def ? def.portalLabel : undefined,
    description: def.description,
    url: configuredUrlFor(key),
    eventSlug: def.eventSlug,
  }
}

export function meetingTypeForCalSlug(slug: string | null | undefined): SchedulingMeetingType | null {
  if (!slug) return null
  const normalized = slug.trim()
  const key = (Object.keys(MEETING_TYPE_DEFS) as MeetingTypeKey[])
    .find(item => MEETING_TYPE_DEFS[item].eventSlug === normalized)
  return key ? getSchedulingMeetingType(key) : null
}

export function meetingTypeForKey(value: string | null | undefined): SchedulingMeetingType | null {
  if (!value) return null
  const normalized = value.trim() as MeetingTypeKey
  return normalized in MEETING_TYPE_DEFS ? getSchedulingMeetingType(normalized) : null
}
