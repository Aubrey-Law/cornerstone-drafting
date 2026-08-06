// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FACTS_PANEL_SECTION_STORAGE_KEY,
  DEFAULT_SECTION_STATE,
  useSectionState,
} from '@/app/admin/matters/[id]/facts-panel/useSectionState'

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('useSectionState', () => {
  it('starts from the defaults when nothing is stored', () => {
    const { result } = renderHook(() => useSectionState())
    expect(result.current.open).toEqual(DEFAULT_SECTION_STATE)
    expect(DEFAULT_SECTION_STATE).toEqual({
      contact: true, spouse: true, matter: true, flags: true,
      dates: false, notes: false, activity: false,
    })
  })

  it('round-trips a toggle through localStorage', () => {
    const first = renderHook(() => useSectionState())
    act(() => first.result.current.toggle('dates'))
    expect(first.result.current.open.dates).toBe(true)

    const second = renderHook(() => useSectionState())
    expect(second.result.current.open.dates).toBe(true)
  })

  it('merges a partial stored value with the defaults', () => {
    window.localStorage.setItem(
      FACTS_PANEL_SECTION_STORAGE_KEY,
      JSON.stringify({ notes: true }),
    )
    const { result } = renderHook(() => useSectionState())
    expect(result.current.open.notes).toBe(true)
    expect(result.current.open.contact).toBe(DEFAULT_SECTION_STATE.contact)
  })

  it('ignores unknown keys and malformed values without throwing', () => {
    window.localStorage.setItem(
      FACTS_PANEL_SECTION_STORAGE_KEY,
      JSON.stringify({ contact: false, bogus: true, dates: 'yes' }),
    )
    const { result } = renderHook(() => useSectionState())
    expect(result.current.open.contact).toBe(false)
    expect(result.current.open.dates).toBe(DEFAULT_SECTION_STATE.dates)
    expect('bogus' in result.current.open).toBe(false)
  })

  it('survives malformed json', () => {
    window.localStorage.setItem(FACTS_PANEL_SECTION_STORAGE_KEY, '{not json')
    const { result } = renderHook(() => useSectionState())
    expect(result.current.open).toEqual(DEFAULT_SECTION_STATE)
  })

  it('leaves other localStorage keys alone when collapsing all', () => {
    window.localStorage.setItem('al.unrelated', 'keep me')
    const { result } = renderHook(() => useSectionState())
    act(() => result.current.collapseAll())
    expect(Object.values(result.current.open).every(value => value === false)).toBe(true)
    expect(window.localStorage.getItem('al.unrelated')).toBe('keep me')
  })
})
