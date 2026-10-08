// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskBoard, dueTone } from '@/components/tasks/TaskBoard'
import { parseTaskPresentation } from '@/lib/tasks/presentation'
import type { TaskRow } from '@/lib/tasks/types'

afterEach(cleanup)

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1', title: 'Prepare design sheet', description: 'Resolve trustee DOB first', status: 'open', priority: 'high', source: 'manual',
    task_type: 'checklist', checklist: [{ text: 'a', done: true }, { text: 'b', done: false }], matter_id: 'm1', lead_id: null,
    stage_key: null, stage_entered_at: null, batch_tag: null, soft_due_at: null, hard_due_at: null, due_at: null, assignee_id: null,
    estimate_minutes: null, remind_at: null, recurrence: null, template_id: null, document_id: null, completed_at: null, completed_by: null,
    created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', owner: 'firm', assignee_name: 'Scott Aubrey',
    ...overrides,
  } as TaskRow
}

function dataTransfer() {
  const store: Record<string, string> = {}
  return { setData: (type: string, value: string) => { store[type] = value }, getData: (type: string) => store[type] ?? '', dropEffect: '', effectAllowed: '' }
}

function dragTo(title: string, column: string) {
  const transfer = dataTransfer()
  fireEvent.dragStart(screen.getByText(title).closest('article')!, { dataTransfer: transfer })
  const target = screen.getByRole('region', { name: `${column} column` })
  fireEvent.dragOver(target, { dataTransfer: transfer })
  fireEvent.drop(target, { dataTransfer: transfer })
}

it('renders the card with checklist progress, owner initials and source', () => {
  render(<TaskBoard tasks={[task()]} onStatus={vi.fn()} />)
  const open = screen.getByRole('region', { name: 'Open column' })
  expect(within(open).getByText('Prepare design sheet')).toBeTruthy()
  expect(within(open).getByText('Checklist 1/2')).toBeTruthy()
  expect(within(open).getByText('SA')).toBeTruthy()
  expect(within(open).getByRole('img', { name: 'High priority' })).toBeTruthy()
})

it('calls onStatus when a card is dropped on another column and moves it at once', async () => {
  const onStatus = vi.fn().mockResolvedValue(task({ status: 'in_progress' }))
  render(<TaskBoard tasks={[task()]} onStatus={onStatus} />)
  dragTo('Prepare design sheet', 'In Progress')
  expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'in_progress')
  expect(within(screen.getByRole('region', { name: 'In Progress column' })).getByText('Prepare design sheet')).toBeTruthy()
})

it('reverts the move when the write fails', async () => {
  const onStatus = vi.fn().mockResolvedValue(null)
  render(<TaskBoard tasks={[task()]} onStatus={onStatus} />)
  dragTo('Prepare design sheet', 'Blocked')
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Open column' })).getByText('Prepare design sheet')).toBeTruthy())
})

it('keeps the per-card status select as the keyboard path', () => {
  const onStatus = vi.fn().mockResolvedValue(task({ status: 'blocked' }))
  render(<TaskBoard tasks={[task()]} onStatus={onStatus} />)
  fireEvent.change(screen.getByLabelText('Status for Prepare design sheet'), { target: { value: 'blocked' } })
  expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'blocked')
})

it('does not make cards draggable without a status handler', () => {
  render(<TaskBoard tasks={[task()]} />)
  expect(screen.getByText('Prepare design sheet').closest('article')!.getAttribute('draggable')).toBe('false')
})

it('tones due pills by urgency', () => {
  const now = new Date('2026-10-08T15:00:00Z')
  expect(dueTone(task({ due_at: '2026-10-07T15:00:00Z' }), now)).toBe('overdue')
  expect(dueTone(task({ due_at: '2026-10-09T15:00:00Z' }), now)).toBe('soon')
  expect(dueTone(task({ due_at: '2026-10-20T15:00:00Z' }), now)).toBe('later')
  expect(dueTone(task({ status: 'done', due_at: '2026-10-07T15:00:00Z' }), now)).toBe('done')
})

it('lets the URL presentation win over a surface default', () => {
  expect(parseTaskPresentation(null, 'board')).toBe('board')
  expect(parseTaskPresentation('list', 'board')).toBe('list')
  expect(parseTaskPresentation('bogus', 'board')).toBe('board')
})
