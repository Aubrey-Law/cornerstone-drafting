import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import {
  buildTimeSuggestions,
  previousDayKey,
  suggestionSummary,
  timeEntryFromRow,
  timerMinutes,
  totalMinutes,
  type ActivityForSuggestion,
  type MeetingForSuggestion,
  type RunningTimer,
  type TimeEntry,
  type TimeEntryInput,
} from '@/lib/timeEntries/model'

/**
 * Time entries: the half that touches records.
 *
 * Entries are written three ways: the matter page's timer and manual entry
 * (straight in, the attorney is the one typing), and the daily suggestion pass,
 * which reads yesterday's matter activity and meetings and offers one entry per
 * matter through the delegation dial as `billing.time_entry.create`. Every
 * read tolerates a database the migration has not reached yet.
 */

type Admin = ReturnType<typeof getAdminClient>

export const TIME_ENTRY_ACTION_KEY = 'billing.time_entry.create'

const ENTRY_COLUMNS = 'id, matter_id, user_id, work_date, minutes, description, source, activity_ids, created_at'

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  return /does not exist|could not find/i.test(error.message ?? '')
}

export class TimeEntriesUnavailableError extends Error {
  constructor() {
    super('Time entries are not available until the time entries migration has run')
  }
}

export interface MatterTimeSummary {
  entries: TimeEntry[]
  totalMinutes: number
  timer: RunningTimer | null
  /** The viewer's timer when it runs on another matter. */
  timerElsewhere: RunningTimer | null
  unavailable: boolean
}

function timerFromRow(row: Record<string, unknown> | null): RunningTimer | null {
  if (!row || typeof row.user_id !== 'string' || typeof row.matter_id !== 'string' || typeof row.started_at !== 'string') return null
  return {
    userId: row.user_id,
    matterId: row.matter_id,
    startedAt: row.started_at,
    description: typeof row.description === 'string' ? row.description : null,
  }
}

export async function loadTimer(userId: string, admin: Admin = getAdminClient()): Promise<RunningTimer | null> {
  const { data, error } = await admin.from('time_entry_timers')
    .select('user_id, matter_id, started_at, description')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return null
    throw new Error(error.message)
  }
  return timerFromRow(data as Record<string, unknown> | null)
}

export async function listMatterTimeEntries(matterId: string, userId: string | null, admin: Admin = getAdminClient()): Promise<MatterTimeSummary> {
  const { data, error } = await admin.from('time_entries')
    .select(ENTRY_COLUMNS)
    .eq('matter_id', matterId)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    if (isMissingRelation(error)) return { entries: [], totalMinutes: 0, timer: null, timerElsewhere: null, unavailable: true }
    throw new Error(error.message)
  }
  const entries = ((data ?? []) as Record<string, unknown>[]).map(timeEntryFromRow)
  const timer = userId ? await loadTimer(userId, admin) : null
  return {
    entries,
    totalMinutes: totalMinutes(entries),
    timer: timer && timer.matterId === matterId ? timer : null,
    timerElsewhere: timer && timer.matterId !== matterId ? timer : null,
    unavailable: false,
  }
}

