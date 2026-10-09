// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from 'sonner'
import { GlobalSearch } from '@/components/GlobalSearch'
import AdminLayoutClient from '@/app/admin/AdminLayoutClient'
import { SettingsHistoryBoundary } from '@/app/admin/settings/SettingsHistoryBoundary'
import { IntakeFormEditorClient } from '@/app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormEditorSnapshot } from '@/lib/intake/forms/persistenceTypes'
import { ThemeContext } from '@/lib/theme/ThemeProvider'

const external = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), signOut: vi.fn(), preferences: { loadPreferences: async () => null, savePreferences: async () => null } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: external.push, refresh: external.refresh }),
  usePathname: () => '/admin/settings/intake-forms/t1',
  useSearchParams: () => new URLSearchParams(),
}))
// Keep both shell components and the real editor hook/dialog/boundary. Only
// network-backed dependencies are replaced; search's static destinations need
// no result API, and the shell's preferences/badges are not under test.
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { signOut: external.signOut }, from: () => {
  const query = { select: () => query, or: () => query, is: () => query, ilike: () => query, limit: async () => ({ data: [], error: null }) }
  return query
} } }))
vi.mock('@/lib/userPreferencesClient', () => ({ useUserPreferences: () => external.preferences }))

const date = '2026-10-08T12:00:00Z'
function fixture(): IntakeFormEditorSnapshot {
  const draft = { id: 'v1', template_id: 't1', version: 1, status: 'draft' as const, definition_hash: 'a'.repeat(64), lock_version: 2,
    created_by: 'admin', created_at: date, updated_at: date, published_at: null, published_by: null,
    definition: { schemaVersion: 1 as const, key: 'estate', title: 'Estate intake', sections: [{ id: 'review', title: 'Review', audience: 'client_and_staff' as const, items: [{ id: 'submit', kind: 'block' as const, blockId: 'review_submit' as const }] }] } }
  return { template: { id: 't1', key: 'estate', name: 'Estate intake', description: null, archived_at: null, created_by: 'admin', created_at: date, updated_at: date }, draft, versions: [draft], auditEvents: [] }
}
const editor = () => <IntakeFormEditorClient initialSnapshot={fixture()} catalog={getIntakeFormBuilderCatalog()} />
const edit = () => fireEvent.change(screen.getByLabelText('Form title'), { target: { value: 'Keep these local edits' } })
const dialog = () => screen.getByRole('alertdialog', { name: 'Leave without saving?' })
const cancel = () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
const leave = () => { const button = screen.getByRole('button', { name: 'Leave' }); fireEvent.click(button); fireEvent.click(button) }
const protectedFromUnload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }
const preserved = () => expect((screen.getByLabelText('Form title') as HTMLInputElement).value).toBe('Keep these local edits')

beforeEach(() => {
  vi.clearAllMocks()
  external.signOut.mockReset().mockResolvedValue({ error: null })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{}')))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  Element.prototype.scrollIntoView = vi.fn()
  window.localStorage.clear()
  render(<SettingsHistoryBoundary />)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('global shell departure uses the real intake editor guard', () => {
  it.each(['keyboard', 'pointer'] as const)('guards %s search selection, preserves the palette and focus on Cancel, and navigates once on Leave', async method => {
    const user = userEvent.setup()
    render(<><GlobalSearch />{editor()}</>)
    edit()
    await user.keyboard('{Meta>}k{/Meta}')
    const input = screen.getByPlaceholderText('Search matters, contacts, tasks, invoices…')
    await user.type(input, 'Calendar')
    const result = screen.getByRole('option', { name: 'Calendar' })
    const select = async () => { if (method === 'keyboard') await user.keyboard('{Enter}'); else await user.click(result) }
    await select()
    expect(external.push).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('You have unsaved intake form changes. Leave without saving them?')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    cancel()
    await waitFor(() => expect(document.activeElement).toBe(method === 'keyboard' ? input : result))
    preserved()
    expect((input as HTMLInputElement).value).toBe('Calendar')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(protectedFromUnload()).toBe(true)
    if (method === 'keyboard') input.focus()
    await select()
    leave()
    expect(external.push).toHaveBeenCalledExactlyOnceWith('/admin/calendar')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it.each(['clean', 'unmounted'] as const)('keeps search immediate with a %s editor and no stale listener', async state => {
    const user = userEvent.setup()
    render(<GlobalSearch />)
    const mounted = render(editor())
    if (state === 'unmounted') { edit(); mounted.unmount() }
    await user.keyboard('{Meta>}k{/Meta}')
    await user.click(screen.getByRole('option', { name: 'Calendar' }))
    expect(external.push).toHaveBeenCalledExactlyOnceWith('/admin/calendar')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(protectedFromUnload()).toBe(false)
  })

  async function signOutMenu(user: ReturnType<typeof userEvent.setup>) {
    const trigger = screen.getByRole('button', { name: 'Account: Local attorney' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    return trigger
  }
  const shell = () => render(<ThemeContext.Provider value={{ theme: 'light', resolvedTheme: 'light', setTheme() {} }}><Toaster /><AdminLayoutClient userName="Local attorney" userInitials="LA">{editor()}</AdminLayoutClient></ThemeContext.Provider>)

  it('asks before sign-out, restores account focus on Cancel, and runs authentication and routing once after Leave', async () => {
    const user = userEvent.setup()
    shell(); edit()
    const trigger = await signOutMenu(user)
    expect(external.signOut).not.toHaveBeenCalled()
    expect(external.push).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
    cancel()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    preserved(); expect(protectedFromUnload()).toBe(true)
    let finish!: (result: { error: null }) => void
    external.signOut.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await signOutMenu(user); leave()
    expect(external.signOut).toHaveBeenCalledOnce()
    expect(external.push).not.toHaveBeenCalled()
    await act(async () => finish({ error: null }))
    expect(external.push).toHaveBeenCalledExactlyOnceWith('/auth/login')
    expect(external.refresh).toHaveBeenCalledOnce()
  })

  it.each(['returned error', 'rejected request'] as const)('retains dirty protection and offers retry after a sign-out %s', async failure => {
    const user = userEvent.setup()
    shell(); edit()
    if (failure === 'returned error') external.signOut.mockResolvedValueOnce({ error: new Error('Unavailable') })
    else external.signOut.mockRejectedValueOnce(new Error('Offline'))
    const trigger = await signOutMenu(user); leave()
    await screen.findByText('Unable to sign out. Please try again.')
    expect(external.push).not.toHaveBeenCalled(); expect(external.refresh).not.toHaveBeenCalled()
    preserved(); expect(protectedFromUnload()).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    await signOutMenu(user)
    expect(dialog()).toBeTruthy()
    expect(external.signOut).toHaveBeenCalledOnce()
    cancel()
  })

  it('signs out immediately from a clean editor', async () => {
    const user = userEvent.setup()
    shell(); await signOutMenu(user)
    await waitFor(() => expect(external.push).toHaveBeenCalledExactlyOnceWith('/auth/login'))
    expect(external.signOut).toHaveBeenCalledOnce(); expect(external.refresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
