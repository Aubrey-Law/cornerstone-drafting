// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanonicalFieldItem, type CanonicalFieldRenderItem } from '@/components/intake/formEngine/CanonicalFieldItem'

afterEach(cleanup)

function item(fieldId: CanonicalFieldRenderItem['fieldId'], extra: Partial<CanonicalFieldRenderItem> = {}): CanonicalFieldRenderItem {
  return { kind: 'field', fieldId, effectiveRequirement: 'optional', ...extra }
}

describe('canonical scalar field item', () => {
  it('labels the county select and writes the canonical county key', async () => {
    const update = vi.fn()
    render(<CanonicalFieldItem item={item('county', { label: 'County of residence', helpText: 'Choose your Massachusetts county.', effectiveRequirement: 'required' })} data={{ county: '' }} update={update} />)
    const select = screen.getByRole('combobox', { name: 'County of residence' }) as HTMLSelectElement
    expect(select.required).toBe(true)
    expect(select.getAttribute('aria-describedby')).toBe(screen.getByText('Choose your Massachusetts county.').id)
    await userEvent.selectOptions(select, 'Suffolk')
    expect(update).toHaveBeenCalledWith('county', 'Suffolk')
  })

  it('toggles a real boolean and writes a narrative through its adapter', async () => {
    const update = vi.fn()
    render(<><CanonicalFieldItem item={item('has_existing_plan')} data={{ has_existing_plan: false }} update={update} /><CanonicalFieldItem item={item('special_notes')} data={{ special_notes: '' }} update={update} /></>)
    await userEvent.click(screen.getByRole('checkbox', { name: /existing estate plan/i }))
    expect(update).toHaveBeenCalledWith('has_existing_plan', true)
    const notes = screen.getByRole('textbox', { name: /Anything else/ })
    expect(notes.tagName).toBe('TEXTAREA')
    fireEvent.change(notes, { target: { value: '  Please discuss trusts.  ' } })
    expect(update).toHaveBeenCalledWith('special_notes', '  Please discuss trusts.  ')
  })

  it('adds and removes multiselect options without losing existing values', async () => {
    const writes: [string, unknown][] = []
    function Controlled() {
      const [data, setData] = React.useState<Record<string, unknown>>({ planning_goals: ['avoid_probate', 'retired_goal'] })
      return <CanonicalFieldItem item={item('planning_goals')} data={data} update={(key, value) => { writes.push([key, value]); setData((old) => ({ ...old, [key]: value })) }} />
    }
    render(<Controlled />)
    expect(screen.getByRole('group', { name: /Estate Planning Goals/ })).toBeDefined()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Protect my children' }))
    expect(writes.at(-1)).toEqual(['planning_goals', ['avoid_probate', 'retired_goal', 'protect_children']])
    await userEvent.click(screen.getByRole('checkbox', { name: 'Avoid probate' }))
    expect(writes.at(-1)).toEqual(['planning_goals', ['retired_goal', 'protect_children']])
  })

  it('shows a retired estate range as its selected disabled option', () => {
    render(<CanonicalFieldItem item={item('estate_value')} data={{ estate_value: 'under_2m' }} update={() => undefined} />)
    const option = screen.getByRole('option', { name: 'Under $2 million' }) as HTMLOptionElement
    expect(option.selected).toBe(true)
    expect(option.disabled).toBe(true)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('under_2m')
  })

  it('keeps an existing Other citizenship status visible and selected', () => {
    render(<CanonicalFieldItem item={item('client_citizenship')} data={{ citizenship_status: 'other', is_us_citizen: null }} update={() => undefined} />)
    const option = screen.getByRole('option', { name: 'Other' }) as HTMLOptionElement
    expect(option.selected).toBe(true)
    expect(option.disabled).toBe(true)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('Other')
  })

  it('renders empty selects without implicitly showing the first answer', () => {
    render(<CanonicalFieldItem item={item('county')} data={{}} update={() => undefined} />)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
  })

  it('disables controls and prevents updates', async () => {
    const update = vi.fn()
    render(<CanonicalFieldItem item={item('has_existing_plan')} data={{}} update={update} disabled />)
    const control = screen.getByRole('checkbox') as HTMLInputElement
    expect(control.disabled).toBe(true)
    await userEvent.click(control)
    expect(update).not.toHaveBeenCalled()
  })

  it('allows false as an answer to a required boolean question', () => {
    render(<CanonicalFieldItem item={item('has_children', { effectiveRequirement: 'required' })} data={{ has_children: false }} update={() => undefined} />)
    const control = screen.getByRole('checkbox') as HTMLInputElement
    expect(control.checked).toBe(false)
    expect(control.checkValidity()).toBe(true)
    expect(control.getAttribute('aria-required')).toBe('true')
  })

  it('preserves spaces during narrative entry and normalizes on blur', async () => {
    const writes: unknown[] = []
    function Controlled() {
      const [data, setData] = React.useState<Record<string, unknown>>({ special_notes: '' })
      return <CanonicalFieldItem item={item('special_notes')} data={data} update={(key, value) => { writes.push(value); setData((old) => ({ ...old, [key]: value })) }} />
    }
    render(<Controlled />)
    const notes = screen.getByRole('textbox') as HTMLTextAreaElement
    await userEvent.type(notes, '  Please discuss trusts.  ')
    expect(notes.value).toBe('  Please discuss trusts.  ')
    await userEvent.tab()
    expect(notes.value).toBe('Please discuss trusts.')
    expect(writes.at(-1)).toBe('Please discuss trusts.')
  })
})
