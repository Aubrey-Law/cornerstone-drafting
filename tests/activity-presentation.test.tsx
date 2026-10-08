// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { activityFilters } from '@/lib/activities/feed'
import { activityTypeDetail } from '@/lib/activities/presentation'
import { AppliedActivityFilters } from '@/app/admin/crm/activities/AppliedActivityFilters'
import { ActivityFilters } from '@/app/admin/crm/activities/ActivityFilters'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => null }))
afterEach(cleanup)

it('removes one applied filter while preserving the others and resetting pagination', () => {
  const filters = activityFilters({ source: 'matter', event: 'task_created', from: '2026-10-01' })
  filters.cursor = { at: '2026-10-07T12:00:00Z', id: 'matter:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  render(<AppliedActivityFilters filters={filters} />)
  const href = screen.getByRole('link', { name: 'Remove event filter' }).getAttribute('href')!
  const params = new URL(href, 'http://localhost').searchParams
  expect(params.get('source')).toBe('matter')
  expect(params.get('from')).toBe('2026-10-01')
  expect(params.has('event')).toBe(false)
  expect(params.has('cursor')).toBe(false)
})

it('does not duplicate the selected event option', () => {
  render(<ActivityFilters filters={activityFilters({ event: 'task_created' })} />)
  const select = screen.getByRole('combobox', { name: 'Event type' })
  expect(within(select).getAllByRole('option').filter(option => (option as HTMLOptionElement).value === 'task_created')).toHaveLength(1)
})

it('preserves an unknown event filter from a bookmark', () => {
  render(<ActivityFilters filters={activityFilters({ event: 'custom_event' })} />)
  expect((screen.getByRole('combobox', { name: 'Event type' }) as HTMLSelectElement).value).toBe('custom_event')
  expect(screen.getByRole('option', { name: 'Custom event' })).toBeTruthy()
})

it('hides only redundant event labels without discarding distinct context', () => {
  expect(activityTypeDetail({ event_type: 'opportunity_created', summary: 'Opportunity created' })).toBeNull()
  expect(activityTypeDetail({ event_type: 'task_created', summary: 'Prepare trust documents' })).toBe('Task added')
})
