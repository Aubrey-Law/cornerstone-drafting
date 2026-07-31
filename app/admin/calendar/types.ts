export type LocationType = 'phone' | 'teams' | 'in_person'
export type CalendarView = 'month' | 'week' | 'day' | 'plan'
export type EventCategory = 'discovery' | 'meeting' | 'draft' | 'signing' | 'internal'

export interface CalendarAppointment {
  id: string
  startTime: string
  endTime: string
  status: 'scheduled' | 'cancelled' | 'rescheduled' | 'no_show'
  locationType: LocationType | null
  secondAttendeeName: string | null
  secondAttendeeEmail: string | null
  attendeeName: string
  attendeeEmail: string
  attendeePhone: string | null
  notes: string | null
  typeLabel: string
  source: string
  outlookSynced: boolean
  onlineMeetingUrl: string | null
  linkedMatterId: string | null
  linkedMatterNumber: string | null
  linkedMatterStage: string | null
  linkedMatterPlanType: string | null
  linkedLeadId: string | null
  calendarShowAsBusy?: boolean
}

export interface BookableType {
  id: string
  label: string
  durationMinutes: number
  locationType: LocationType
  locationTypes: LocationType[]
  active: boolean
}

export interface OutlookEvent {
  id: string
  subject: string
  startIso: string
  endIso: string
  isAllDay: boolean
  showAs: string
}

export interface CalendarAction {
  label: string
  href?: string
  action?: string
}

export interface AttentionItem {
  id: string
  severity: 'red' | 'amber'
  title: string
  detail: string
  matterId?: string
  leadId?: string
  actions: CalendarAction[]
}

export interface OpenSlot {
  startIso: string
  endIso: string
  afterHours: boolean
  meetingOrdinal: number
}

export interface CalendarRailData {
  datesThisWeek: Array<{ id: string; label: string; date: string; matterId: string }>
  followUps: Array<{ id: string; title: string; matterId: string | null; leadId: string | null }>
  openSlots: OpenSlot[]
}

export interface PlanData {
  days: Array<{
    date: string
    clientMinutes: number
    internalMinutes: number
    targetMinutes: number
    isToday: boolean
  }>
  deadlines: Array<{
    id: string
    date: string
    label: string
    matterId: string
    durationMinutes: number
  }>
  unscheduledTasks: Array<{
    id: string
    title: string
    estimateMinutes: number
    matterId: string | null
    leadId: string | null
  }>
  review: {
    meetingsHeld: number
    noShows: number
    mattersAdvanced: number
    notesMissing: number
    slipped: string[]
  }
}

export const LOCATION_LABEL: Record<LocationType, string> = {
  phone: 'Phone call',
  teams: 'Virtual meeting',
  in_person: 'In person',
}

export function allowedFormats(type: BookableType | undefined): LocationType[] {
  if (!type) return ['phone']
  return type.locationTypes.length > 0 ? type.locationTypes : [type.locationType]
}
