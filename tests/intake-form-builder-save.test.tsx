// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntakeFormEditorClient } from '@/app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormEditorSnapshot } from '@/lib/intake/forms/persistenceTypes'
import { SettingsNav } from '@/app/admin/settings/SettingsNavMenu'
import { SettingsHistoryBoundary } from '@/app/admin/settings/SettingsHistoryBoundary'
import { Activity } from 'react'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/admin/settings/intake-forms/t1', useSearchParams: () => new URLSearchParams() }))

const date = '2026-10-08T12:00:00Z'
function fixture(): IntakeFormEditorSnapshot {
  const draft = { id: 'v1', template_id: 't1', version: 1, status: 'draft' as const, definition_hash: 'a'.repeat(64), lock_version: 2,
    created_by: 'admin', created_at: date, updated_at: date, published_at: null, published_by: null,
    definition: { schemaVersion: 1 as const, key: 'estate', title: 'Estate intake', sections: [{ id: 'review', title: 'Review', audience: 'client_and_staff' as const, items: [{ id: 'submit', kind: 'block' as const, blockId: 'review_submit' as const }] }] } }
  return { template: { id: 't1', key: 'estate', name: 'Estate intake', description: null, archived_at: null, created_by: 'admin', created_at: date, updated_at: date }, draft, versions: [draft], auditEvents: [] }
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const edit = (title = 'Changed title') => fireEvent.change(screen.getByLabelText('Form title'), { target: { value: title } })
const title = () => (screen.getByLabelText('Form title') as HTMLInputElement).value
const mount = () => render(<IntakeFormEditorClient initialSnapshot={fixture()} catalog={getIntakeFormBuilderCatalog()} />)
function observeDeparture() {
  const assign = vi.fn()
  // jsdom cannot navigate or replace Location.assign; keep the real DOM and intercept only that boundary.
  vi.stubGlobal('window', new Proxy(window, { get: (target, key) => key === 'location' ? { ...target.location, assign } : Reflect.get(target, key, target) }))
  return assign
}

describe('intake builder explicit save and recovery', () => {
  beforeEach(() => { push.mockClear(); vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); render(<SettingsHistoryBoundary />) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('never autosaves and sends the saved version lock only on Save draft', async () => {
    mount(); edit(); expect(fetch).not.toHaveBeenCalled()
    const saved = { ...fixture().draft!, lock_version: 3, definition_hash: 'b'.repeat(64), definition: { ...fixture().draft!.definition, title: 'Changed title' } }
    vi.mocked(fetch).mockResolvedValue(response({ draft: saved, diagnostics: [] }))
    click('Save draft'); await screen.findByText('No unsaved changes')
    expect(fetch).toHaveBeenCalledWith('/api/admin/settings/intake-forms/t1/draft', expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(vi.mocked(fetch).mock.lastCall![1]!.body as string)).toEqual({ versionId: 'v1', expectedLockVersion: 2, definition: saved.definition })
    vi.mocked(fetch).mockResolvedValue(response({ draft: { ...saved, lock_version: 4, definition: { ...saved.definition, title: 'Next edit' } }, diagnostics: [] }))
    edit('Next edit'); click('Save draft')
    await screen.findByText('No unsaved changes')
    expect(JSON.parse(vi.mocked(fetch).mock.lastCall![1]!.body as string)).toEqual({ versionId: 'v1', expectedLockVersion: 3, definition: { ...saved.definition, title: 'Next edit' } })
  })

  it.each(['definition', 'jumped-lock', 'unchanged-lock', 'version', 'id'])('rejects a shape-valid save with mismatched %s without losing edits or selection', async mismatch => {
    mount(); click('Select section Review')
    fireEvent.change(screen.getByLabelText('Section title'), { target: { value: 'Local review' } })
    const definition = { ...fixture().draft!.definition, sections: [{ ...fixture().draft!.definition.sections[0], title: 'Local review' }] }
    const returned = { ...fixture().draft!, lock_version: 3, definition }
    if (mismatch === 'definition') returned.definition = fixture().draft!.definition
    if (mismatch === 'jumped-lock') returned.lock_version = 5
    if (mismatch === 'unchanged-lock') returned.lock_version = 2
    if (mismatch === 'version') returned.version = 2
    if (mismatch === 'id') returned.id = 'other'
    vi.mocked(fetch).mockResolvedValueOnce(response({ draft: returned, diagnostics: [] }))
    click('Save draft'); await screen.findByText(/server returned an invalid/)
    expect((screen.getByLabelText('Section title') as HTMLInputElement).value).toBe('Local review')
    expect(screen.queryByText('No unsaved changes')).toBeNull()
    const valid = { ...fixture().draft!, lock_version: 3, definition }
    vi.mocked(fetch).mockResolvedValueOnce(response({ draft: valid, diagnostics: [] }))
    click('Retry save'); await screen.findByText('No unsaved changes')
    expect(JSON.parse(vi.mocked(fetch).mock.lastCall![1]!.body as string).expectedLockVersion).toBe(2)
  })

  it.each(['network', '500', 'malformed', 'wrong-template', 'wrong-status'])('retains edits after a %s failure and offers retry', async failure => {
    mount(); edit()
    if (failure === 'network') vi.mocked(fetch).mockRejectedValue(new Error('Offline'))
    else vi.mocked(fetch).mockResolvedValue(response(failure === '500' ? { error: 'Unavailable' } : failure === 'malformed' ? { draft: {} } : { draft: { ...fixture().draft, template_id: failure === 'wrong-template' ? 'other' : 't1', status: failure === 'wrong-status' ? 'published' : 'draft' }, diagnostics: [] }, failure === '500' ? 500 : 200))
    click('Save draft'); await screen.findByRole('alert'); expect(title()).toBe('Changed title')
    expect((screen.getByRole('button', { name: 'Retry save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('retains edits and contextual diagnostics after 422', async () => {
    mount(); edit(); vi.mocked(fetch).mockResolvedValue(response({ error: 'Invalid form', diagnostics: [{ path: 'title', message: 'Choose another title', code: 'invalid_definition' }] }, 422))
    click('Save draft'); await screen.findByRole('button', { name: /Choose another title/ }); expect(title()).toBe('Changed title')
  })

  it('keeps conflict edits until a confirmed valid reload replaces them', async () => {
    mount(); edit(); vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'Draft changed' }, 409))
    click('Save draft'); await screen.findByRole('button', { name: 'Reload latest' }); expect(title()).toBe('Changed title')
    edit('Still local'); expect(screen.getByRole('button', { name: 'Copy local definition' })).toBeTruthy()
    click('Reload latest'); click('Cancel'); expect(fetch).toHaveBeenCalledTimes(1)
    const latest = fixture(); latest.draft!.definition.title = 'Server version'; latest.draft!.lock_version = 8
    vi.mocked(fetch).mockResolvedValueOnce(response(latest)); click('Reload latest'); click('Confirm reload')
    await waitFor(() => expect(title()).toBe('Server version')); expect(screen.queryByRole('button', { name: 'Copy local definition' })).toBeNull()
  })

  it('preserves the selected section and its edits when reload returns a malformed snapshot', async () => {
    mount(); edit(); vi.mocked(fetch).mockResolvedValueOnce(response({}, 409)); click('Save draft')
    await screen.findByRole('button', { name: 'Reload latest' }); click('Select section Review')
    fireEvent.change(screen.getByLabelText('Section title'), { target: { value: 'Local review' } })
    vi.mocked(fetch).mockResolvedValueOnce(response({ template: fixture().template, versions: [], draft: null, auditEvents: [{}] }))
    click('Reload latest'); click('Confirm reload'); await screen.findByText(/server returned an invalid/)
    expect((screen.getByLabelText('Section title') as HTMLInputElement).value).toBe('Local review')
    expect(screen.getByRole('button', { name: 'Copy local definition' })).toBeTruthy()
  })

  it('keeps unload protection through saving, errors and conflicts, and cleans it up on unmount', async () => {
    const { unmount } = mount()
    const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }
    expect(unload()).toBe(false); edit(); expect(unload()).toBe(true)
    edit('Estate intake'); expect(unload()).toBe(false); edit()
    let resolve!: (value: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(done => { resolve = done })); click('Save draft'); expect(unload()).toBe(true)
    resolve(response({}, 500)); await screen.findByRole('button', { name: 'Retry save' }); expect(unload()).toBe(true)
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 409)); click('Retry save'); await screen.findByText(/draft changed elsewhere/i); expect(unload()).toBe(true)
    unmount(); expect(unload()).toBe(false)
  })

  it('exports canonical pretty JSON to clipboard, and falls back to a revoked Blob download', async () => {
    mount(); edit(); vi.mocked(fetch).mockResolvedValue(response({}, 409)); click('Save draft'); await screen.findByRole('button', { name: 'Copy local definition' })
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    click('Copy local definition'); await waitFor(() => expect(writeText).toHaveBeenCalled())
    const json = writeText.mock.calls[0][0]; expect(JSON.parse(json).title).toBe('Changed title'); expect(json.startsWith('{\n  "key": "estate",')).toBe(true)
    writeText.mockRejectedValueOnce(new Error('Denied'))
    const create = vi.fn().mockReturnValue('blob:local'); const revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('estate-unsaved-intake-form.json'); expect(this.href).toBe('blob:local') })
    click('Copy local definition'); await waitFor(() => expect(download).toHaveBeenCalledOnce()); expect(create.mock.calls[0][0]).toBeInstanceOf(Blob); expect(revoke).toHaveBeenCalledWith('blob:local')
  })

  it('cancels intercepted navigation without losing changes and restores link focus', async () => {
    mount(); edit()
    const assign = observeDeparture()
    const link = screen.getByRole('link', { name: 'Intake forms' })
    link.focus(); fireEvent.click(link)
    expect(screen.getByRole('alertdialog').textContent).toContain('You have unsaved intake form changes. Leave without saving them?')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    click('Cancel')
    await waitFor(() => expect(document.activeElement).toBe(link))
    expect(title()).toBe('Changed title'); expect(assign).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(link); expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(link))
    expect(assign).not.toHaveBeenCalled()
  })

  it('guards Settings selection with the same dialog, restores focus on cancel, and proceeds once to the selected destination', async () => {
    render(<><SettingsNav isAdministrator /><IntakeFormEditorClient initialSnapshot={fixture()} catalog={getIntakeFormBuilderCatalog()} /></>)
    edit()
    const select = screen.getByLabelText('Settings section')
    select.focus(); fireEvent.change(select, { target: { value: '/admin/settings?tab=models' } })
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog').textContent).toContain('You have unsaved intake form changes. Leave without saving them?')
    click('Cancel'); await waitFor(() => expect(document.activeElement).toBe(select))
    expect(title()).toBe('Changed title')
    fireEvent.change(select, { target: { value: '/admin/settings?tab=models' } })
    const leave = screen.getByRole('button', { name: 'Leave' }); fireEvent.click(leave); fireEvent.click(leave)
    expect(push).toHaveBeenCalledExactlyOnceWith('/admin/settings?tab=models')
  })

  it.each([-2, -1, 1, 2])('guards fallback history.go(%s) through Settings entries created before the editor mounts', async delta => {
    vi.stubGlobal('navigation', undefined)
    const originalPush = history.pushState
    const originalReplace = history.replaceState
    history.replaceState({ router: 'preserved' }, '', '/admin/settings?tab=models')
    const navigation = render(<SettingsNav isAdministrator />)
    history.pushState({ router: 'second' }, '', '/admin/settings?tab=notifications')
    history.pushState({ router: 'editor' }, '', '/admin/settings/intake-forms/t1?inspect=review#details')
    history.pushState({ router: 'fourth' }, '', '/admin/settings?tab=integrations')
    history.pushState({ router: 'fifth' }, '', '/admin/settings?tab=users')
    await act(async () => { history.go(-2); await new Promise(resolve => window.addEventListener('popstate', resolve, { once: true })) })
    const { unmount } = mount()
    const original = window.location.href
    const destination = `${window.location.origin}${delta === -2 ? '/admin/settings?tab=models' : delta === -1 ? '/admin/settings?tab=notifications' : delta === 1 ? '/admin/settings?tab=integrations' : '/admin/settings?tab=users'}`
    const size = history.length
    edit(); screen.getByLabelText('Form title').focus()
    act(() => { history.go(delta) })
    await screen.findByRole('alertdialog')
    await waitFor(() => expect(window.location.href).toBe(original))
    expect(history.state.router).toBe('editor')
    click('Cancel'); await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Form title')))
    expect(title()).toBe('Changed title'); expect(history.length).toBe(size)
    act(() => { history.go(delta) }); await screen.findByRole('alertdialog')
    const leave = screen.getByRole('button', { name: 'Leave' }); fireEvent.click(leave); fireEvent.click(leave)
    await waitFor(() => expect(window.location.href).toBe(destination))
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(history.length).toBe(size)
    unmount()
    navigation.unmount()
    expect(history.pushState).toBe(originalPush)
    expect(history.replaceState).toBe(originalReplace)
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  })

  it.each(['cancel', 'leave'])('handles an unknown fallback entry on %s without guessing history direction or distance', async action => {
    vi.stubGlobal('navigation', undefined)
    history.replaceState({}, '', '/admin/matters?filter=open')
    history.pushState({ router: 'editor' }, '', '/admin/settings/intake-forms/t1?inspect=review#details')
    mount(); edit(); screen.getByLabelText('Form title').focus()
    const original = window.location.href
    const go = vi.spyOn(history, 'go')
    act(() => history.back())
    await screen.findByRole('alertdialog')
    expect(go).not.toHaveBeenCalled()
    expect(window.location.href).toBe(original)
    expect(history.state.router).toBe('editor')
    if (action === 'cancel') {
      click('Cancel'); await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Form title')))
      expect(title()).toBe('Changed title')
    } else {
      const replace = vi.fn()
      vi.stubGlobal('window', new Proxy(window, { get: (target, key) => key === 'location' ? { ...target.location, replace } : Reflect.get(target, key, target) }))
      const leave = screen.getByRole('button', { name: 'Leave' }); fireEvent.click(leave); fireEvent.click(leave)
      expect(replace).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/admin/matters?filter=open`)
      expect(go).not.toHaveBeenCalled()
    }
  })

  it('rearms fallback traversal after restoring a cached editor with its unsaved definition', async () => {
    vi.stubGlobal('navigation', undefined)
    history.replaceState({}, '', '/admin/settings?tab=models')
    render(<SettingsNav isAdministrator />)
    history.pushState({}, '', '/admin/settings/intake-forms/t1')
    const editor = <IntakeFormEditorClient initialSnapshot={fixture()} catalog={getIntakeFormBuilderCatalog()} />
    const { rerender } = render(<Activity mode="visible">{editor}</Activity>)
    edit(); act(() => history.back()); await screen.findByRole('alertdialog'); click('Leave')
    await waitFor(() => expect(window.location.search).toBe('?tab=models'))
    rerender(<Activity mode="hidden">{editor}</Activity>)
    await act(async () => { history.forward(); await new Promise(resolve => window.addEventListener('popstate', resolve, { once: true })) })
    rerender(<Activity mode="visible">{editor}</Activity>)
    screen.getByLabelText('Form title').focus()
    act(() => history.back()); await screen.findByRole('alertdialog')
    click('Cancel')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Form title')))
    expect(window.location.pathname).toBe('/admin/settings/intake-forms/t1')
    expect(title()).toBe('Changed title')
  })

  it('guards fallback before an earlier router listener can hide the editor during popstate dispatch', async () => {
    vi.stubGlobal('navigation', undefined)
    history.replaceState({}, '', '/admin/settings?tab=models')
    render(<SettingsNav isAdministrator />)
    history.pushState({}, '', '/admin/settings/intake-forms/t1')
    const editor = <IntakeFormEditorClient initialSnapshot={fixture()} catalog={getIntakeFormBuilderCatalog()} />
    let view: ReturnType<typeof render>
    const route = vi.fn(() => view.rerender(<Activity mode="hidden">{editor}</Activity>))
    // Chrome dispatches the window target in registration order; jsdom groups
    // capture listeners first. Capture reproduces Chrome's earlier-router order.
    window.addEventListener('popstate', route, true)
    try {
      view = render(<Activity mode="visible">{editor}</Activity>)
      edit(); act(() => history.back())
      await screen.findByRole('alertdialog')
      expect(route).not.toHaveBeenCalled()
      click('Cancel')
      expect(title()).toBe('Changed title')
    } finally { window.removeEventListener('popstate', route, true) }
  })

  it('leaves unrelated navigation alone without an editor and after the editor unregisters', () => {
    vi.stubGlobal('navigation', undefined)
    const route = vi.fn()
    window.addEventListener('popstate', route)
    try {
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
      expect(route).toHaveBeenCalledTimes(1)
      const view = mount(); edit(); view.unmount()
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
      expect(route).toHaveBeenCalledTimes(2)
    } finally { window.removeEventListener('popstate', route) }
  })

  it('exempts same-page history anchors without dropping protection for a later route departure', async () => {
    mount(); history.replaceState({}, '', '/admin/settings/intake-forms/t1'); history.pushState({}, '', '#details'); edit()
    act(() => history.back())
    await waitFor(() => expect(window.location.hash).toBe(''))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
  })

  it('cancels native navigation traversals before history changes and cleans the listener after unmount', async () => {
    const navigation = Object.assign(new EventTarget(), { traverseTo: vi.fn() })
    vi.stubGlobal('navigation', navigation)
    const { unmount } = mount(); edit()
    const traverse = () => {
      const event = Object.assign(new Event('navigate', { cancelable: true }), { navigationType: 'traverse', destination: { url: `${window.location.origin}/admin/matters`, key: 'previous', sameDocument: true } })
      act(() => { navigation.dispatchEvent(event) }); return event
    }
    expect(traverse().defaultPrevented).toBe(true)
    click('Cancel'); expect(navigation.traverseTo).not.toHaveBeenCalled()
    expect(traverse().defaultPrevented).toBe(true); click('Leave')
    expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('previous')
    unmount(); expect(traverse().defaultPrevented).toBe(false)
  })

  it('rearms protection when Next restores a cached editor after a confirmed departure', () => {
    const editor = <IntakeFormEditorClient initialSnapshot={fixture()} catalog={getIntakeFormBuilderCatalog()} />
    const { rerender } = render(<Activity mode="visible">{editor}</Activity>); edit()
    observeDeparture(); fireEvent.click(screen.getByRole('link', { name: 'Intake forms' })); click('Leave')
    rerender(<Activity mode="hidden">{editor}</Activity>); rerender(<Activity mode="visible">{editor}</Activity>)
    fireEvent.click(screen.getByRole('link', { name: 'Intake forms' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('leaves exactly once for the captured destination even if the link changes while confirming', () => {
    mount(); edit()
    const link = screen.getByRole('link', { name: 'Intake forms' })
    link.setAttribute('href', '/admin/matters?filter=open#recent')
    fireEvent.click(link)
    link.setAttribute('href', '/admin/drafting')
    fireEvent.click(link)
    const leave = screen.getByRole('button', { name: 'Leave' })
    const assign = observeDeparture()
    fireEvent.click(leave); fireEvent.click(leave)
    expect(assign).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/admin/matters?filter=open#recent`)
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)
  })

  it('exempts clean state, modified clicks, downloads, non-self targets and same-page anchors, then removes the capture listener', () => {
    const { unmount } = mount()
    const link = document.createElement('a'); link.href = '/admin/matters'; document.body.append(link)
    const target = vi.fn((event: Event) => event.preventDefault())
    link.addEventListener('click', target)
    const dispatch = (init: MouseEventInit = {}) => { target.mockClear(); fireEvent.click(link, init); expect(target).toHaveBeenCalledOnce(); expect(screen.queryByRole('alertdialog')).toBeNull() }
    dispatch(); edit()
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) dispatch({ [modifier]: true })
    dispatch({ button: 1 })
    link.download = 'file'; dispatch(); link.removeAttribute('download')
    for (const destination of ['_blank', '_parent', 'named-frame']) { link.target = destination; dispatch() }
    link.target = ''; link.href = '#section'; dispatch()
    link.href = 'mailto:someone@example.com'; dispatch()
    link.href = '/admin/matters'; unmount(); dispatch(); link.remove()
  })

  it('keeps protection for external links and cleans a pending dialog on unmount', () => {
    const { unmount } = mount(); edit()
    const link = screen.getByRole('link', { name: 'Intake forms' })
    link.setAttribute('href', 'https://example.com/forms')
    fireEvent.click(link); expect(screen.getByRole('alertdialog')).toBeTruthy()
    unmount(); expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
