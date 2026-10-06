/**
 * Time entries: the pure half.
 *
 * The ledger knows what was billed and paid but not what the work took. Flat
 * fee and legal-plan matters are not billed by the hour, yet the firm still
 * wants the hours to know which matters pay. This module holds the rules: how
 * an entry is validated, how a timer rounds, and how a day's matter activity
 * becomes a suggested entry. The server half (server.ts) reads and writes, and
 * offers suggestions through the delegation dial.
 *
 * Time is kept in whole minutes and shown in tenths of an hour, the unit
 * lawyers bill in. Every date is a `YYYY-MM-DD` key in the firm's calendar.
 */

export const TIME_ENTRY_SOURCES = ['timer', 'manual', 'suggested'] as const
export type TimeEntrySource = typeof TIME_ENTRY_SOURCES[number]

/** One tenth of an hour, the smallest unit an entry is rounded to. */
export const TENTH_MINUTES = 6
export const MAX_ENTRY_MINUTES = 24 * 60
export const MAX_DESCRIPTION_LENGTH = 2_000

export interface TimeEntry {
  id: string
  matterId: string
  userId: string | null
  workDate: string
  minutes: number
  description: string
  source: TimeEntrySource
  activityIds: string[]
  createdAt: string
}

export interface RunningTimer {
  userId: string
  matterId: string
  startedAt: string
  description: string | null
}

export interface TimeEntryInput {
  matterId: string
  workDate: string
  minutes: number
  description: string
  source: TimeEntrySource
  activityIds: string[]
  suggestionKey: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_RE.exec(value)
  if (!match) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(match[1]) >= 2000
}

/** Rounds up to the next tenth of an hour; zero stays zero. */
export function roundUpToTenth(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.ceil(minutes / TENTH_MINUTES) * TENTH_MINUTES
}

/** Minutes a timer has run, rounded up to a tenth, never less than one tenth. */
export function timerMinutes(startedAt: string, now: Date = new Date()): number {
  const started = new Date(startedAt).getTime()
  if (Number.isNaN(started)) return TENTH_MINUTES
  const elapsed = (now.getTime() - started) / 60_000
  return Math.min(MAX_ENTRY_MINUTES, Math.max(TENTH_MINUTES, roundUpToTenth(elapsed)))
}

/** "1.5 h" — tenths of an hour, the way time is read on a bill. */
export function formatHours(minutes: number): string {
  return `${(Math.max(0, minutes) / 60).toFixed(1)} h`
}

/** "1:05:09" for a running timer. */
export function formatElapsed(startedAt: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000))
  if (!Number.isFinite(seconds)) return '0:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Reads what a person typed for a duration: hours as a decimal ("1.5", ".3"),
 * hours and minutes ("1:30"), or minutes with a unit ("45m"). Returns whole
 * minutes, or null when it is not a duration.
 */
export function parseDuration(text: string): number | null {
  const value = text.trim().toLowerCase()
  if (!value) return null
  let minutes: number | null = null
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value)
  const mins = /^(\d{1,4})\s*(m|min|mins|minutes)$/.exec(value)
  const hours = /^(\d{0,2}(?:\.\d{1,2})?)\s*(h|hr|hrs|hours)?$/.exec(value)
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2])
  else if (mins) minutes = Number(mins[1])
  else if (hours && hours[1] && hours[1] !== '.') minutes = Math.round(Number(hours[1]) * 60)
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_ENTRY_MINUTES) return null
  return minutes
}

/**
 * Validates an entry from any door: the matter page, the dial, the daily
 * suggestion pass. Throws with a message a person can act on.
 */
export function parseTimeEntryInput(value: unknown): TimeEntryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A time entry must be an object')
  const input = value as Record<string, unknown>
  const matterId = typeof input.matterId === 'string' ? input.matterId.trim() : ''
  if (!UUID_RE.test(matterId)) throw new Error('A valid matter is required')
  const workDate = typeof input.workDate === 'string' ? input.workDate.trim() : ''
  if (!isDateKey(workDate)) throw new Error('workDate must be a YYYY-MM-DD date')
  const minutes = typeof input.minutes === 'number' ? input.minutes : Number.NaN
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ENTRY_MINUTES) throw new Error('minutes must be a whole number from 1 to 1440')
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) throw new Error('A description is required')
  if (description.length > MAX_DESCRIPTION_LENGTH) throw new Error(`The description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`)
  const source = (TIME_ENTRY_SOURCES as readonly string[]).includes(input.source as string) ? input.source as TimeEntrySource : 'manual'
  const activityIds = Array.isArray(input.activityIds)
    ? [...new Set(input.activityIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))].slice(0, 200)
    : []
  const suggestionKey = typeof input.suggestionKey === 'string' && input.suggestionKey.trim()
    ? input.suggestionKey.trim().slice(0, 200)
    : null
  return { matterId, workDate, minutes, description, source, activityIds, suggestionKey }
}

export function timeEntryFromRow(row: Record<string, unknown>): TimeEntry {
  const source = (TIME_ENTRY_SOURCES as readonly string[]).includes(row.source as string) ? row.source as TimeEntrySource : 'manual'
  return {
    id: String(row.id),
    matterId: String(row.matter_id),
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    workDate: String(row.work_date),
    minutes: Number(row.minutes) || 0,
    description: typeof row.description === 'string' ? row.description : '',
    source,
    activityIds: Array.isArray(row.activity_ids) ? row.activity_ids.filter((id): id is string => typeof id === 'string') : [],
    createdAt: String(row.created_at ?? ''),
  }
}

export function totalMinutes(entries: Pick<TimeEntry, 'minutes'>[]): number {
  return entries.reduce((sum, entry) => sum + entry.minutes, 0)
}

