// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/lib/intake/forms/definitions', () => { throw new Error('Broken compiled definition') })
vi.mock('@/lib/intake/forms/evaluator', () => { throw new Error('Broken compiled evaluator') })
vi.mock('@/lib/supabaseServer', () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'client' } } }) } }) }))
vi.mock('@/lib/intake/getOrCreateClientIntake', () => ({ getOrCreateClientIntakeForUser: async () => ({ id: 'intake', status: 'draft', first_name: 'Jane' }) }))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: async (_db: unknown, row: unknown) => row }))
vi.mock('@/components/intake/LegacyGuidedInterview', () => ({ default: ({ initialData }: { initialData: Record<string, unknown> }) => <p>Legacy intake for {String(initialData.first_name)}</p>, ReviewModal: () => null }))

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

it('imports the actual page and dispatches legacy mode even when compiled modules cannot initialize', async () => {
  vi.stubEnv('INTAKE_RENDERER_MODE', 'legacy')
  const { default: Page } = await import('@/app/intake/(shell)/page')
  render(await Page({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText('Legacy intake for Jane')).toBeTruthy()
})

it('fails closed in compiled mode if compilation is unavailable', async () => {
  vi.stubEnv('INTAKE_RENDERER_MODE', 'compiled')
  const { default: Page } = await import('@/app/intake/(shell)/page')
  render(await Page({ searchParams: Promise.resolve({}) }))
  expect(screen.getByRole('alert').textContent).toContain('temporarily unavailable')
  expect(screen.queryByText('Legacy intake for Jane')).toBeNull()
})
