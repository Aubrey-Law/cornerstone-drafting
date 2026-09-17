import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  selected: '' as string,
  upserted: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabaseAdmin', () => {
  function builder() {
    const chain = {
      select: vi.fn((columns: string) => {
        state.selected = columns
        return chain
      }),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: state.row, error: null })),
      upsert: vi.fn(async (patch: Record<string, unknown>) => {
        state.upserted = patch
        return { error: null }
      }),
      order: vi.fn(async () => ({ data: [], error: null })),
    }
    return chain
  }
  return { getAdminClient: vi.fn(() => ({ from: vi.fn(() => builder()) })) }
})

import {
  __resetSchedulingCaches,
  getSchedulingSettings,
  updateSchedulingSettings,
} from '@/lib/appointments/settings'

beforeEach(() => {
  __resetSchedulingCaches()
  state.row = null
  state.selected = ''
  state.upserted = null
})

describe('getSchedulingSettings calendar selection', () => {
  // The select names its columns. A column missing from that string reads as
  // undefined and falls through to the default, so the setting would appear to
  // save and then quietly do nothing.
  it('asks the database for both calendar columns', async () => {
    await getSchedulingSettings()
    expect(state.selected).toContain('hidden_calendar_ids')
    expect(state.selected).toContain('blocking_calendar_ids')
  })

  it('surfaces both arrays from the row', async () => {
    state.row = {
      timezone: 'America/New_York',
      hidden_calendar_ids: ['holidays@example.com'],
      blocking_calendar_ids: ['personal@example.com'],
    }
    const settings = await getSchedulingSettings()
    expect(settings.hiddenCalendarIds).toEqual(['holidays@example.com'])
    expect(settings.blockingCalendarIds).toEqual(['personal@example.com'])
  })

  it('defaults both to empty when there is no row', async () => {
    const settings = await getSchedulingSettings()
    expect(settings.hiddenCalendarIds).toEqual([])
    expect(settings.blockingCalendarIds).toEqual([])
  })

  it('sanitizes junk stored in the columns', async () => {
    state.row = {
      timezone: 'America/New_York',
      hidden_calendar_ids: ['a', '', 3, 'a', null],
      blocking_calendar_ids: 'not-an-array',
    }
    const settings = await getSchedulingSettings()
    expect(settings.hiddenCalendarIds).toEqual(['a'])
    expect(settings.blockingCalendarIds).toEqual([])
  })
})

describe('updateSchedulingSettings calendar selection', () => {
  it('writes both arrays in snake_case', async () => {
    await updateSchedulingSettings({
      hiddenCalendarIds: ['holidays@example.com'],
      blockingCalendarIds: ['personal@example.com'],
    })
    expect(state.upserted?.hidden_calendar_ids).toEqual(['holidays@example.com'])
    expect(state.upserted?.blocking_calendar_ids).toEqual(['personal@example.com'])
  })

  it('sanitizes what it writes', async () => {
    await updateSchedulingSettings({ hiddenCalendarIds: ['a', '', 'a', 7] })
    expect(state.upserted?.hidden_calendar_ids).toEqual(['a'])
  })

  // The calendar page's visibility popover saves only hiddenCalendarIds. If an
  // absent field were written as an empty array, that save would erase the
  // firm's booking-protection policy without anyone touching it.
  it('leaves an untouched array out of the patch entirely', async () => {
    await updateSchedulingSettings({ hiddenCalendarIds: ['holidays@example.com'] })
    expect(state.upserted).not.toHaveProperty('blocking_calendar_ids')
  })
})
