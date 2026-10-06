import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildTimeSuggestions,
  formatElapsed,
  formatHours,
  isDateKey,
  meetingMinutes,
  parseDuration,
  parseTimeEntryInput,
  previousDayKey,
  roundUpToTenth,
  suggestionKey,
  suggestionSummary,
  timeEntryFromRow,
  timerMinutes,
  type ActivityForSuggestion,
  type MeetingForSuggestion,
} from '@/lib/timeEntries/model'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG } from '@/lib/actions/autonomy'
import { SYSTEM_AUTOMATIONS } from '@/lib/automations/registry'

/**
 * Time entries. The ledger had invoices, charges, payments and costs but no
 * time. These pin down the arithmetic (whole minutes, shown in tenths), what a
 * person may type, how a day's activity becomes one suggestion per matter,
 * and that the suggestion pass goes through the dial and never stacks.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const MATTER_A = '00000000-0000-0000-0000-00000000000a'
const MATTER_B = '00000000-0000-0000-0000-00000000000b'
const DAY = '2026-10-05'

let seq = 0
function activity(overrides: Partial<ActivityForSuggestion> = {}): ActivityForSuggestion {
  seq += 1
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    matterId: MATTER_A,
    eventType: 'email_sent',
    title: 'Email sent',
    createdAt: `${DAY}T14:${String(seq % 60).padStart(2, '0')}:00Z`,
    dayKey: DAY,
    byPerson: true,
    ...overrides,
  }
}

function meeting(overrides: Partial<MeetingForSuggestion> = {}): MeetingForSuggestion {
  return {
    id: 'appt-1',
    matterId: MATTER_A,
    title: 'Marcus Chen',
    startTime: `${DAY}T15:00:00Z`,
    endTime: `${DAY}T16:00:00Z`,
    dayKey: DAY,
    ...overrides,
  }
}

describe('time arithmetic', () => {
  it('rounds up to tenths of an hour and shows hours', () => {
    expect(roundUpToTenth(0)).toBe(0)
    expect(roundUpToTenth(1)).toBe(6)
    expect(roundUpToTenth(6)).toBe(6)
    expect(roundUpToTenth(7)).toBe(12)
    expect(formatHours(90)).toBe('1.5 h')
    expect(formatHours(6)).toBe('0.1 h')
  })

  it('a timer records at least a tenth and rounds up', () => {
    const start = '2026-10-06T14:00:00Z'
    expect(timerMinutes(start, new Date('2026-10-06T14:00:20Z'))).toBe(6)
    expect(timerMinutes(start, new Date('2026-10-06T14:31:00Z'))).toBe(36)
    expect(timerMinutes(start, new Date('2026-10-08T14:00:00Z'))).toBe(1440)
    expect(formatElapsed(start, new Date('2026-10-06T15:05:09Z'))).toBe('1:05:09')
  })

  it('reads durations the way people type them', () => {
    expect(parseDuration('1.5')).toBe(90)
    expect(parseDuration('.3')).toBe(18)
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('45m')).toBe(45)
    expect(parseDuration('45 minutes')).toBe(45)
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('30')).toBeNull()
  })

  it('validates dates and the day before', () => {
    expect(isDateKey('2026-10-05')).toBe(true)
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('0202-10-05')).toBe(false)
    expect(previousDayKey('2026-10-01')).toBe('2026-09-30')
    expect(previousDayKey('2026-11-02')).toBe('2026-11-01')
  })
})

describe('parseTimeEntryInput', () => {
  const valid = { matterId: MATTER_A, workDate: DAY, minutes: 30, description: ' Called the client ' }

  it('accepts a valid entry and trims it', () => {
    expect(parseTimeEntryInput(valid)).toEqual({
      matterId: MATTER_A, workDate: DAY, minutes: 30, description: 'Called the client', source: 'manual', activityIds: [], suggestionKey: null,
    })
  })

  it('refuses what cannot be recorded', () => {
    expect(() => parseTimeEntryInput(null)).toThrow()
    expect(() => parseTimeEntryInput({ ...valid, matterId: 'nope' })).toThrow(/matter/)
    expect(() => parseTimeEntryInput({ ...valid, workDate: '10/05/2026' })).toThrow(/workDate/)
    expect(() => parseTimeEntryInput({ ...valid, minutes: 0 })).toThrow(/minutes/)
    expect(() => parseTimeEntryInput({ ...valid, minutes: 1.5 })).toThrow(/minutes/)
    expect(() => parseTimeEntryInput({ ...valid, minutes: 1441 })).toThrow(/minutes/)
    expect(() => parseTimeEntryInput({ ...valid, description: '  ' })).toThrow(/description/)
  })

  it('keeps only real activity ids and a known source', () => {
    const parsed = parseTimeEntryInput({ ...valid, source: 'invented', activityIds: [MATTER_B, MATTER_B, 'x', 4], suggestionKey: 'k' })
    expect(parsed.source).toBe('manual')
    expect(parsed.activityIds).toEqual([MATTER_B])
    expect(parsed.suggestionKey).toBe('k')
  })

  it('maps a row', () => {
    expect(timeEntryFromRow({ id: 'e', matter_id: MATTER_A, user_id: null, work_date: DAY, minutes: 12, description: 'x', source: 'suggested', activity_ids: ['a'], created_at: 't' }))
      .toMatchObject({ id: 'e', minutes: 12, source: 'suggested', activityIds: ['a'] })
  })
})

describe('buildTimeSuggestions', () => {
  it('makes one entry per matter from its activity and meetings', () => {
    const items = [activity(), activity(), activity({ eventType: 'draft_generated' }), activity({ matterId: MATTER_B, eventType: 'note_added' })]
    const { suggestions, skipped } = buildTimeSuggestions({ dayKey: DAY, activity: items, meetings: [meeting()], loggedMatterIds: new Set() })
    expect(skipped).toEqual([])
    expect(suggestions).toHaveLength(2)
    const a = suggestions.find(item => item.matterId === MATTER_A)!
    // 60 (meeting) + 2 × 6 (emails) + 30 (drafting)
    expect(a.minutes).toBe(102)
    expect(a.description).toBe('Meeting: Marcus Chen (1.0 h); Email sent (2); Documents drafted')
    expect(a.activityIds).toHaveLength(3)
    expect(a.suggestionKey).toBe(suggestionKey(MATTER_A, DAY))
    expect(suggestions.find(item => item.matterId === MATTER_B)).toMatchObject({ minutes: 6, description: 'Note written' })
  })

  it('skips a matter with time already logged that day', () => {
    const { suggestions, skipped } = buildTimeSuggestions({ dayKey: DAY, activity: [activity()], meetings: [], loggedMatterIds: new Set([MATTER_A]) })
    expect(suggestions).toEqual([])
    expect(skipped).toEqual([{ matterId: MATTER_A, reason: 'already_logged' }])
  })

  it('ignores automations, other days, and activity that is not work', () => {
    const items = [
      activity({ byPerson: false }),
      activity({ dayKey: '2026-10-04' }),
      activity({ eventType: 'document_viewed' }),
      activity({ eventType: 'stage_changed' }),
    ]
    const { suggestions, skipped } = buildTimeSuggestions({ dayKey: DAY, activity: items, meetings: [meeting({ endTime: `${DAY}T14:00:00Z` })], loggedMatterIds: new Set() })
    expect(suggestions).toEqual([])
    expect(skipped).toEqual([{ matterId: MATTER_A, reason: 'nothing_billable' }])
  })

  it('rounds meetings up to tenths', () => {
    expect(meetingMinutes({ startTime: `${DAY}T15:00:00Z`, endTime: `${DAY}T15:20:00Z` })).toBe(24)
    expect(meetingMinutes({ startTime: 'bad', endTime: `${DAY}T15:20:00Z` })).toBe(0)
  })

  it('writes the Today line', () => {
    expect(suggestionSummary('Chen, Marcus', { minutes: 102, workDate: DAY })).toBe('Log 1.7 h on Chen, Marcus for 2026-10-05')
  })
})

describe('the dial action', () => {
  it('is an internal write in the billing group', () => {
    const definition = getActionDefinition('billing.time_entry.create')
    expect(definition?.risk).toBe('internal_write')
    expect(ACTION_CATALOG['billing.time_entry.create']).toMatchObject({ group: 'billing' })
    expect(() => definition!.validate({ matterId: 'nope' }, { id: MATTER_A })).toThrow()
    expect(typeof definition!.undo).toBe('function')
  })

  it('the suggestion pass proposes through the dial, keyed to the matter and day', () => {
    const server = read('lib/timeEntries/server.ts')
    expect(server).toContain('actionKey: TIME_ENTRY_ACTION_KEY')
    expect(server).toContain('applyAutonomy: true')
    expect(server).toContain('idempotencyKey: suggestion.suggestionKey')
    expect(server).toContain("inserted.error.code === '23505' && input.suggestionKey")
    expect(server).toContain("if (isMissingRelation(logged.error)) return { ...result, unavailable: true }")
  })
})

describe('wiring', () => {
  it('the migration creates both tables with RLS, the unique key and the automation row', () => {
    const sql = read('supabase/migrations/20270119090000_time_entries.sql')
    expect(sql).toContain('create table if not exists public.time_entries')
    expect(sql).toContain('create table if not exists public.time_entry_timers')
    expect(sql).toContain('suggestion_key  text unique')
    expect(sql).toContain("check (source in ('timer', 'manual', 'suggested'))")
    expect(sql).toContain('check (minutes between 1 and 1440)')
    expect(sql).toContain('alter table public.time_entries enable row level security')
    expect(sql).toContain('alter table public.time_entry_timers enable row level security')
    expect(sql).toContain("'system:time-entry-suggestions'")
  })

  it('the generated types carry both tables', () => {
    const types = read('packages/db-types/src/supabase.generated.ts')
    expect(types).toContain('      time_entries: {')
    expect(types).toContain('      time_entry_timers: {')
    expect(types).toContain('suggestion_key: string | null')
  })

  it('the cron runs under the automation center', () => {
    expect(SYSTEM_AUTOMATIONS.find(entry => entry.key === 'time-entry-suggestions')).toMatchObject({ path: '/api/cron/time-entry-suggestions', schedules: ['50 12 * * *'] })
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    expect(vercel.crons).toContainEqual({ path: '/api/cron/time-entry-suggestions', schedule: '50 12 * * *' })
    const route = read('app/api/cron/time-entry-suggestions/route.ts')
    expect(route).toContain("runSystemAutomation('time-entry-suggestions'")
    expect(route).toContain('resolveUnattendedActor()')
    expect(route).toContain('CRON_SECRET')
  })

  it('the matter routes are staff-only and the card is on the Billing tab', () => {
    for (const rel of ['route.ts', '[entryId]/route.ts', 'timer/route.ts']) {
      expect(read(`app/api/admin/matters/[id]/time-entries/${rel}`)).toContain('requireAdmin(req)')
    }
    expect(read('app/admin/matters/[id]/tabs/billing.tsx')).toContain('<TimeEntriesCard matterId={matterId} />')
    expect(read('app/admin/matters/[id]/tabs/TimeEntriesCard.tsx')).toContain('useConfirm()')
  })
})
