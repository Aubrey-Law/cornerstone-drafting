// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormEditorSnapshot } from '@/lib/intake/forms/persistenceTypes'
import { IntakeFormEditorClient } from '@/app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient'
import IntakeFormEditorPage from '@/app/admin/settings/intake-forms/[templateId]/page'

const mocks = vi.hoisted(() => ({ claims: vi.fn(), role: vi.fn(), snapshot: vi.fn(), notFound: vi.fn() }))
vi.mock('@/lib/supabaseServer', () => ({ getCachedClaims: mocks.claims, getCachedUserRole: mocks.role }))
vi.mock('@/lib/intake/forms/adminService', () => ({ getIntakeFormEditorSnapshot: mocks.snapshot }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
const catalog = getIntakeFormBuilderCatalog()
const id = 'ad318edc-43f8-4b49-97b0-1b2a9dd35038'
const date = '2026-10-08T12:00:00Z'
function fixture(): IntakeFormEditorSnapshot {
  const draft: NonNullable<IntakeFormEditorSnapshot['draft']> = {
    id: 'version-1', template_id: id, status: 'draft', version: 1, created_by: 'admin', created_at: date,
    updated_at: date, definition_hash: 'hash', lock_version: 1, published_at: null, published_by: null,
    definition: { schemaVersion: 1, key: 'estate', title: 'Estate intake', sections: [
      { id: 'family', title: 'Family', audience: 'client_and_staff', items: [
        { kind: 'field', id: 'marital', fieldId: 'marital_status', labelOverride: 'Relationship' },
        { kind: 'field', id: 'name', fieldId: 'client_first_name', labelOverride: 'Your name', condition: { op: 'equals', fieldId: 'marital_status', value: 'married' } },
      ] },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
    ] },
  }
  return { template: { id, key: 'estate', name: 'Estate intake', description: null, created_by: 'admin', created_at: date, updated_at: date, archived_at: null }, draft, versions: [draft], auditEvents: [] }
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
function mount(snapshot = fixture()) { return render(<IntakeFormEditorClient initialSnapshot={snapshot} catalog={catalog} />) }
function itemOrder() { return within(screen.getByRole('list', { name: 'Family items' })).getAllByRole('button', { name: /^Select item / }).map(button => button.textContent) }

describe('visual intake editor', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    Element.prototype.scrollIntoView = vi.fn()
    mocks.claims.mockResolvedValue({ id: 'admin' }); mocks.role.mockResolvedValue('admin')
    mocks.snapshot.mockResolvedValue(fixture())
    mocks.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })
  })
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('starts in Build, edits local form metadata, keeps stable keys read-only, and never autosaves', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Build' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Stable key') as HTMLInputElement).readOnly).toBe(true)
    change('Form title', '')
    change('Description', 'For our clients')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(screen.getByLabelText('Form title').getAttribute('maxlength')).toBe('160')
    expect(screen.getByLabelText('Description').getAttribute('maxlength')).toBe('600')
    expect(screen.queryByLabelText(/json/i)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('edits section and field presentation while enforcing the field baseline', () => {
    mount(); click('Select section Family')
    change('Section title', 'Household'); change('Subtitle', 'People close to you')
    change('Time estimate (minutes)', '6'); change('Audience', 'staff_only')
    click('Select item Your name')
    change('Label', 'Legal name'); change('Help text', 'Use your full name')
    expect(screen.getByLabelText('Label').getAttribute('maxlength')).toBe('160')
    expect(screen.getByLabelText('Help text').getAttribute('maxlength')).toBe('600')
    expect((screen.getByLabelText('Item ID') as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByRole('option', { name: /Optional.*below/i }) as HTMLOptionElement).disabled).toBe(true)
    expect(screen.getByText(/Minimum requirement: required/i)).toBeTruthy()
    click('Select section Household')
    expect((screen.getByLabelText('Time estimate (minutes)') as HTMLInputElement).value).toBe('6')
    expect((screen.getByLabelText('Audience') as HTMLSelectElement).value).toBe('staff_only')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('adds sections and approved items, searches labels/descriptions/IDs, and explains disabled choices', () => {
    mount(); click('Add section'); change('Section title', 'Extra')
    click('Add item to Extra')
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'client_first_name' } })
    expect(screen.getByRole('option', { name: /First name/i }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Already used in this form')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'Attorney plan-type selection' } })
    expect(screen.getByRole('option', { name: /Plan structure/ }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Requires a staff-only section')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'Address' } })
    fireEvent.click(screen.getByRole('option', { name: /^Address Canonical/ }))
    expect(screen.getByLabelText('Address profile')).toBeTruthy()
    expect((screen.getByLabelText('Ask for Massachusetts county') as HTMLInputElement).checked).toBe(true)
    change('Address profile', 'college')
    fireEvent.click(screen.getByLabelText('Ask for Massachusetts county'))
    click('Add item to Extra')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'client_email' } })
    fireEvent.click(screen.getByRole('option', { name: /Email/ }))
    expect(screen.getByRole('button', { name: /Select item.*Email/ })).toBeTruthy()
  })

  it('confirms removals and repairs selection after removing an item or section', () => {
    mount(); click('Remove Your name')
    expect(screen.getByRole('button', { name: 'Select item Your name', hidden: true })).toBeTruthy()
    click('Cancel')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    click('Remove Your name'); click('Confirm removal')
    expect(screen.queryByRole('button', { name: 'Select item Your name' })).toBeNull()
    click('Remove Family'); click('Confirm removal')
    expect(screen.queryByRole('button', { name: 'Select section Family' })).toBeNull()
  })

  it('returns focus to the originating control after cancelling removal or catalog selection', async () => {
    mount()
    const remove = screen.getByRole('button', { name: 'Remove Your name' }); remove.focus(); fireEvent.click(remove)
    click('Cancel'); await waitFor(() => expect(document.activeElement).toBe(remove))
    const add = screen.getByRole('button', { name: 'Add item to Family' }); add.focus(); fireEvent.click(add)
    click('Close'); await waitFor(() => expect(document.activeElement).toBe(add))
  })

  it('places the inspector under the selected node on a narrow layout and only once in a wide layout', () => {
    const { unmount } = mount(); click('Select item Your name')
    const selected = screen.getByRole('button', { name: 'Select item Your name' }).closest('li')!
    expect(within(selected).getByRole('region', { name: 'Selection inspector' })).toBeTruthy()
    unmount()
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    mount(); click('Select item Your name')
    expect(screen.getAllByRole('region', { name: 'Selection inspector' })).toHaveLength(1)
    expect(within(screen.getByRole('button', { name: 'Select item Your name' }).closest('li')!).queryByRole('region', { name: 'Selection inspector' })).toBeNull()
  })

  it('keeps published versions read-only', () => {
    const data = fixture(); data.draft = null; data.versions[0].status = 'published'; mount(data)
    expect((screen.getByRole('button', { name: 'Add section' }) as HTMLButtonElement).disabled).toBe(true)
    change('Form title', 'Attempted edit')
    expect((screen.getByLabelText('Form title') as HTMLInputElement).value).toBe('Estate intake')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it.each(['buttons', 'pointer'])('reorders items with %s and preserves their stable IDs and invalid conditions', async method => {
    mount()
    if (method === 'buttons') click('Move Relationship down')
    else {
      const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
      fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Relationship' }), { dataTransfer })
      const destination = screen.getByRole('button', { name: 'Select item Your name' })
      fireEvent.dragOver(destination, { dataTransfer }); fireEvent.drop(destination, { dataTransfer })
      expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'marital')
    }
    expect(itemOrder()).toEqual(['Your name', 'Relationship'])
    click('Preview')
    click('Condition field "marital_status" must be available earlier in the form')
    await waitFor(() => expect(document.activeElement?.id).toBe('intake-builder-item-condition'))
    expect(screen.getByRole('button', { name: 'Build' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Item ID') as HTMLInputElement).value).toBe('name')
    expect((screen.getByLabelText('Condition field') as HTMLSelectElement).value).toBe('marital_status')
    click('Move Relationship up')
    expect(itemOrder()).toEqual(['Relationship', 'Your name'])
    expect(screen.queryByRole('button', { name: /must be available earlier/ })).toBeNull()
  })

  it('moves sections by buttons and drag and allows moving items between sections', () => {
    mount(); click('Move Family down')
    expect(screen.getAllByRole('button', { name: /^Select section/ }).map(b => b.textContent)).toEqual(['Review', 'Family'])
    const dataTransfer = { setData: vi.fn() }
    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag section Family' }), { dataTransfer })
    fireEvent.dragOver(screen.getByRole('button', { name: 'Select section Review' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('button', { name: 'Select section Review' }), { dataTransfer })
    expect(screen.getAllByRole('button', { name: /^Select section/ }).map(b => b.textContent)).toEqual(['Family', 'Review'])
    click('Select item Your name'); change('Move to section', 'review')
    expect(within(screen.getByRole('list', { name: 'Review items' })).getByRole('button', { name: 'Select item Your name' })).toBeTruthy()
  })

  it('limits condition fields, operators and approved select values', () => {
    mount(); click('Select item Your name')
    expect(within(screen.getByLabelText('Condition operator')).getAllByRole('option').map(o => o.textContent)).toEqual(['Equals', 'Not equals', 'Is set', 'All', 'Any'])
    expect(within(screen.getByLabelText('Condition field')).getAllByRole('option').map(o => (o as HTMLOptionElement).value)).toEqual(['marital_status'])
    expect(within(screen.getByLabelText('Condition value')).getAllByRole('option').map(o => (o as HTMLOptionElement).value)).toEqual(catalog.fields.find(f => f.id === 'marital_status')!.options!.map(o => o.value))
    change('Condition operator', 'is_set')
    expect(screen.queryByLabelText('Condition value')).toBeNull()
    change('Condition operator', 'all')
    expect(screen.getAllByLabelText('Condition operator')).toHaveLength(2)
    expect((screen.getByRole('button', { name: 'Remove condition 1' }) as HTMLButtonElement).disabled).toBe(true)
    click('Add condition')
    expect(screen.getAllByLabelText('Condition operator')).toHaveLength(3)
  })

  it('offers typed boolean values and excludes multiselect controllers', () => {
    const data = fixture(); const boolean = catalog.fields.find(f => f.control === 'boolean')!; const multi = catalog.fields.find(f => f.control === 'multiselect')!
    data.draft!.definition.sections[0].items.unshift({ kind: 'field', id: 'bool', fieldId: boolean.id }, { kind: 'field', id: 'multi', fieldId: multi.id })
    mount(data); click('Select item Your name'); change('Condition field', boolean.id)
    expect(within(screen.getByLabelText('Condition value')).getAllByRole('option').map(o => (o as HTMLOptionElement).value)).toEqual(['true', 'false'])
    expect(within(screen.getByLabelText('Condition field')).queryByRole('option', { name: multi.label })).toBeNull()
  })

  it('blocks new groups at maximum condition depth', () => {
    const data = fixture()
    data.draft!.definition.sections[0].items[1].condition = { op: 'all', conditions: [{ op: 'any', conditions: [{ op: 'all', conditions: [{ op: 'any', conditions: [{ op: 'is_set', fieldId: 'marital_status' }] }] }] }] }
    mount(data); click('Select item Your name')
    const deepest = screen.getAllByLabelText('Condition operator')[4]
    expect((within(deepest).getByRole('option', { name: 'All' }) as HTMLOptionElement).disabled).toBe(true)
    expect((within(deepest).getByRole('option', { name: 'Any' }) as HTMLOptionElement).disabled).toBe(true)
  })

  it.each(['attorney', 'client', null])('blocks %s before service reads', async role => {
    mocks.role.mockResolvedValue(role)
    await expect(IntakeFormEditorPage({ params: Promise.resolve({ templateId: id }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
  it('blocks malformed IDs before service reads and handles absence versus operational failure', async () => {
    await expect(IntakeFormEditorPage({ params: Promise.resolve({ templateId: 'invalid' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.snapshot).not.toHaveBeenCalled()
    mocks.snapshot.mockResolvedValue(null)
    await expect(IntakeFormEditorPage({ params: Promise.resolve({ templateId: id }) })).rejects.toThrow('NEXT_NOT_FOUND')
    mocks.snapshot.mockRejectedValue(new Error('offline'))
    render(await IntakeFormEditorPage({ params: Promise.resolve({ templateId: id }) }))
    expect(screen.getByRole('link', { name: 'Retry loading form' })).toBeTruthy()
  })
  it('rejects missing authentication and cross-template versions and loads a valid draft', async () => {
    mocks.claims.mockResolvedValue(null)
    await expect(IntakeFormEditorPage({ params: Promise.resolve({ templateId: id }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.snapshot).not.toHaveBeenCalled()
    mocks.claims.mockResolvedValue({ id: 'admin' })
    const bad = fixture(); bad.versions[0].template_id = 'other'
    mocks.snapshot.mockResolvedValue(bad)
    await expect(IntakeFormEditorPage({ params: Promise.resolve({ templateId: id }) })).rejects.toThrow('NEXT_NOT_FOUND')
    mocks.snapshot.mockResolvedValue(fixture())
    render(await IntakeFormEditorPage({ params: Promise.resolve({ templateId: id }) }))
    expect(screen.getByLabelText('Form title')).toBeTruthy()
  })
})