async function assertMatter(admin: Admin, matterId: string): Promise<{ id: string; name: string }> {
  const { data, error } = await admin.from('matters').select('id, name').eq('id', matterId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Matter not found')
  return data as { id: string; name: string }
}

export async function matterLabel(admin: Admin, matterId: string): Promise<string> {
  return (await assertMatter(admin, matterId)).name?.trim() || 'Matter'
}

/**
 * Writes one entry. A suggestion carries its key, and the unique index on it
 * makes a second write of the same suggestion return the first instead.
 */
export async function insertTimeEntry(admin: Admin, input: TimeEntryInput, actorId: string | null): Promise<{ entry: TimeEntry; reused: boolean }> {
  await assertMatter(admin, input.matterId)
  const inserted = await admin.from('time_entries').insert({
    matter_id: input.matterId,
    user_id: actorId,
    work_date: input.workDate,
    minutes: input.minutes,
    description: input.description,
    source: input.source,
    activity_ids: input.activityIds,
    suggestion_key: input.suggestionKey,
    created_by: actorId,
  }).select(ENTRY_COLUMNS).single()
  if (inserted.error) {
    if (inserted.error.code === '23505' && input.suggestionKey) {
      const existing = await admin.from('time_entries').select(ENTRY_COLUMNS).eq('suggestion_key', input.suggestionKey).maybeSingle()
      if (existing.data) return { entry: timeEntryFromRow(existing.data as Record<string, unknown>), reused: true }
    }
    if (isMissingRelation(inserted.error)) throw new TimeEntriesUnavailableError()
    throw new Error(inserted.error.message)
  }
  return { entry: timeEntryFromRow(inserted.data as Record<string, unknown>), reused: false }
}

export async function deleteTimeEntry(admin: Admin, input: { matterId: string; entryId: string }): Promise<boolean> {
  const { data, error } = await admin.from('time_entries')
    .delete()
    .eq('id', input.entryId)
    .eq('matter_id', input.matterId)
    .select('id')
  if (error) {
    if (isMissingRelation(error)) throw new TimeEntriesUnavailableError()
    throw new Error(error.message)
  }
  return (data ?? []).length > 0
}

/**
 * Stops the user's timer, wherever it runs, and records the time it ran as an
 * entry on that matter. Returns null when no timer was running.
 */
export async function stopTimer(admin: Admin, userId: string, now: Date = new Date()): Promise<TimeEntry | null> {
  const timer = await loadTimer(userId, admin)
  if (!timer) return null
  const { data: removed, error } = await admin.from('time_entry_timers').delete().eq('user_id', userId).eq('started_at', timer.startedAt).select('user_id')
  if (error) throw new Error(error.message)
  // A second tab stopping the same timer finds nothing to remove and records nothing.
  if ((removed ?? []).length === 0) return null
  const { entry } = await insertTimeEntry(admin, {
    matterId: timer.matterId,
    workDate: firmDateKey(timer.startedAt) ?? firmTodayKey(now),
    minutes: timerMinutes(timer.startedAt, now),
    description: timer.description?.trim() || 'Work on the matter',
    source: 'timer',
    activityIds: [],
    suggestionKey: null,
  }, userId)
  return entry
}

/**
 * Starts a timer on a matter. One timer per person: a timer already running
 * on another matter is stopped and its time recorded first, the way a paper
 * time sheet works when the phone rings about a different client.
 */
export async function startTimer(admin: Admin, input: { userId: string; matterId: string; description: string | null; now?: Date }): Promise<{ timer: RunningTimer; stopped: TimeEntry | null }> {
  await assertMatter(admin, input.matterId)
  const now = input.now ?? new Date()
  const current = await loadTimer(input.userId, admin)
  if (current && current.matterId === input.matterId) return { timer: current, stopped: null }
  const stopped = current ? await stopTimer(admin, input.userId, now) : null
  const { data, error } = await admin.from('time_entry_timers').upsert({
    user_id: input.userId,
    matter_id: input.matterId,
    started_at: now.toISOString(),
    description: input.description?.trim().slice(0, 2_000) || null,
  }, { onConflict: 'user_id' }).select('user_id, matter_id, started_at, description').single()
  if (error) {
    if (isMissingRelation(error)) throw new TimeEntriesUnavailableError()
    throw new Error(error.message)
  }
  return { timer: timerFromRow(data as Record<string, unknown>)!, stopped }
}

/** Throws the running timer away without recording anything. */
export async function discardTimer(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin.from('time_entry_timers').delete().eq('user_id', userId).select('user_id')
  if (error) {
    if (isMissingRelation(error)) return false
    throw new Error(error.message)
  }
  return (data ?? []).length > 0
}

// ---------------------------------------------------------------------------
// The daily suggestion pass
// ---------------------------------------------------------------------------

export interface SuggestionRunResult {
  unavailable: boolean
  day: string
  matters: number
  suggestions: number
  proposed: number
  done: number
  observed: number
  duplicates: number
  failed: number
  alreadyLogged: number
}

/** UTC bounds wide enough to hold every instant of a firm-calendar day. */
function dayWindow(dayKey: string): { from: string; to: string } {
  const start = new Date(`${dayKey}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 1)
  const end = new Date(`${dayKey}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 2)
  return { from: start.toISOString(), to: end.toISOString() }
}

async function loadDayActivity(admin: Admin, dayKey: string): Promise<ActivityForSuggestion[]> {
  const { from, to } = dayWindow(dayKey)
  const { data, error } = await admin.from('matter_activity')
    .select('id, matter_id, event_type, title, actor_id, created_at')
    .gte('created_at', from)
    .lt('created_at', to)
    .limit(5_000)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ id: string; matter_id: string; event_type: string; title: string; actor_id: string | null; created_at: string }>)
    .map(row => ({
      id: row.id,
      matterId: row.matter_id,
      eventType: row.event_type,
      title: row.title,
      createdAt: row.created_at,
      dayKey: firmDateKey(row.created_at) ?? '',
      byPerson: Boolean(row.actor_id),
    }))
    .filter(row => row.dayKey === dayKey)
}

