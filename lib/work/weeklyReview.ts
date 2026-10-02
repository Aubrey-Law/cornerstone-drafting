import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import type { WorkItem, WorkPreferences } from '@/lib/work/types'

export interface WeeklyReviewDay {
  date: string
  label: string
  items: WorkItem[]
  plannedMinutes: number
  capacityMinutes: number
  overflowMinutes: number
}

export interface WeeklyReview {
  weekStart: string
  weekEnd: string
  days: WeeklyReviewDay[]
  flexible: WorkItem[]
  waiting: WorkItem[]
  firstAction: WorkItem | null
  capacityMinutes: number
  plannedMinutes: number
  overflowMinutes: number
}

function keyAtUtcNoon(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(key: string, amount: number): string {
  const date = new Date(`${key}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return keyAtUtcNoon(date)
}

/** The coming Monday, unless today is Monday. Weekly review never rewrites today. */
export function weeklyReviewStart(now: Date = new Date()): string {
  const today = firmTodayKey(now)
  const date = new Date(`${today}T12:00:00Z`)
  const weekday = date.getUTCDay()
  return addDays(today, weekday === 1 ? 0 : (8 - weekday) % 7)
}

function estimatedDailyCapacity(preferences: WorkPreferences): number {
  return Math.floor(preferences.focusCapacityMinutes * (1 - preferences.interruptionBufferPercent / 100))
}

function dueDay(item: WorkItem, weekStart: string, weekEnd: string): string | null {
  const due = item.hardDueAt ?? item.dueAt
  const key = due ? firmDateKey(due) : null
  if (!key) return null
  if (key <= weekStart) return weekStart
  if (key > weekEnd) return null
  return key
}

/**
 * A weekly review is a capacity guardrail, not a hidden five-day commitment.
 * It places hard-date work on its due day and leaves undated work flexible;
 * each day's command center later checks real calendar availability before a
 * plan is committed.
 */
export function buildWeeklyReview(input: {
  items: WorkItem[]
  preferences: WorkPreferences
  now?: Date
}): WeeklyReview {
  const weekStart = weeklyReviewStart(input.now)
  const weekEnd = addDays(weekStart, 4)
  const capacityPerDay = estimatedDailyCapacity(input.preferences)
  const dayKeys = Array.from({ length: 5 }, (_, index) => addDays(weekStart, index))
  const work = input.items.filter(item => item.owner === 'firm' && item.state === 'open' && item.priorityBand < 4)
  const itemsByDay = new Map(dayKeys.map(key => [key, [] as WorkItem[]]))
  const flexible: WorkItem[] = []

  for (const item of work) {
    const day = dueDay(item, weekStart, weekEnd)
    if (day) itemsByDay.get(day)?.push(item)
    else if (item.priorityBand <= 2) flexible.push(item)
  }

  const days = dayKeys.map((date, index) => {
    const items = itemsByDay.get(date) ?? []
    const plannedMinutes = items.reduce((total, item) => total + item.estimateMinutes, 0)
    return {
      date,
      label: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][index],
      items,
      plannedMinutes,
      capacityMinutes: capacityPerDay,
      overflowMinutes: Math.max(0, plannedMinutes - capacityPerDay),
    }
  })
  const plannedMinutes = days.reduce((total, day) => total + day.plannedMinutes, 0)
  const capacityMinutes = capacityPerDay * days.length
  const overflowMinutes = days.reduce((total, day) => total + day.overflowMinutes, 0)

  return {
    weekStart,
    weekEnd,
    days,
    flexible,
    waiting: input.items.filter(item => item.owner !== 'firm' || item.state !== 'open' || item.priorityBand === 4),
    firstAction: days.flatMap(day => day.items)[0] ?? flexible[0] ?? null,
    capacityMinutes,
    plannedMinutes,
    overflowMinutes,
  }
}
