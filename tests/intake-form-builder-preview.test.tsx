// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntakeFormEditorClient } from '@/app/admin/settings/intake-forms/[templateId]/IntakeFormEditorClient'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormEditorSnapshot } from '@/lib/intake/forms/persistenceTypes'
import { ESTATE_INTAKE_FORM, COLLEGE_PREP_INTAKE_FORM } from '@/lib/intake/forms/definitions'
import { IntakeFormPreview } from '@/app/admin/settings/intake-forms/[templateId]/IntakeFormPreview'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

const auth = vi.hoisted(() => vi.fn(async () => ({ data: { session: null } })))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: auth } } }))
const catalog = getIntakeFormBuilderCatalog()
function fixture(): IntakeFormEditorSnapshot {
  const date = '2026-10-08T12:00:00Z'
  const draft: NonNullable<IntakeFormEditorSnapshot['draft']> = {
    id: 'version-1', template_id: 'template-1', status: 'draft', version: 1, created_by: 'admin', created_at: date,
    updated_at: date, definition_hash: 'hash', lock_version: 1, published_at: null, published_by: null,
    definition: { schemaVersion: 1, key: 'estate', title: 'Estate intake', sections: [
      { id: 'personal', title: 'Personal', audience: 'client_and_staff', items: [
        { kind: 'field', id: 'name', fieldId: 'client_first_name', labelOverride: 'Your first name' },
        { kind: 'field', id: 'marital', fieldId: 'marital_status' },
        { kind: 'field', id: 'has-children', fieldId: 'has_children' },
        { kind: 'block', id: 'address', blockId: 'address' },
      ] },
      { id: 'spouse', title: 'Partner', audience: 'client_and_staff', condition: { op: 'equals', fieldId: 'marital_status', value: 'married' }, items: [{ kind: 'block', id: 'spouse-details', blockId: 'spouse_details' }] },
      { id: 'children', title: 'Family members', audience: 'client_and_staff', condition: { op: 'equals', fieldId: 'has_children', value: true }, items: [{ kind: 'block', id: 'children-list', blockId: 'children' }] },
      { id: 'uploads', title: 'Uploads', audience: 'client_and_staff', items: [{ kind: 'block', id: 'upload-block', blockId: 'existing_document_uploads' }] },
      { id: 'internal', title: 'Internal', audience: 'staff_only', items: [{ kind: 'block', id: 'plan', blockId: 'attorney_plan_structure' }] },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
    ] },
  }
  return { template: { id: 'template-1', key: 'estate', name: 'Estate intake', description: null, created_by: 'admin', created_at: date, updated_at: date, archived_at: null }, draft, versions: [draft], auditEvents: [] }
}
function click(name: string | RegExp) { fireEvent.click(screen.getByRole('button', { name })) }
function mount(data = fixture()) { render(<IntakeFormEditorClient initialSnapshot={data} catalog={catalog} />) }
async function scenario(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Sample scenario' }))
  await userEvent.click(screen.getByRole('option', { name }))
}
function preview() { return within(screen.getByRole('region', { name: 'Form preview' })) }

