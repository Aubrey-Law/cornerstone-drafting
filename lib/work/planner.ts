import { zonedTimeToUtcMs } from '@/lib/appointments/availability'
import { FIRM_TIMEZONE, firmTodayKey } from '@/lib/firmDate'
import type {
  DailyPlanPreview,
  SuggestedBlock,
  WorkItem,
  WorkPreferences,
} from '@/lib/work/types'
import type { TodayAppointment } from '@/lib/queries/today'

const MINUTE_MS = 60_000

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function parseTime(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return { hour, minute }
}

function isCommunication(item: WorkItem): boolean {
  return item.batchTag === 'communications'
    || item.sourceType === 'email'
    || item.sourceType === 'sms'
    || item.sourceType === 'portal_message'
}

function unique(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.workKey)) return false
    seen.add(item.workKey)
    return true
  })
}

function appointmentBusyIntervals(appointments: TodayAppointment[]): Array<{ start: number; end: number }> {
  return appointments
    .filter(appointment => !appointment.is_all_day)
    .flatMap(appointment => {
      const start = Date.parse(appointment.next_appointment)
      const parsedEnd = appointment.end_at ? Date.parse(appointment.end_at) : NaN
      const end = Number.isFinite(parsedEnd) && parsedEnd > start
        ? parsedEnd
        : start + 60 * MINUTE_MS
      return Number.isNaN(start) ? [] : [{ start, end }]
    })
    .sort((a, b) => a.start - b.start)
}

function scheduleBlocks(
  items: WorkItem[],
  date: string,
  appointments: TodayAppointment[],
  preferences: WorkPreferences,
  now: Date,
): SuggestedBlock[] {
  const wall = parseDateKey(date)
  const startTime = parseTime(preferences.workdayStart)
  const endTime = parseTime(preferences.workdayEnd)
  let cursor = zonedTimeToUtcMs({ ...wall, ...startTime }, FIRM_TIMEZONE)
  const workdayEnd = zonedTimeToUtcMs({ ...wall, ...endTime }, FIRM_TIMEZONE)
  if (date === firmTodayKey(now)) cursor = Math.max(cursor, now.getTime())
  // Start on a five-minute boundary so a plan generated at 10:03 is usable.
  cursor = Math.ceil(cursor / (5 * MINUTE_MS)) * 5 * MINUTE_MS
  const busy = appointmentBusyIntervals(appointments)
  const blocks: SuggestedBlock[] = []

  for (const item of items) {
    const minutes = Math.min(item.estimateMinutes, preferences.maxFocusBlockMinutes)
    const duration = minutes * MINUTE_MS
    let guard = 0
    while (guard++ < 20) {
      const conflict = busy.find(interval => cursor < interval.end && cursor + duration > interval.start)
      if (!conflict) break
      cursor = conflict.end
    }
    if (cursor + duration > workdayEnd) break
    blocks.push({
      workKey: item.workKey,
      startAt: new Date(cursor).toISOString(),
      endAt: new Date(cursor + duration).toISOString(),
      minutes,
    })
    cursor += duration + 10 * MINUTE_MS
  }
  return blocks
}

export function createDailyPlanPreview(input: {
  items: WorkItem[]
  preferences: WorkPreferences
  appointments?: TodayAppointment[]
  date?: string
  now?: Date
}): DailyPlanPreview {
  const now = input.now ?? new Date()
  const date = input.date ?? firmTodayKey(now)
  const appointments = input.appointments ?? []
  const open = input.items.filter(item => item.owner === 'firm' && item.state === 'open' && item.priorityBand < 4)
  const waiting = input.items.filter(item => item.owner !== 'firm' || item.state !== 'open' || item.priorityBand === 4)
  const critical = open.filter(item => item.priorityBand === 0)
  const today = open.filter(item => item.priorityBand === 1)

  // Every critical item remains visible even when this exceeds the usual WIP
  // cap. Otherwise fill the cap from band 1.
  const mustDo = unique([
    ...critical,
    ...today.slice(0, Math.max(0, input.preferences.maxMustDo - critical.length)),
  ])
  const mustKeys = new Set(mustDo.map(item => item.workKey))
  const communication = open.filter(item => isCommunication(item) && !mustKeys.has(item.workKey))
  const communicationKeys = new Set(communication.map(item => item.workKey))

  const capacityMinutes = Math.floor(
    input.preferences.focusCapacityMinutes * (1 - input.preferences.interruptionBufferPercent / 100),
  )
  const mustMinutes = mustDo.reduce((sum, item) => sum + item.estimateMinutes, 0)
  const communicationMinutes = communication.length
    ? Math.min(
        communication.reduce((sum, item) => sum + item.estimateMinutes, 0),
        input.preferences.adminBatchMinutes,
      )
    : 0
  let remaining = Math.max(0, capacityMinutes - mustMinutes - communicationMinutes)
  const suggested: WorkItem[] = []
  for (const item of open) {
    if (mustKeys.has(item.workKey) || communicationKeys.has(item.workKey)) continue
    if (item.priorityBand > 2 || item.estimateMinutes > remaining) continue
    suggested.push(item)
    remaining -= item.estimateMinutes
  }
  const selectedKeys = new Set([...mustDo, ...communication, ...suggested].map(item => item.workKey))
  const later = open.filter(item => !selectedKeys.has(item.workKey))
  const nowItem = mustDo[0] ?? communication[0] ?? suggested[0] ?? null
  const plannedMinutes = mustMinutes + communicationMinutes
    + suggested.reduce((sum, item) => sum + item.estimateMinutes, 0)
  const criticalMinutes = critical.reduce((sum, item) => sum + item.estimateMinutes, 0)
  const overloadMinutes = Math.max(0, mustMinutes - capacityMinutes)
  const blockItems = unique([
    ...mustDo,
    ...(communication.length ? [{
      ...communication[0],
      workKey: 'batch:communications',
      title: `Communication batch (${communication.length})`,
      estimateMinutes: communicationMinutes,
    }] : []),
    ...suggested,
  ])

  return {
    date,
    now: nowItem,
    mustDo,
    suggested,
    communication,
    waiting,
    later,
    blocks: scheduleBlocks(blockItems, date, appointments, input.preferences, now),
    capacityMinutes,
    plannedMinutes,
    criticalMinutes,
    overloadMinutes,
    overload: overloadMinutes > 0,
    appointments,
  }
}
