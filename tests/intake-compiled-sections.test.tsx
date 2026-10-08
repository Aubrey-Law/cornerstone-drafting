// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompiledIntakeSections } from '@/components/intake/formEngine/CompiledIntakeSections'
import { GuidedSection } from '@/components/intake/GuidedSection'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

afterEach(cleanup)

const definition: IntakeFormDefinition = {
  schemaVersion: 1, key: 'renderer-test', title: 'Test intake', sections: [
    { id: 'personal', title: 'Personal Information', subtitle: 'Tell us about yourself', timeEstimateMinutes: 3, audience: 'client_and_staff', items: [
      { kind: 'field', id: 'name', fieldId: 'client_first_name', labelOverride: 'First name', helpText: 'Use your legal first name.' },
      { kind: 'field', id: 'marital', fieldId: 'marital_status', labelOverride: 'Marital status' },
      { kind: 'block', id: 'address', blockId: 'address', titleOverride: 'Home address', helpText: 'Where you live.', config: { includeCounty: false } },
      { kind: 'field', id: 'spouse-notes', fieldId: 'special_notes', labelOverride: 'Spouse notes', condition: { op: 'equals', fieldId: 'marital_status', value: 'married' } },
    ] },
    { id: 'spouse', title: 'Spouse Information', audience: 'client_and_staff', condition: { op: 'equals', fieldId: 'marital_status', value: 'married' }, items: [{ kind: 'block', id: 'spouse-details', blockId: 'spouse_details' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review-submit', blockId: 'review_submit' }] },
  ],
}

function fixture(data: Record<string, unknown> = {}, source = definition) {
  const compiled = compileIntakeForm(source, 'staff')
  if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
  return { form: compiled.form, evaluation: evaluateCompiledIntakeForm(compiled.form, data), data }
}

describe('compiled intake sections', () => {
  it('renders only evaluated sections/items with canonical copy, block configuration and estimates', () => {
    render(<CompiledIntakeSections {...fixture()} update={vi.fn()} openId="personal" onToggle={vi.fn()} onContinue={vi.fn()} showProgress />)
    expect(screen.getByRole('heading', { name: 'Personal Information' })).toBeDefined()
    const name = screen.getByLabelText('First name') as HTMLInputElement
    expect(name.disabled).toBe(false)
    expect(name.getAttribute('aria-describedby')).toBe(screen.getByText('Use your legal first name.').id)
    expect(screen.getByRole('heading', { name: 'Home address' })).toBeDefined()
    expect(screen.getByText('Where you live.')).toBeDefined()
    expect(screen.getByLabelText('Street Address')).toBeDefined()
    expect(screen.queryByText('County')).toBeNull()
    expect(screen.queryByText('Spouse Information')).toBeNull()
    expect(screen.queryByLabelText('Spouse notes')).toBeNull()
    expect(screen.getByText('Tell us about yourself · ~3 min')).toBeDefined()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect(screen.getByText('0 of 1 done · ~3 min remaining')).toBeDefined()
  })

  it('trusts the supplied evaluation for issues, active content and progress', () => {
    const props = fixture({ first_name: 'Answered', marital_status: 'married' })
    props.evaluation.activeSections = props.evaluation.activeSections.filter((section) => section.id !== 'spouse')
    props.evaluation.activeSections[0].items = props.evaluation.activeSections[0].items.filter((entry) => entry.id !== 'spouse-notes')
    props.evaluation.activeSections[0].issues = [{ sectionId: 'personal', sectionTitle: 'Personal Information', message: 'Evaluated warning', severity: 'warning' }]
    props.evaluation.percentComplete = 42
    props.evaluation.remainingMinutes = 9
    render(<CompiledIntakeSections {...props} update={vi.fn()} openId="personal" onToggle={vi.fn()} onContinue={vi.fn()} showProgress />)
    expect(within(screen.getByRole('status')).getByText('Evaluated warning')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Spouse Information')).toBeNull()
    expect(screen.queryByLabelText('Spouse notes')).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42')
    expect(screen.getByText(/~9 min remaining/)).toBeDefined()
  })

  it('exposes errors as alerts only while validation is shown', () => {
    const props = fixture()
    const view = render(<CompiledIntakeSections {...props} update={vi.fn()} openId="personal" onToggle={vi.fn()} onContinue={vi.fn()} />)
    expect(within(screen.getByRole('alert')).getByText('Enter your first name.')).toBeDefined()
    view.rerender(<CompiledIntakeSections {...props} update={vi.fn()} openId="personal" onToggle={vi.fn()} onContinue={vi.fn()} showValidation={false} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('writes client and public-link answers through the canonical adapter', async () => {
    const update = vi.fn()
    const props = fixture()
    const view = render(<CompiledIntakeSections {...props} update={update} mode="public_link" openId="personal" onToggle={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } })
    expect(update).toHaveBeenLastCalledWith('first_name', 'Jane')
    view.rerender(<CompiledIntakeSections {...props} update={update} mode="client" openId="personal" onToggle={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText(/Marital status/), 'married')
    expect(update).toHaveBeenLastCalledWith('marital_status', 'married')
  })

  it('keeps navigation interactive while staff client controls are truly disabled', async () => {
    const update = vi.fn()
    const toggle = vi.fn()
    const next = vi.fn()
    render(<CompiledIntakeSections {...fixture()} update={update} mode="attorney" openId="personal" onToggle={toggle} onContinue={next} />)
    const name = screen.getByLabelText('First name') as HTMLInputElement
    const street = screen.getByLabelText('Street Address') as HTMLInputElement
    expect(name.disabled).toBe(true)
    expect(street.matches(':disabled')).toBe(true)
    await userEvent.type(name, 'Jane')
    fireEvent.change(street, { target: { value: '1 Main St' } })
    expect(update).not.toHaveBeenCalled()
    const sectionToggle = screen.getByRole('button', { name: /Personal Information/ })
    expect(sectionToggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(sectionToggle.getAttribute('aria-controls')!)).toBeDefined()
    sectionToggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveBeenCalledWith('personal')
    await userEvent.click(screen.getByRole('button', { name: /Continue to next section/ }))
    expect(next).toHaveBeenCalledWith('personal', 'review')
  })

  it('numbers active sections, navigates in evaluated order, and has no final continue button', async () => {
    const props = fixture({ marital_status: 'married' })
    const next = vi.fn()
    const view = render(<CompiledIntakeSections {...props} update={vi.fn()} openId="personal" onToggle={vi.fn()} onContinue={next} />)
    await userEvent.click(screen.getByRole('button', { name: /Continue to next section/ }))
    expect(next).toHaveBeenCalledWith('personal', 'spouse')
    view.rerender(<CompiledIntakeSections {...props} update={vi.fn()} openId="" onToggle={vi.fn()} onContinue={next} />)
    expect(screen.getByRole('button', { name: /2 Spouse Information/ })).toBeDefined()
    view.rerender(<CompiledIntakeSections {...props} update={vi.fn()} openId="review" onToggle={vi.fn()} onContinue={next} />)
    expect(screen.queryByRole('button', { name: /Continue to next section/ })).toBeNull()
  })

  it('allows staff-only attorney controls through their dedicated persistence adapter', async () => {
    const source: IntakeFormDefinition = { ...definition, sections: [
      { id: 'plan', title: 'Attorney plan', audience: 'staff_only', items: [{ kind: 'block', id: 'plan-choice', blockId: 'attorney_plan_structure' }] },
      definition.sections[2],
    ] }
    const save = vi.fn(async () => undefined)
    const update = vi.fn()
    render(<CompiledIntakeSections {...fixture({}, source)} update={update} mode="staff" openId="plan" onToggle={vi.fn()} onContinue={vi.fn()} onAttorneySave={save} />)
    await userEvent.click(screen.getByRole('button', { name: /Joint Revocable Living Trust/ }))
    expect(save).toHaveBeenCalledWith({ plan_type: 'joint_rlt' })
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves existing GuidedSection navigation and stable disclosure identifiers', async () => {
    const toggle = vi.fn()
    const next = vi.fn()
    const view = render(<GuidedSection number={1} title="Legacy section" complete={false} open onToggle={toggle} onContinue={next}><input aria-label="Legacy answer" /></GuidedSection>)
    const button = screen.getByRole('button', { name: /Legacy section/ })
    const controls = button.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Legacy section' }).style.margin).toBe('0px')
    expect(document.getElementById(controls!)?.contains(screen.getByLabelText('Legacy answer'))).toBe(true)
    await userEvent.click(button)
    expect(toggle).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: /Continue to next section/ }))
    expect(next).toHaveBeenCalledOnce()
    view.rerender(<GuidedSection number={1} title="Legacy section" complete={false} open={false} onToggle={toggle} />)
    expect(screen.getByRole('button', { name: /Legacy section/ }).getAttribute('aria-controls')).toBe(controls)
    expect(screen.queryByLabelText('Legacy answer')).toBeNull()
  })
})
