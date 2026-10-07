// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ query: '', replace: vi.fn(), message: vi.fn() }))
vi.mock('next/navigation', () => { const router = { replace: mock.replace }; return { useRouter: () => router, usePathname: () => '/admin/calendar', useSearchParams: () => new URLSearchParams(mock.query) } })
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAuthSession: () => ({ user: { id: 'staff' } }) }))
vi.mock('sonner', () => ({ toast: { message: mock.message } }))
import { shortcutBlocked, useCalendarNavigation } from '@/app/admin/calendar/useCalendarNavigation'

beforeEach(() => { localStorage.clear(); mock.replace.mockReset(); mock.message.mockReset(); mock.query = ''; window.history.replaceState({}, '', '/admin/calendar?context=matter') })
afterEach(cleanup)
describe('calendar navigation persistence and links', () => {
  it('hydrates saved view before writing default and preserves unrelated URL parameters', () => {
    localStorage.setItem('cornerstone.calendar.view', 'week')
    mock.query = 'context=matter'
    const { result } = renderHook(() => useCalendarNavigation('2026-10-07'))
    expect(result.current.view).toBe('week')
    expect(mock.replace).toHaveBeenCalledWith('/admin/calendar?context=matter&view=week&date=2026-10-07', { scroll: false })
    act(() => result.current.update('month', new Date(2026, 9, 8), undefined, true))
    expect(localStorage.getItem('cornerstone.calendar.view')).toBe('month')
    expect(mock.replace).toHaveBeenLastCalledWith('/admin/calendar?context=matter&view=month&date=2026-10-08', { scroll: false })
    expect(mock.message).toHaveBeenCalledTimes(1)
    act(() => result.current.update('day', new Date(2026, 9, 8), undefined, true))
    expect(mock.message).toHaveBeenCalledTimes(1)
  })
  it('applies subsequent linked URL changes and ignores saved view when valid URL view exists', () => {
    localStorage.setItem('cornerstone.calendar.view', 'week')
    mock.query = 'view=month&date=2026-10-09'
    const { result, rerender } = renderHook(() => useCalendarNavigation('2026-10-07'))
    expect(result.current.view).toBe('month')
    expect(result.current.selectedDay).toBe('2026-10-09')
    mock.query = 'view=day&date=2026-10-06'; rerender()
    expect(result.current.view).toBe('day')
    expect(result.current.selectedDay).toBe('2026-10-06')
    expect(mock.message).not.toHaveBeenCalled()
  })
  it('continues navigation if storage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    const { result } = renderHook(() => useCalendarNavigation('2026-10-07'))
    act(() => result.current.update('week', new Date(2026, 9, 8)))
    expect(result.current.view).toBe('week')
    get.mockRestore(); set.mockRestore()
  })
  it('blocks shortcuts for editable ancestors, open dialogs/popovers, and repeats', () => {
    const input = document.createElement('input'); document.body.append(input)
    let blocked = false
    input.addEventListener('keydown', event => { blocked = shortcutBlocked(event) })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); expect(blocked).toBe(true)
    input.remove()
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.dataset.state = 'open'; document.body.append(dialog)
    expect(shortcutBlocked(new KeyboardEvent('keydown', { key: 'd' }))).toBe(true)
    dialog.remove()
    expect(shortcutBlocked(new KeyboardEvent('keydown', { key: 'd', repeat: true }))).toBe(true)
    expect(shortcutBlocked(new KeyboardEvent('keydown', { key: 'd' }))).toBe(false)
  })
})
