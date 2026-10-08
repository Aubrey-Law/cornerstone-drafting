// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskPresentationView, TaskPresentationSwitch } from '@/components/tasks/TaskPresentation'
import { MatterWorkspaceNav } from '@/components/matter/MatterWorkspaceNav'
import { matterWorkspaceHref, matterIdFromPath } from '@/lib/matters/workspace'
import { parseTaskView } from '@/lib/matterPageTabs'
import { parseTaskPresentation } from '@/lib/tasks/presentation'
import { matterPageParams } from '@/lib/matters/pageParams'
import { taskFixture } from './fixtures/task'
afterEach(cleanup)
const matterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
it('keeps plan mode independent of presentation and accepts grid pagination', () => {
  expect(parseTaskView('plan')).toBe('plan')
  expect(parseTaskView('queue')).toBe('queue')
  expect(parseTaskPresentation('table')).toBe('table')
  expect(parseTaskPresentation('plan')).toBe('list')
  const page = matterPageParams({ view: 'grid', search: 'Smith', page: '2' })
  expect(page.view).toBe('grid')
  expect(page.page).toBe(2)
  expect(page.filters.search).toBe('Smith')
})
it('offers exactly three presentations', () => {
  const change = vi.fn()
  render(<TaskPresentationSwitch value="list" onChange={change} />)
  expect(screen.getAllByRole('button')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'Board' }))
  expect(change).toHaveBeenCalledWith('board')
})
it('shows blocked and done rows in their columns and excludes archived tasks', () => {
  const onStatus = vi.fn()
  const tasks = [taskFixture({ id: 'a', title: 'Call', status: 'blocked' }), taskFixture({ id: 'b', title: 'File', status: 'done' }), taskFixture({ id: 'c', title: 'Archived', status: 'archived' })]
  render(<TaskPresentationView tasks={tasks} presentation="board" onStatus={onStatus} />)
  expect(within(screen.getByRole('heading', { name: 'Blocked · 1' }).closest('section')!).getByText('Call')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Done · 1' })).toBeInTheDocument()
  expect(screen.queryByText('Archived')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Status for Call' }), { target: { value: 'in_progress' } })
  expect(onStatus).toHaveBeenCalledWith(tasks[0], 'in_progress')
})
it('opens the original task from table and respects mutation pending state', () => {
  const task = taskFixture({ id: 'a', title: 'Prepare trust' })
  const onOpen = vi.fn()
  render(<TaskPresentationView tasks={[task]} presentation="table" onOpen={onOpen} onStatus={vi.fn()} isPending={() => true} />)
  fireEvent.click(screen.getByRole('button', { name: task.title }))
  expect(onOpen).toHaveBeenCalledWith(task)
  expect(screen.getByRole('combobox')).toBeDisabled()
})
it('uses existing drafting routes and shows every workspace section in one row', () => {
  render(<MatterWorkspaceNav matterId={matterId} active="drafting" />)
  expect(screen.getByRole('link', { name: 'Drafting' })).toHaveAttribute('href', `/admin/drafting/${matterId}`)
  expect(screen.getByRole('link', { name: 'Drafting' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Reviews' })).toHaveAttribute('href', matterWorkspaceHref(matterId, 'reviews'))
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', matterWorkspaceHref(matterId, 'activity'))
  expect(matterIdFromPath(`/admin/drafting/${matterId}/design`)).toBe(matterId)
  expect(matterIdFromPath('/admin/drafting/real-estate-transfer')).toBeUndefined()
  expect(matterIdFromPath('/admin/matters/list')).toBeUndefined()
})

it('keeps legacy preparation records reachable without moving hired matters back to intake', async () => {
  const { firstStageOfGroup, STAGE_GROUP_LABELS } = await import('@/lib/matter/stageGroups')
  expect(firstStageOfGroup('early')).toBe('design')
  expect(STAGE_GROUP_LABELS.early).toBe('Design preparation')
})