async function loadDayMeetings(admin: Admin, dayKey: string, now: Date): Promise<MeetingForSuggestion[]> {
  const { from, to } = dayWindow(dayKey)
  const { data, error } = await admin.from('appointments')
    .select('id, linked_matter_id, attendee_name, start_time, end_time, status')
    .not('linked_matter_id', 'is', null)
    .eq('status', 'scheduled')
    .gte('start_time', from)
    .lt('start_time', to)
    .limit(1_000)
  if (error) {
    if (isMissingRelation(error)) return []
    throw new Error(error.message)
  }
  return ((data ?? []) as Array<{ id: string; linked_matter_id: string; attendee_name: string | null; start_time: string; end_time: string }>)
    // Only meetings that have ended were held; a later one may still be cancelled.
    .filter(row => new Date(row.end_time).getTime() <= now.getTime())
    .map(row => ({
      id: row.id,
      matterId: row.linked_matter_id,
      title: row.attendee_name?.trim() || 'Client meeting',
      startTime: row.start_time,
      endTime: row.end_time,
      dayKey: firmDateKey(row.start_time) ?? '',
    }))
    .filter(row => row.dayKey === dayKey)
}

/**
 * Reads one firm day (yesterday by default) and offers a time entry per
 * matter that had work on it and no time logged. Keyed to the matter and the
 * day, so a second run, or a run after the attorney approved, adds nothing.
 */
export async function prepareTimeEntrySuggestions(input: { actorId: string | null; day?: string; now?: Date }): Promise<SuggestionRunResult> {
  const admin = getAdminClient()
  const now = input.now ?? new Date()
  const day = input.day ?? previousDayKey(firmTodayKey(now))
  const result: SuggestionRunResult = { unavailable: false, day, matters: 0, suggestions: 0, proposed: 0, done: 0, observed: 0, duplicates: 0, failed: 0, alreadyLogged: 0 }

  const logged = await admin.from('time_entries').select('matter_id').eq('work_date', day).limit(5_000)
  if (logged.error) {
    if (isMissingRelation(logged.error)) return { ...result, unavailable: true }
    throw new Error(logged.error.message)
  }
  const loggedMatterIds = new Set(((logged.data ?? []) as Array<{ matter_id: string }>).map(row => row.matter_id))

  const [activity, meetings] = await Promise.all([loadDayActivity(admin, day), loadDayMeetings(admin, day, now)])
  // matter_activity.matter_id is text with no foreign key; keep only real matters.
  const candidateIds = [...new Set([...activity.map(row => row.matterId), ...meetings.map(row => row.matterId)])]
  const names = new Map<string, string>()
  for (let i = 0; i < candidateIds.length; i += 200) {
    const { data, error } = await admin.from('matters').select('id, name').in('id', candidateIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Array<{ id: string; name: string | null }>) names.set(row.id, row.name?.trim() || 'Matter')
  }

  const { suggestions, skipped } = buildTimeSuggestions({
    dayKey: day,
    activity: activity.filter(row => names.has(row.matterId)),
    meetings: meetings.filter(row => names.has(row.matterId)),
    loggedMatterIds,
  })
  result.matters = suggestions.length + skipped.length
  result.suggestions = suggestions.length
  result.alreadyLogged = skipped.filter(item => item.reason === 'already_logged').length
  if (suggestions.length === 0 || !input.actorId) return result

  const { createActionProposal } = await import('@/lib/actions/server')
  for (const suggestion of suggestions) {
    try {
      const created = await createActionProposal({
        actionKey: TIME_ENTRY_ACTION_KEY,
        displaySummary: suggestionSummary(names.get(suggestion.matterId) ?? 'Matter', suggestion),
        referencePayload: {
          matterId: suggestion.matterId,
          workDate: suggestion.workDate,
          minutes: suggestion.minutes,
          description: suggestion.description,
          source: 'suggested',
          activityIds: suggestion.activityIds,
          suggestionKey: suggestion.suggestionKey,
        },
        recordType: 'matter',
        recordId: suggestion.matterId,
        source: 'automation',
        idempotencyKey: suggestion.suggestionKey,
        applyAutonomy: true,
      }, { id: input.actorId })
      if (created.duplicate) result.duplicates += 1
      else if (created.autonomy === 'observe') result.observed += 1
      else if (created.execution) { if (created.execution.status === 'succeeded') result.done += 1; else result.failed += 1 }
      else result.proposed += 1
    } catch (error) {
      console.error('[time entries] suggestion proposal failed', { matterId: suggestion.matterId, cause: error instanceof Error ? error.message : String(error) })
      result.failed += 1
    }
  }
  return result
}