// ---------------------------------------------------------------------------
// Suggestions from the activity log
// ---------------------------------------------------------------------------

/**
 * What one piece of logged work is worth when nobody ran a timer. Deliberately
 * modest: a suggestion should be easy to accept and easy to raise, never an
 * inflated bill. Kinds not listed (views, stage moves, flags, inbound texts)
 * are not work the attorney did and suggest nothing.
 */
export const ACTIVITY_MINUTES: Record<string, { minutes: number; label: string }> = {
  email_sent: { minutes: 6, label: 'Email sent' },
  sms_sent: { minutes: 6, label: 'Text sent' },
  note_added: { minutes: 6, label: 'Note written' },
  intake_sent: { minutes: 6, label: 'Intake sent' },
  task_completed: { minutes: 6, label: 'Task completed' },
  document_uploaded: { minutes: 6, label: 'Document filed' },
  draft_generated: { minutes: 30, label: 'Documents drafted' },
  draft_promoted_to_review: { minutes: 12, label: 'Draft reviewed' },
  invoice_issued: { minutes: 6, label: 'Invoice issued' },
}

export interface ActivityForSuggestion {
  id: string
  matterId: string
  eventType: string
  title: string
  createdAt: string
  /** The firm-calendar day the activity happened. */
  dayKey: string
  /** True when a person (not an automation) did it. */
  byPerson: boolean
}

export interface MeetingForSuggestion {
  id: string
  matterId: string
  title: string
  startTime: string
  endTime: string
  dayKey: string
}

export interface TimeSuggestion {
  matterId: string
  workDate: string
  minutes: number
  description: string
  activityIds: string[]
  suggestionKey: string
}

export type SuggestionSkipReason = 'already_logged' | 'nothing_billable'

export function suggestionKey(matterId: string, dayKey: string): string {
  return `time-suggestion:${matterId}:${dayKey}`
}

/** Minutes a meeting ran, rounded up to a tenth; nonsense times count as zero. */
export function meetingMinutes(meeting: Pick<MeetingForSuggestion, 'startTime' | 'endTime'>): number {
  const start = new Date(meeting.startTime).getTime()
  const end = new Date(meeting.endTime).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
  return Math.min(MAX_ENTRY_MINUTES, roundUpToTenth((end - start) / 60_000))
}

/**
 * Turns one day's activity and meetings into at most one suggested entry per
 * matter. A matter with any time already logged that day is skipped: whoever
 * logged it was keeping time by hand, and a suggestion on top would count the
 * same work twice.
 */
export function buildTimeSuggestions(input: {
  dayKey: string
  activity: ActivityForSuggestion[]
  meetings: MeetingForSuggestion[]
  loggedMatterIds: Set<string>
}): { suggestions: TimeSuggestion[]; skipped: Array<{ matterId: string; reason: SuggestionSkipReason }> } {
  const byMatter = new Map<string, { activity: ActivityForSuggestion[]; meetings: MeetingForSuggestion[] }>()
  const bucket = (matterId: string) => {
    let entry = byMatter.get(matterId)
    if (!entry) {
      entry = { activity: [], meetings: [] }
      byMatter.set(matterId, entry)
    }
    return entry
  }
  for (const item of input.activity) {
    if (item.dayKey !== input.dayKey || !item.byPerson) continue
    bucket(item.matterId).activity.push(item)
  }
  for (const meeting of input.meetings) {
    if (meeting.dayKey !== input.dayKey) continue
    bucket(meeting.matterId).meetings.push(meeting)
  }

  const suggestions: TimeSuggestion[] = []
  const skipped: Array<{ matterId: string; reason: SuggestionSkipReason }> = []
  for (const matterId of [...byMatter.keys()].sort()) {
    const { activity, meetings } = byMatter.get(matterId)!
    if (input.loggedMatterIds.has(matterId)) {
      skipped.push({ matterId, reason: 'already_logged' })
      continue
    }
    const lines: string[] = []
    let minutes = 0
    const activityIds: string[] = []

    for (const meeting of [...meetings].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
      const length = meetingMinutes(meeting)
      if (length <= 0) continue
      minutes += length
      lines.push(`Meeting: ${meeting.title} (${formatHours(length)})`)
    }

    const counts = new Map<string, { label: string; minutes: number; count: number }>()
    for (const item of [...activity].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const rule = ACTIVITY_MINUTES[item.eventType]
      if (!rule) continue
      activityIds.push(item.id)
      const tally = counts.get(item.eventType) ?? { label: rule.label, minutes: rule.minutes, count: 0 }
      tally.count += 1
      counts.set(item.eventType, tally)
    }
    for (const tally of counts.values()) {
      minutes += tally.minutes * tally.count
      lines.push(tally.count > 1 ? `${tally.label} (${tally.count})` : tally.label)
    }

    minutes = Math.min(MAX_ENTRY_MINUTES, roundUpToTenth(minutes))
    if (minutes <= 0) {
      skipped.push({ matterId, reason: 'nothing_billable' })
      continue
    }
    suggestions.push({
      matterId,
      workDate: input.dayKey,
      minutes,
      description: lines.join('; ').slice(0, MAX_DESCRIPTION_LENGTH),
      activityIds,
      suggestionKey: suggestionKey(matterId, input.dayKey),
    })
  }
  return { suggestions, skipped }
}

/** The firm-calendar day before `dayKey`. */
export function previousDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** The display line on a Today card for a suggested entry. */
export function suggestionSummary(clientName: string, suggestion: Pick<TimeSuggestion, 'minutes' | 'workDate'>): string {
  return `Log ${formatHours(suggestion.minutes)} on ${clientName} for ${suggestion.workDate}`
}
