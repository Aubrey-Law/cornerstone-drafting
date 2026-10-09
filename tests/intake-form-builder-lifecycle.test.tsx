// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntakeFormEditorClient } from '@/app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormEditorSnapshot, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'
const date = '2026-10-08T12:00:00Z'
function fixture(status: IntakeFormVersionRow['status'] = 'draft'): IntakeFormEditorSnapshot {
  const version = { id: 'v1', template_id: 't1', version: 1, status, definition_hash: 'a'.repeat(64), lock_version: 2,
    created_by: 'admin', created_at: date, updated_at: date, published_at: status === 'draft' ? null : date, published_by: status === 'draft' ? null : 'admin',
    definition: { schemaVersion: 1 as const, key: 'estate', title: 'Estate intake', sections: [{ id: 'review', title: 'Review', audience: 'client_and_staff' as const, items: [{ id: 'submit', kind: 'block' as const, blockId: 'review_submit' as const }] }] } }
  return { template: { id: 't1', key: 'estate', name: 'Estate intake', description: null, archived_at: null, created_by: 'admin', created_at: date, updated_at: date }, draft: status === 'draft' ? version : null, versions: [version], auditEvents: [] }
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const mount = (data = fixture()) => render(<IntakeFormEditorClient initialSnapshot={data} catalog={getIntakeFormBuilderCatalog()} />)
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
describe('intake builder lifecycle', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('publishes only after confirmation using the saved lock and hash, then makes the version immutable', async () => {
    mount(); click('Publish'); expect(fetch).not.toHaveBeenCalled(); expect(screen.getByRole('alertdialog').textContent).toMatch(/Estate intake.*version 1/i)
    vi.mocked(fetch).mockResolvedValue(response({ version: fixture('published').versions[0] })); click('Confirm publish')
    await screen.findByText('Read-only version'); expect(disabled('Add section')).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/admin/settings/intake-forms/t1/publish', expect.objectContaining({ method: 'POST', body: JSON.stringify({ versionId: 'v1', expectedLockVersion: 2, expectedDefinitionHash: 'a'.repeat(64) }) }))
  })
  it.each([500, 200])('never assumes publish success for an invalid response (%s)', async status => {
    mount(); vi.mocked(fetch).mockResolvedValue(response({ version: {} }, status)); click('Publish'); click('Confirm publish'); await screen.findByRole('alert')
    expect(screen.getByLabelText('Form title')).toBeTruthy(); expect(disabled('Add section')).toBe(false); expect(screen.getByRole('button', { name: 'Discard draft' })).toBeTruthy()
  })
  it('disables publishing while dirty, saving, conflicted or invalid', async () => {
    mount(); fireEvent.change(screen.getByLabelText('Form title'), { target: { value: 'Local' } }); expect(disabled('Publish')).toBe(true)
    let resolve!: (response: Response) => void; vi.mocked(fetch).mockReturnValue(new Promise(done => { resolve = done })); click('Save draft'); expect(disabled('Publish')).toBe(true)
    resolve(response({}, 409)); await screen.findByRole('button', { name: 'Reload latest' }); expect(disabled('Publish')).toBe(true)
    cleanup(); const invalid = fixture(); invalid.draft!.definition.sections = []; mount(invalid); expect(disabled('Publish')).toBe(true)
  })
  it.each(['published', 'retired'] as const)('creates a next draft from a %s version', async status => {
    mount(fixture(status)); const next = { ...fixture().draft!, id: 'v2', version: 2, lock_version: 0 }; vi.mocked(fetch).mockResolvedValue(response({ draft: next, diagnostics: [] }, 201))
    click('Edit'); await screen.findByRole('button', { name: 'Save draft' }); expect(disabled('Add section')).toBe(false)
    expect(fetch).toHaveBeenCalledWith('/api/admin/settings/intake-forms/t1/draft', expect.objectContaining({ method: 'POST', body: JSON.stringify({ sourceVersionId: 'v1' }) }))
  })
  it.each(['publish', 'retire'] as const)('preserves source state and selection for malformed %s transitions', async action => {
    for (const mismatch of ['lock', 'definition', 'hash', 'id', 'version', 'template', 'status']) {
      const source = fixture(action === 'publish' ? 'draft' : 'published')
      mount(source); click('Select section Review')
      const returned = { ...fixture(action === 'publish' ? 'published' : 'retired').versions[0] }
      if (mismatch === 'lock') returned.lock_version = 3
      if (mismatch === 'definition') returned.definition = { ...returned.definition, title: 'Unexpected definition' }
      if (mismatch === 'hash') returned.definition_hash = 'b'.repeat(64)
      if (mismatch === 'id') returned.id = 'other'
      if (mismatch === 'version') returned.version = 2
      if (mismatch === 'template') returned.template_id = 'other'
      if (mismatch === 'status') returned.status = source.versions[0].status
      vi.mocked(fetch).mockResolvedValueOnce(response({ version: returned }))
      click(action === 'publish' ? 'Publish' : 'Retire'); click(`Confirm ${action}`)
      await screen.findByText(/server returned an invalid/)
      expect((screen.getByLabelText('Section title') as HTMLInputElement).value).toBe('Review')
      expect(screen.getByRole('button', { name: action === 'publish' ? 'Discard draft' : 'Retire' })).toBeTruthy()
      expect(disabled('Add section')).toBe(action === 'retire')
      cleanup()
    }
  })
  it('accepts a newer draft when concurrent history advances beyond the local next version', async () => {
    mount(fixture('published')); click('Select section Review')
    const next = { ...fixture().draft!, id: 'v4', version: 4, lock_version: 0 }
    vi.mocked(fetch).mockResolvedValueOnce(response({ draft: next, diagnostics: [] }, 201))
    click('Edit'); await screen.findByRole('button', { name: 'Save draft' })
    expect(disabled('Add section')).toBe(false)
    expect(screen.queryByText('Read-only version')).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/api/admin/settings/intake-forms/t1/draft', expect.objectContaining({ method: 'POST', body: JSON.stringify({ sourceVersionId: 'v1' }) }))
  })
  it.each(['definition', 'hash', 'lock', 'id', 'empty-id', 'equal-version', 'lower-version', 'template', 'status'])('rejects a next draft with mismatched %s and preserves immutable selection', async mismatch => {
    const source = fixture('published'); source.versions[0].version = 2
    mount(source); click('Select section Review')
    const returned: IntakeFormVersionRow = { ...fixture().draft!, id: 'v3', version: 3, lock_version: 0 }
    if (mismatch === 'definition') returned.definition = { ...returned.definition, title: 'Unexpected definition' }
    if (mismatch === 'hash') returned.definition_hash = 'b'.repeat(64)
    if (mismatch === 'lock') returned.lock_version = 1
    if (mismatch === 'id') returned.id = 'v1'
    if (mismatch === 'empty-id') returned.id = ''
    if (mismatch === 'equal-version') returned.version = 2
    if (mismatch === 'lower-version') returned.version = 1
    if (mismatch === 'template') returned.template_id = 'other'
    if (mismatch === 'status') returned.status = 'published'
    vi.mocked(fetch).mockResolvedValueOnce(response({ draft: returned, diagnostics: [] }))
    click('Edit'); await screen.findByText(/server returned an invalid/)
    expect((screen.getByLabelText('Section title') as HTMLInputElement).value).toBe('Review')
    expect(screen.getByText('Read-only version')).toBeTruthy(); expect(disabled('Add section')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })
  it('prevents creating the next draft for an archived template', () => {
    const data = fixture('published'); data.template.archived_at = date; mount(data); expect(disabled('Edit')).toBe(true); click('Edit'); expect(fetch).not.toHaveBeenCalled()
  })
  it('confirms discard, sends the saved lock and returns to immutable history', async () => {
    const data = fixture(); data.draft!.version = 2; data.versions.push({ ...fixture('published').versions[0], id: 'old' }); mount(data)
    click('Discard draft'); click('Cancel'); expect(fetch).not.toHaveBeenCalled()
    vi.mocked(fetch).mockResolvedValue(response({ draft: data.draft })); click('Discard draft'); click('Confirm discard')
    await screen.findByText('Read-only version'); expect(fetch).toHaveBeenCalledWith('/api/admin/settings/intake-forms/t1/draft', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ versionId: 'v1', expectedLockVersion: 2 }) }))
  })
  it('requires confirmation to retire the displayed published version', async () => {
    mount(fixture('published')); click('Retire'); click('Cancel'); expect(fetch).not.toHaveBeenCalled()
    vi.mocked(fetch).mockResolvedValue(response({ version: fixture('retired').versions[0] })); click('Retire'); click('Confirm retire')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull()); expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/admin/settings/intake-forms/t1/versions/v1/retire', expect.objectContaining({ method: 'POST', body: '{}' }))
  })

  it('inspects every historical version and retires an older publication while preserving an unsaved newer draft', async () => {
    const data = fixture()
    data.draft!.id = 'v4'; data.draft!.version = 4
    data.versions = [data.draft!, { ...fixture('retired').versions[0], id: 'v3', version: 3 },
      { ...fixture('published').versions[0], id: 'v2', version: 2, definition: { ...data.draft!.definition, title: 'Second publication' } }, fixture('published').versions[0]]
    mount(data)
    fireEvent.change(screen.getByLabelText('Form title'), { target: { value: 'Unsaved draft work' } })
    const history = screen.getByLabelText('Version history')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Version 4 · draft', 'Version 3 · retired', 'Version 2 · published', 'Version 1 · published'])
    fireEvent.change(history, { target: { value: 'v2' } })
    expect((screen.getByLabelText('Form title') as HTMLInputElement).value).toBe('Second publication')
    expect(disabled('Add section')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    const published = data.versions[2]
    vi.mocked(fetch).mockResolvedValue(response({ version: { ...published, status: 'retired' } }))
    click('Retire'); click('Confirm retire')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull())
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/settings/intake-forms/t1/versions/v2/retire', expect.objectContaining({ method: 'POST' }))
    fireEvent.change(history, { target: { value: 'v4' } })
    expect((screen.getByLabelText('Form title') as HTMLInputElement).value).toBe('Unsaved draft work')
    expect(disabled('Save draft')).toBe(false)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('can select and retire a publication hidden behind a newer retired version', async () => {
    const data = fixture('retired'); data.versions[0].version = 2; data.versions[0].id = 'v2'
    data.versions.push(fixture('published').versions[0]); mount(data)
    fireEvent.change(screen.getByLabelText('Version history'), { target: { value: 'v1' } })
    vi.mocked(fetch).mockResolvedValue(response({ version: fixture('retired').versions[0] }))
    click('Retire'); click('Confirm retire')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull())
    expect(screen.getByText('Version 1 · retired', { selector: 'p' })).toBeTruthy()
  })
})
