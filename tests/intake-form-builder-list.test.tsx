// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntakeFormTemplateSummary, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'
import { IntakeFormsListClient } from '@/app/admin/settings/intake-forms/IntakeFormsListClient'

const { push, fetchMock } = vi.hoisted(() => ({ push: vi.fn(), fetchMock: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const date = '2026-10-08T12:00:00Z'
function version(id: string, status: IntakeFormVersionRow['status'], number: number): IntakeFormVersionRow {
  return { id, status, version: number, template_id: 'active', created_at: date, updated_at: date,
    created_by: 'admin', definition_hash: 'hash', lock_version: 1, published_at: null, published_by: null,
    definition: { schemaVersion: 1, key: 'estate', title: 'Estate', sections: [] } }
}
function summary(id = 'active', archived = false): IntakeFormTemplateSummary {
  const draft = version(`${id}-draft`, 'draft', 3)
  return { template: { id, key: id, name: `${id} form`, description: null, created_by: 'admin',
    created_at: date, updated_at: date, archived_at: archived ? date : null },
  draft, latestPublished: version(`${id}-published`, 'published', 2), latestVersion: draft, lastModifiedAt: date }
}
function fields(key = 'special_needs', name = 'Special Needs Planning') {
  fireEvent.change(screen.getByLabelText('Stable key'), { target: { value: key } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
}
const ok = (body: unknown) => ({ ok: true, json: async () => body })

describe('intake form settings list', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('groups archived rows after active rows and exposes version status and modification time', () => {
    const retired = summary('retired')
    retired.draft = null; retired.latestPublished = null; retired.latestVersion = version('retired-v1', 'retired', 1)
    render(<IntakeFormsListClient initialTemplates={[summary('archived', true), summary(), retired]} />)
    expect(screen.getAllByRole('article').map(row => within(row).getByRole('heading').textContent)).toEqual(['active form', 'retired form', 'archived form'])
    const active = screen.getAllByRole('article')[0]
    expect(within(active).getByText('Draft v3')).toBeTruthy()
    expect(within(active).getByText('Published v2')).toBeTruthy()
    expect(within(active).getByText(/Last modified/)).toBeTruthy()
    expect(screen.getByText('Retired v1')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeTruthy()
    expect(within(screen.getAllByRole('article')[2]).queryByRole('button', { name: 'Archive' })).toBeNull()
    expect(within(screen.getAllByRole('article')[2]).getByRole('button', { name: 'Restore' })).toBeTruthy()
    expect(within(active).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/admin/settings/intake-forms/active')
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('offers blank creation in the empty state', () => {
    render(<IntakeFormsListClient initialTemplates={[]} />)
    expect(screen.getByText('No intake forms yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New blank form' })).toBeTruthy()
  })

  it.each(['New blank form', 'Archive'])('returns keyboard focus to %s after cancelling', async action => {
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    const trigger = screen.getByRole('button', { name: action })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the service aggregate even when the newest change belongs to an unlisted version', () => {
    const item = summary()
    item.lastModifiedAt = '2026-10-09T15:00:00Z'
    render(<IntakeFormsListClient initialTemplates={[item]} />)
    expect(screen.getByText(/Last modified/).querySelector('time')?.dateTime).toBe('2026-10-09T15:00:00Z')
  })

  it('rejects invalid keys and blank names before making a request', async () => {
    render(<IntakeFormsListClient initialTemplates={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'New blank form' }))
    fields('Bad Key', '  ')
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }))
    expect(screen.getByRole('alert').textContent).toMatch(/key|name/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('creates the exact blank definition and navigates only after success', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<IntakeFormsListClient initialTemplates={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'New blank form' })); fields()
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/intake-forms', expect.objectContaining({ method: 'POST', body: JSON.stringify({
      key: 'special_needs', name: 'Special Needs Planning', description: null,
      definition: { schemaVersion: 1, key: 'special_needs', title: 'Special Needs Planning', sections: [] },
    }) }))
    expect(push).not.toHaveBeenCalled()
    finish(ok({ template: { id: 'new-template' } }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/settings/intake-forms/new-template'))
  })

  it('includes a provided description in both metadata and blank definition', async () => {
    fetchMock.mockResolvedValue(ok({ template: { id: 'new' } }))
    render(<IntakeFormsListClient initialTemplates={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'New blank form' })); fields()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Planning intake' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.description).toBe('Planning intake')
    expect(body.definition.description).toBe('Planning intake')
  })

  it('duplicates the selected source version into a new template', async () => {
    fetchMock.mockResolvedValue(ok({ template: { id: 'copy' } }))
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' })); fields('copy', 'Copy')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Source version'), { target: { value: 'active-published' } })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate form' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/settings/intake-forms/copy'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/intake-forms/active/duplicate', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ sourceVersionId: 'active-published', key: 'copy', name: 'Copy', description: null }),
    }))
  })

  it('disables duplication when no source version exists', () => {
    const empty = summary(); empty.draft = null; empty.latestPublished = null; empty.latestVersion = null
    render(<IntakeFormsListClient initialTemplates={[empty]} />)
    expect((screen.getByRole('button', { name: 'Duplicate' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([false, true])('confirms archive/restore (archived=%s) and replaces only the returned row', async archived => {
    let finish!: (value: unknown) => void
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const item = summary('target', archived)
    render(<IntakeFormsListClient initialTemplates={[item, summary('other')]} />)
    const row = screen.getAllByRole('article').find(el => el.textContent?.includes('target form'))!
    fireEvent.click(within(row).getByRole('button', { name: archived ? 'Restore' : 'Archive' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: archived ? 'Restore form' : 'Archive form' }))
    expect(screen.getByRole('heading', { name: 'target form', hidden: true })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/intake-forms/target', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ archived: !archived }) }))
    finish(ok({ template: { ...item.template, archived_at: archived ? null : date, updated_at: '2026-10-09T15:00:00Z' } }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    const updated = screen.getAllByRole('article').find(el => el.textContent?.includes('target form'))!
    expect(within(updated).getByRole('button', { name: archived ? 'Archive' : 'Restore' })).toBeTruthy()
    expect(within(updated).getByText(/Last modified/).querySelector('time')?.dateTime).toBe('2026-10-09T15:00:00Z')
    expect(screen.getByRole('heading', { name: 'other form' })).toBeTruthy()
  })

  it('preserves a newer version aggregate when archive metadata is older', async () => {
    const item = summary()
    item.lastModifiedAt = '2026-10-10T15:00:00Z'
    fetchMock.mockResolvedValue(ok({ template: { ...item.template, archived_at: date, updated_at: '2026-10-09T15:00:00Z' } }))
    render(<IntakeFormsListClient initialTemplates={[item]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive form' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText(/Last modified/).querySelector('time')?.dateTime).toBe('2026-10-10T15:00:00Z')
  })

  it('keeps the current list and confirmation on archive failure so it can be retried', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Unable to process intake form request' }) })
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive form' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/try again/i))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'active form', hidden: true })).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it.each(['http', 'network'])('preserves creation input and existing rows on %s failure', async failure => {
    if (failure === 'http') fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Draft changed; refresh and try again', code: 'INTAKE_FORM_CONFLICT' }) })
    else fetchMock.mockRejectedValue(new Error('offline'))
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'New blank form' })); fields()
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/try again/i))
    expect((screen.getByLabelText('Stable key') as HTMLInputElement).value).toBe('special_needs')
    expect(screen.getByRole('heading', { name: 'active form', hidden: true })).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })
})
