// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MatterOverviewWork } from '@/app/admin/matters/[id]/MatterOverviewWork'
import { computeMatterNextAction } from '@/lib/matterNextAction'
import type { PipelineMatter } from '@/types/database'
afterEach(cleanup)
const matter = { matter_id: 'm1', stage: 'drafting', practice_area: 'EP', design_status: 'ready', drafts_sent_at: '2026-10-01', intake_status: null } as PipelineMatter
const props = { matter, nextAction: computeMatterNextAction(matter), workSummary: null, reviewFlags: [], unreadCount: 0, uploadCount: 0, signingDate: null, activity: [], onEngagement: vi.fn(), onUploads: vi.fn(), onMessages: vi.fn(), onActivity: vi.fn() }
it('shows one next action without intake sending, readiness percentage or empty attention panels', () => {
  render(<MatterOverviewWork {...props} />)
  expect(screen.getAllByRole('region', { name: 'Next action' })).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Open drafting' }).getAttribute('href')).toBe('/admin/drafting/m1')
  expect(screen.queryByText('Needs attention')).toBeNull()
  expect(screen.queryByText(/Send intake|percent|Operational brief/)).toBeNull()
})
it('routes upload and message work to the existing handlers', async () => {
  render(<MatterOverviewWork {...props} uploadCount={2} unreadCount={1} />)
  await userEvent.click(screen.getByRole('button', { name: 'Review uploads' }))
  await userEvent.click(screen.getByRole('button', { name: 'Read messages' }))
  expect(props.onUploads).toHaveBeenCalledOnce()
  expect(props.onMessages).toHaveBeenCalledOnce()
})
it('includes logged calls in Messages and keeps internal notes separate', async () => {
  const activity = [
    { matter_id: 'm1', actor_id: null, actor_email: null, actor_name: null, id: 'call', event_type: 'note_added', title: 'Call logged', detail: 'Connected with client', metadata: { channel: 'call', type: 'client_comm' }, created_at: '2026-10-07T12:00:00Z' },
    { matter_id: 'm1', actor_id: null, actor_email: null, actor_name: null, id: 'note', event_type: 'note_added', title: 'Private note', detail: 'Internal research', metadata: { type: 'internal' }, created_at: '2026-10-07T11:00:00Z' },
  ] as import('@/types/database').MatterActivity[]
  render(<MatterOverviewWork {...props} activity={activity} />)
  await userEvent.click(screen.getByRole('button', { name: 'Messages' }))
  expect(screen.getByText('Connected with client')).toBeTruthy()
  expect(screen.queryByText('Internal research')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
  expect(screen.getByText('Internal research')).toBeTruthy()
  expect(screen.queryByText('Connected with client')).toBeNull()
})
it('does not invite starting blocked work', () => {
  const summary: import('@/lib/work/recordSummary').RecordWorkSummary = {
    recordType: 'matter', recordId: 'm1', workKey: 'task:blocked', sourceType: 'task', title: 'Prepare trust',
    actionLabel: 'Start task', href: '/admin/tasks/blocked', owner: 'firm', state: 'blocked', priorityBand: 1,
    priorityReasons: [{ code: 'blocked', label: 'Needs attorney decision' }], dueAt: null, estimateMinutes: 30, itemCount: 1, attentionCount: 0,
  }
  render(<MatterOverviewWork {...props} workSummary={summary} />)
  expect(screen.getByText('Blocked')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Review blocker' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Start task' })).toBeNull()
})
it('opens the date editor from the empty milestone state', async () => {
  const onDates = vi.fn()
  render(<MatterOverviewWork {...props} onDates={onDates} />)
  expect(screen.getByText('No milestone scheduled.')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Set date' }))
  expect(onDates).toHaveBeenCalledOnce()
})

it('composes the focus brief, authoritative milestone, communication activity, and summary areas', () => {
  render(<MatterOverviewWork
    {...props}
    details={{ scheduled_signing_date: '2026-11-12' }}
    facts={<p>Read-only matter facts</p>}
    composer={<p>Existing composer</p>}
    tasks={<p>Existing task preview</p>}
  />)

  expect(screen.getByRole('region', { name: 'Matter focus brief' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Matter milestones' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Matter communication and activity' })).toBeTruthy()
  expect(screen.getByRole('complementary', { name: 'Matter summary' })).toBeTruthy()
  expect(screen.getByText('Drafts due')).toBeTruthy()
  expect(screen.getByText(/calculated from target signing/i)).toBeTruthy()
  expect(screen.queryByText('Engaged')).toBeNull()
  expect(screen.getByText('Read-only matter facts')).toBeTruthy()
  expect(screen.getByText('Existing composer')).toBeTruthy()
  expect(screen.getByText('Existing task preview')).toBeTruthy()
  expect(screen.getByRole('complementary', { name: 'Matter summary' }).parentElement?.className).toContain('@min-[960px]/overview:grid-cols')
})
