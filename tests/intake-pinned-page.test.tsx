// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Page from '@/app/intake/(shell)/page'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'

const state = vi.hoisted(() => ({
  row: { id: 'intake', status: 'draft', form_version_id: 'pinned-1', intake_track: 'college_prep' } as Record<string, unknown>,
  version: vi.fn(),
  intake: vi.fn(),
  props: vi.fn(),
}))
vi.mock('@/lib/supabaseServer', () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'client' } } }) } }) }))
vi.mock('@/app/intake/(shell)/OtherFormsNotice', () => ({ OtherFormsNotice: () => null, countOtherOpenForms: async () => 0 }))
vi.mock('@/lib/intake/getOrCreateClientIntake', () => ({ getOrCreateClientIntakeForUser: state.intake }))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: async (_db: unknown, row: object) => ({ ...row, form_version_id: 'hydration-must-not-select-version' }) }))
vi.mock('@/lib/intake/forms/repository', () => ({ getVersionRow: state.version, getTemplateRow: async () => ({ key: 'custom_form' }) }))
vi.mock('@/components/intake/GuidedInterview', () => ({ default: (props: { rendererMode: string; compiledForm?: CompiledIntakeForm }) => {
  state.props(props)
  return <p>{props.compiledForm?.title ?? 'Legacy questionnaire'}</p>
} }))

beforeEach(() => {
  state.row = { id: 'intake', status: 'draft', form_version_id: 'pinned-1', intake_track: 'college_prep' }
  state.intake.mockReset().mockImplementation(async () => state.row)
  state.props.mockReset()
  state.version.mockReset().mockResolvedValue({ template_id: 'template', status: 'published', definition: {
    schemaVersion: 1, key: 'custom_form', title: 'Pinned custom questionnaire', sections: [
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
      { id: 'private', title: 'Private staff section', audience: 'staff_only', items: [{ kind: 'block', id: 'plan', blockId: 'attorney_plan_structure' }] },
    ],
  } })
  vi.stubEnv('INTAKE_RENDERER_MODE', 'legacy')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

it('delivers the authorized stored pin in rollback mode without staff metadata', async () => {
  render(await Page({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText('Pinned custom questionnaire')).toBeTruthy()
  expect(state.version).toHaveBeenCalledWith('pinned-1')
  expect(state.props.mock.calls[0][0]).toMatchObject({ rendererMode: 'compiled' })
  expect(JSON.stringify(state.props.mock.calls[0][0].compiledForm)).not.toContain('Private staff section')
})

it('shows an unavailable message instead of substituting legacy content', async () => {
  state.version.mockResolvedValue(null)
  render(await Page({ searchParams: Promise.resolve({}) }))
  expect(screen.getByRole('alert').textContent).toContain('temporarily unavailable')
  expect(state.props).not.toHaveBeenCalled()
})

it('keeps unpinned legacy delivery independent of the persistent repository', async () => {
  state.row.form_version_id = null
  render(await Page({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText('Legacy questionnaire')).toBeTruthy()
  expect(state.version).not.toHaveBeenCalled()
})

it('resolves the selected linked questionnaire using its own stored pin', async () => {
  const id = '10000000-0000-4000-8000-000000000001'
  state.row.id = id
  render(await Page({ searchParams: Promise.resolve({ id }) }))
  expect(state.intake).toHaveBeenCalledWith(expect.anything(), { id: 'client' }, id)
  expect(state.version).toHaveBeenCalledWith('pinned-1')
  expect(state.props.mock.calls[0][0].intakeId).toBe(id)
})