describe('intake form preview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
  })
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('previews the unsaved title and section order immediately and preserves edits on returning to Build', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Form title'), { target: { value: 'Local draft title' } })
    click('Move Uploads down'); click('Move Uploads down'); click('Preview')
    expect(preview().getByRole('heading', { name: 'Local draft title' })).toBeTruthy()
    expect(preview().getAllByRole('heading', { level: 2 }).map(heading => heading.getAttribute('aria-label') ?? heading.textContent)).toEqual(['Local draft title', 'Personal', 'Review', 'Uploads'])
    click('Build')
    expect((screen.getByLabelText('Form title') as HTMLInputElement).value).toBe('Local draft title')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('evaluates fresh synthetic scenarios and audience visibility without changing the form', async () => {
    mount(); click('Preview')
    expect(preview().queryByRole('heading', { name: 'Partner' })).toBeNull()
    expect(preview().queryByRole('heading', { name: 'Family members' })).toBeNull()
    await scenario('Single')
    expect((preview().getByLabelText('Your first name') as HTMLInputElement).value).toBe('Jordan')
    await userEvent.type(preview().getByLabelText('Your first name'), 'Changed')
    await scenario('Married')
    expect(preview().getByRole('heading', { name: 'Partner' })).toBeTruthy()
    expect(preview().queryByRole('heading', { name: 'Family members' })).toBeNull()
    await scenario('Family with children')
    expect(preview().getByRole('heading', { name: 'Family members' })).toBeTruthy()
    expect(preview().queryByRole('heading', { name: 'Internal' })).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'Staff' }))
    click(/Internal/)
    const choice = preview().getByRole('button', { name: /Joint Revocable Living Trust/ })
    expect(choice.matches(':disabled')).toBe(true)
    await userEvent.click(choice)
    await userEvent.click(screen.getByRole('tab', { name: 'Client' }))
    expect(preview().queryByRole('heading', { name: 'Internal' })).toBeNull()
    await scenario('Empty')
    expect(preview().queryByRole('heading', { name: 'Partner' })).toBeNull()
    expect(preview().queryByRole('heading', { name: 'Family members' })).toBeNull()
    expect(screen.getByText('No unsaved changes')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled()
  })

  it('keeps every answer and compound affordance inert, including review and uploads, without auth or network', async () => {
    mount(); click('Preview'); await scenario('Family with children')
    for (const audience of ['Client', 'Staff']) {
      await userEvent.click(screen.getByRole('tab', { name: audience }))
      const headings = preview().getAllByRole('heading', { level: 2 }).slice(1)
      for (const heading of headings) {
        const button = within(heading).getByRole('button')
        if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button)
        const content = document.getElementById(button.getAttribute('aria-controls')!)!
        for (const control of content.querySelectorAll('input, select, textarea, button')) {
          expect(control.matches(':disabled')).toBe(true)
          await userEvent.click(control as HTMLElement)
        }
        expect(within(content).queryAllByRole('link')).toHaveLength(0)
      }
    }
    expect(preview().queryByRole('button', { name: /Download a copy/ })).toBeNull()
    expect(fetch).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled()
  })

  it('shows diagnostics instead of a partial form for invalid unsaved state', () => {
    mount(); fireEvent.change(screen.getByLabelText('Form title'), { target: { value: '' } }); click('Preview')
    expect(preview().getByRole('alert')).toBeTruthy()
    expect(preview().queryByLabelText('Your first name')).toBeNull()
    expect(screen.getByRole('region', { name: 'Form checks' }).textContent).toMatch(/title/i)
    expect(fetch).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled()
  })

  it('supports keyboard audience selection and returns focus after dismissing the scenario picker', async () => {
    mount(); click('Preview')
    const scenarios = screen.getByRole('combobox', { name: 'Sample scenario' })
    await userEvent.click(scenarios)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(scenarios))
    const client = screen.getByRole('tab', { name: 'Client' })
    client.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Staff' }).getAttribute('aria-selected')).toBe('true'))
    expect(preview().getByRole('heading', { name: 'Internal' })).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled()
  })

  it.each([ESTATE_INTAKE_FORM, COLLEGE_PREP_INTAKE_FORM])('disables the bundled $key controls and preserves navigation without network capabilities', async definition => {
    const data = fixture(); data.draft!.definition = structuredClone(definition)
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined)
    mount(data); click('Preview'); await scenario('Family with children')
    await userEvent.click(screen.getByRole('tab', { name: 'Staff' }))
    const headings = preview().getAllByRole('heading', { level: 2 }).slice(1)
    for (const heading of headings) {
      const button = within(heading).getByRole('button')
      if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button)
      const content = document.getElementById(button.getAttribute('aria-controls')!)!
      for (const control of content.querySelectorAll('input, select, textarea, button')) {
        expect(control.matches(':disabled')).toBe(true)
        await userEvent.click(control as HTMLElement)
      }
      expect(within(content).queryAllByRole('link')).toHaveLength(0)
    }
    expect(fetch).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled()
    xhr.mockRestore()
  })

  it('reviews only current compiled sections and items, in local order, with evaluated requirements and sample answers', async () => {
    const definition: IntakeFormDefinition = { schemaVersion: 1, key: 'custom_review', title: 'Custom organizer', sections: [
      { id: 'notes', title: 'Local notes', audience: 'client_and_staff', items: [{ id: 'notes-item', kind: 'field', fieldId: 'special_notes', labelOverride: 'Your priorities', requirement: 'required' }] },
      { id: 'identity', title: 'Local identity', audience: 'client_and_staff', items: [{ id: 'last', kind: 'field', fieldId: 'client_last_name', labelOverride: 'Family name' }, { id: 'first', kind: 'field', fieldId: 'client_first_name', labelOverride: 'Given name' }] },
      { id: 'final', title: 'Local review', audience: 'client_and_staff', items: [{ id: 'check', kind: 'block', blockId: 'review_submit' }] },
    ] }
    const { rerender } = render(<IntakeFormPreview localDefinition={definition} />)
    await scenario('Single'); click(/Local review/)
    const review = within(screen.getByRole('region', { name: 'Current form review' }))
    expect(review.getAllByRole('heading', { level: 4 }).map(node => node.textContent)).toEqual(['Local notes', 'Local identity'])
    expect(review.getByText("Answer anything else you'd like us to know?.")).toBeTruthy()
    expect(review.queryByText('Personal Information')).toBeNull()
    expect(review.getAllByRole('textbox').map(node => node.getAttribute('aria-label') ?? node.id)).toHaveLength(3)
    expect((review.getByLabelText('Given name') as HTMLInputElement).value).toBe('Jordan')
    expect(review.getByLabelText('Given name').matches(':disabled')).toBe(true)
    const changed = structuredClone(definition)
    changed.sections = [changed.sections[1], changed.sections[0], changed.sections[2]]
    changed.sections[0].items = [changed.sections[0].items[1]]
    const notes = changed.sections[1].items[0]
    if (notes.kind === 'field') notes.requirement = 'optional'
    rerender(<IntakeFormPreview localDefinition={changed} />)
    expect(review.getAllByRole('heading', { level: 4 }).map(node => node.textContent)).toEqual(['Local identity', 'Local notes'])
    expect(review.queryByLabelText('Family name')).toBeNull()
    expect(review.queryByText("Answer anything else you'd like us to know?.")).toBeNull()
    changed.sections = changed.sections.filter(section => section.id !== 'notes')
    rerender(<IntakeFormPreview localDefinition={{ ...changed }} />)
    expect(review.queryByText('Local notes')).toBeNull()
    expect(fetch).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled()
  })
})
