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
    created_by: 'admin', definition_hash: 'a'.repeat(64), lock_version: 1, published_at: null, published_by: null,
    definition: { schemaVersion: 1, key: 'active', title: 'Estate', sections: [] } }
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
function detail() {
  const item = summary()
  return { template: item.template, draft: item.draft, versions: [item.draft!, item.latestPublished!, version('active-old', 'retired', 1)], auditEvents: [] }
}
function created(id = 'new-template', key = 'special_needs', name = 'Special Needs Planning', description: string | null = null) {
  return { template: { ...summary().template, id, key, name, description },
    draft: { ...version(`${id}-v1`, 'draft', 1), template_id: id, lock_version: 0,
      definition: { schemaVersion: 1, key, title: name, ...(description ? { description } : {}), sections: [] } }, diagnostics: [] }
}

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

  it.each(['New blank form', 'Duplicate', 'Archive', 'Restore'])('labels and describes %s and returns keyboard focus after cancelling', async action => {
    render(<IntakeFormsListClient initialTemplates={[summary('active', action === 'Restore')]} />)
    const trigger = screen.getByRole('button', { name: action })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole(action === 'Archive' || action === 'Restore' ? 'alertdialog' : 'dialog')
    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      expect(document.getElementById(dialog.getAttribute(attribute)!)?.textContent?.trim()).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    if (action === 'Duplicate') expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/intake-forms/active', expect.objectContaining({ cache: 'no-store' }))
    else expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the service aggregate even when the newest change belongs to an unlisted version', () => {
    const item = summary()
    item.lastModifiedAt = '2026-10-09T15:00:00Z'
    render(<IntakeFormsListClient initialTemplates={[item]} />)
    expect(screen.getByText(/Last modified/).querySelector('time')?.dateTime).toBe('2026-10-09T15:00:00Z')
  })

  it('keeps a recent discard visible after its draft row has been removed', () => {
    const item = summary(); item.draft = null; item.latestVersion = item.latestPublished
    item.template.updated_at = item.lastModifiedAt = '2026-10-10T15:00:00Z'
    render(<IntakeFormsListClient initialTemplates={[item]} />)
    expect(screen.queryByText('Draft v3')).toBeNull()
    expect(screen.getByText(/Last modified/).querySelector('time')?.dateTime).toBe('2026-10-10T15:00:00Z')
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
    finish(ok(created()))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/settings/intake-forms/new-template'))
  })

  it('includes a provided description in both metadata and blank definition', async () => {
    fetchMock.mockResolvedValue(ok(created('new', 'special_needs', 'Special Needs Planning', 'Planning intake')))
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
    const copy = created('copy', 'copy', 'Copy'); copy.draft.definition.title = 'Estate'
    fetchMock.mockResolvedValueOnce(ok(detail())).mockResolvedValueOnce(ok(copy))
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' })); fields('copy', 'Copy')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    fireEvent.change(screen.getByLabelText('Source version'), { target: { value: 'active-old' } })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate form' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/settings/intake-forms/copy'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/intake-forms/active/duplicate', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ sourceVersionId: 'active-old', expectedSourceLockVersion: 1, expectedSourceDefinitionHash: 'a'.repeat(64), key: 'copy', name: 'Copy', description: null }),
    }))
  })

  it('submits the source guards loaded when Duplicate opens and preserves the dialog on a stale-source conflict', async () => {
    const loaded = detail(); loaded.draft!.lock_version = 8; loaded.draft!.definition_hash = 'c'.repeat(64)
    fetchMock.mockResolvedValueOnce(ok(loaded)).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: 'INTAKE_FORM_CONFLICT' }) })
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' })); fields('available_copy', 'My copy')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate form' }))
    await screen.findByRole('alert')
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({ sourceVersionId: 'active-draft', expectedSourceLockVersion: 8,
      expectedSourceDefinitionHash: 'c'.repeat(64), key: 'available_copy', name: 'My copy', description: null })
    expect((screen.getByLabelText('Stable key') as HTMLInputElement).value).toBe('available_copy')
    expect((screen.getByLabelText('Source version') as HTMLSelectElement).value).toBe('active-draft')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
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

  it.each(['shape', 'key', 'name', 'date', 'draft-identity', 'definition', 'lock', 'status', 'existing-id', 'extra'])('preserves blank creation input on a malformed success (%s)', async mismatch => {
    const result = created()
    if (mismatch === 'key') result.template.key = 'wrong'
    if (mismatch === 'name') result.template.name = 'Wrong'
    if (mismatch === 'date') result.template.updated_at = 'not a date'
    if (mismatch === 'draft-identity') result.draft.template_id = 'wrong'
    if (mismatch === 'definition') result.draft.definition.title = 'Unexpected'
    if (mismatch === 'lock') result.draft.lock_version = 1
    if (mismatch === 'status') result.draft.status = 'published'
    if (mismatch === 'existing-id') result.template.id = 'active'
    fetchMock.mockResolvedValue(ok(mismatch === 'shape' ? { template: { id: 'new' } } : mismatch === 'extra' ? { ...result, unexpected: true } : result))
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'New blank form' })); fields()
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/invalid.*reload.*created/i))
    expect(push).not.toHaveBeenCalled(); expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Special Needs Planning')
    expect(screen.getByRole('heading', { name: 'active form', hidden: true })).toBeTruthy()
  })

  it.each([false, true])('preserves archive confirmation and the list for invalid successes (archived=%s)', async archived => {
    const item = summary('active', archived)
    for (const mismatch of ['shape', 'key', 'state', 'date']) {
      const result = { ...item.template, archived_at: archived ? null : date }
      if (mismatch === 'key') result.key = 'wrong'
      if (mismatch === 'state') result.archived_at = item.template.archived_at
      if (mismatch === 'date') result.updated_at = 'bad date'
      fetchMock.mockResolvedValue(ok({ template: mismatch === 'shape' ? { id: 'active' } : result }))
      render(<IntakeFormsListClient initialTemplates={[item]} />)
      fireEvent.click(screen.getByRole('button', { name: archived ? 'Restore' : 'Archive' }))
      fireEvent.click(screen.getByRole('button', { name: archived ? 'Restore form' : 'Archive form' }))
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/current list is preserved/i))
      expect(screen.getByRole('alertdialog')).toBeTruthy()
      expect(screen.getByRole('button', { name: archived ? 'Restore' : 'Archive', hidden: true })).toBeTruthy()
      expect(push).not.toHaveBeenCalled(); cleanup()
    }
  })

  it('rejects a malformed duplicate success without losing the historical source or identity entries', async () => {
    fetchMock.mockResolvedValueOnce(ok(detail())).mockResolvedValueOnce(ok({ template: { id: 'copy' } }))
    render(<IntakeFormsListClient initialTemplates={[summary()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' })); fields('copy', 'Copy')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    fireEvent.change(screen.getByLabelText('Source version'), { target: { value: 'active-old' } })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate form' }))
    await screen.findByRole('alert')
    expect(push).not.toHaveBeenCalled(); expect((screen.getByLabelText('Source version') as HTMLSelectElement).value).toBe('active-old')
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Copy')
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
