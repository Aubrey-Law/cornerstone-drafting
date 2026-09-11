// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarMattersContext } from '@/lib/matters/SidebarMattersContext'
import { MatterSwitcher } from '@/components/matter/MatterSwitcher'
import type { SidebarMattersState } from '@/lib/matters/useSidebarMatters'
const mock = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => mock }))
vi.mock('@/lib/matters/useMatterSearch', () => ({ useMatterSearch: (query: string) => ({ matters: query ? [{ matter_id: 'search', client_name: 'Search Client' }] : [], searching: false, error: null }) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
afterEach(cleanup)
const state = {
  pinned: [{ matter_id: 'pinned', title: 'Pinned Client', matter_number: '2026-1' }],
  recent: [{ matter_id: 'recent', title: 'Recent Client', matter_number: '2026-2' }],
  loading: false,
} as SidebarMattersState

describe('matter switcher', () => {
  it('uses shared pinned/recent rows and supports keyboard navigation', async () => {
    const user = userEvent.setup()
    render(<SidebarMattersContext.Provider value={state}><MatterSwitcher matterId="current" label="Current Client" /></SidebarMattersContext.Provider>)
    await user.click(screen.getByRole('button', { name: /Switch matter/ }))
    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText('Recent')).toBeTruthy()
    expect(screen.getByRole('option', { name: /Pinned Client/ })).toBeTruthy()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(mock.push).toHaveBeenCalledWith('/admin/matters/recent')
  })
  it('searches beyond the shortcuts and closes after selection', async () => {
    const user = userEvent.setup()
    render(<SidebarMattersContext.Provider value={state}><MatterSwitcher matterId="current" label="Current Client" /></SidebarMattersContext.Provider>)
    await user.click(screen.getByRole('button', { name: /Switch matter/ }))
    await user.type(screen.getByPlaceholderText('Find a matter…'), 'Search')
    await user.click(screen.getByRole('option', { name: /Search Client/ }))
    expect(mock.push).toHaveBeenCalledWith('/admin/matters/search')
    expect(screen.queryByPlaceholderText('Find a matter…')).toBeNull()
  })
})
