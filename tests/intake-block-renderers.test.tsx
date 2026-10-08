// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTAKE_BLOCK_RENDERERS } from '@/components/intake/formEngine/blockRenderers'
import { INTAKE_BLOCK_REGISTRY } from '@/lib/intake/forms/blockRegistry'
import { DEFAULT_FIDUCIARY_ENTRY, StepEstate, StepGoals } from '@/components/intake/IntakeWizard'

// Picker controls read contacts on mount. Stub only that external database boundary.
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return chain
  } },
}))

afterEach(cleanup)

describe('canonical block renderers', () => {
  it('has a renderer for every approved registry block', () => {
    expect(Object.keys(INTAKE_BLOCK_RENDERERS).sort()).toEqual(Object.keys(INTAKE_BLOCK_REGISTRY).sort())
  })

  it('edits hydrated spouse fields without dropping the contact identity', () => {
    const update = vi.fn()
    const Block = INTAKE_BLOCK_RENDERERS.spouse_details
    render(<Block data={{ _spouse: { id: 'matter-spouse', first_name: 'Pat', last_name: 'Example' } }} update={update} />)
    fireEvent.change(screen.getByDisplayValue('Pat'), { target: { value: 'Patricia' } })
    expect(update).toHaveBeenCalledWith('_spouse', { id: 'matter-spouse', first_name: 'Patricia', last_name: 'Example' })
  })

  it('edits hydrated children without dropping membership or other child answers', () => {
    const update = vi.fn()
    const Block = INTAKE_BLOCK_RENDERERS.children
    render(<Block data={{ _children: [{ id: 'matter-child', first_name: 'Lee', last_name: 'Example', date_of_birth: '2018-01-01', relationship: 'adopted' }] }} update={update} />)
    fireEvent.change(screen.getByDisplayValue('Lee'), { target: { value: 'Leigh' } })
    expect(update).toHaveBeenCalledWith('_children', [expect.objectContaining({ id: 'matter-child', first_name: 'Leigh', relationship: 'adopted', date_of_birth: '2018-01-01' })])
  })

  it('keeps financial block storage keys fixed and leaves estate value to the scalar item', () => {
    const update = vi.fn()
    const Block = INTAKE_BLOCK_RENDERERS.financial_assets
    render(<Block data={{ asset_types: [] }} update={update} />)
    expect(screen.queryByText('Estimated Total Estate Value')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /Real Estate/ }))
    expect(update).toHaveBeenCalledWith('asset_types', ['real_estate'])
  })

  it('renders the college HIPAA list independently from agent pickers', () => {
    const update = vi.fn()
    const Block = INTAKE_BLOCK_RENDERERS.college_hipaa_recipients
    render(<Block data={{ college_hipaa_recipients: [{ id: 'r1', name: 'Alma Example', relationship: 'Mother', phone: '', email: '' }] }} update={update} />)
    expect(screen.queryByText('Financial and legal agent')).toBeNull()
    fireEvent.change(screen.getByDisplayValue('Alma Example'), { target: { value: 'Alma Jones' } })
    expect(update).toHaveBeenCalledWith('college_hipaa_recipients', [expect.objectContaining({ id: 'r1', name: 'Alma Jones', relationship: 'Mother' })])
  })

  it('keeps a hydrated guardian contact ID while editing its details', async () => {
    const update = vi.fn()
    const Block = INTAKE_BLOCK_RENDERERS.guardian
    const entry = { ...DEFAULT_FIDUCIARY_ENTRY, contact_id: 'matter-guardian', first_name: 'Pat', last_name: 'Example', priority: 1 }
    render(<Block data={{ _fid_guardian_client: [entry] }} update={update} intakeId="intake-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add contact' })).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    fireEvent.change(screen.getByDisplayValue('Pat'), { target: { value: 'Patricia' } })
    expect(update).toHaveBeenCalledWith('_fid_guardian_client', [expect.objectContaining({ contact_id: 'matter-guardian', first_name: 'Patricia', priority: 1 })])
  })

  it('preserves the legacy estate and goals compositions', () => {
    const update = vi.fn()
    const estate = render(<StepEstate data={{ estate_value: 'under_500k', asset_types: [] }} update={update} />)
    expect(screen.getByText('Estimated Total Estate Value')).toBeDefined()
    expect(screen.getByText('What types of assets do you own?')).toBeDefined()
    estate.unmount()
    render(<StepGoals data={{ planning_objectives: { why_now: 'Peace of mind' }, planning_goals: ['avoid_probate'], special_notes: 'Discuss property' }} update={update} />)
    expect(screen.getByDisplayValue('Peace of mind')).toBeDefined()
    expect(screen.getByRole('button', { name: /Avoid probate/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Do you have a will, trust, or other estate planning document?')).toBeDefined()
    expect(screen.getByDisplayValue('Discuss property')).toBeDefined()
  })

  it('keeps attorney document changes in the dedicated attorney adapter', () => {
    const update = vi.fn()
    const onAttorneySave = vi.fn(async () => undefined)
    const Block = INTAKE_BLOCK_RENDERERS.attorney_documents
    render(<Block data={{ document_inclusions: { trust: true, deed: false, will: false } }} update={update} onAttorneySave={onAttorneySave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deed' }))
    expect(onAttorneySave).toHaveBeenCalledWith({ document_inclusions: { trust: true, deed: true, will: false } })
    expect(update).not.toHaveBeenCalled()
  })
})
