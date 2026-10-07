// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/tasks',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/lib/sidebarCountsClient', () => ({ invalidateSidebarCountsClient: vi.fn() }))

import { TasksClient } from '@/app/admin/tasks/TasksClient'
import { taskFixture } from './fixtures/task'

/**
 * Selecting rows by keyboard and assigning them in one go.
 *
 * The hazard this design is built around: the row already leads with a
 * checkbox that *completes* a task, and `x` already completes the focused row.
 * Selection therefore gets its own key and its own visual channel, and the
 * count it reports has to stay true — a selection nobody can see is a mode,
 * not a feature.
 */

const ME = '99999999-9999-4999-8999-999999999999'
const OTHER = '88888888-8888-4888-8888-888888888888'

// Due today and assigned to the viewer, so they land in the default `mine`
// scope's Today group — the queue's other groups are collapsed by default and
// an undated task would never be on screen to select.
const TODAY = new Date().toISOString()

const TASKS = [
  taskFixture({ id: '11111111-1111-4111-8111-111111111111', title: 'Call the Whitfields', assignee_id: ME, due_at: TODAY }),
  taskFixture({ id: '22222222-2222-4222-8222-222222222222', title: 'Draft the pour-over will', assignee_id: ME, due_at: TODAY }),
  taskFixture({ id: '33333333-3333-4333-8333-333333333333', title: 'Send the funding letter', assignee_id: ME, due_at: TODAY }),
]

let fetchMock: ReturnType<typeof vi.fn>

function renderPage() {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ tasks: [], updated: 2, missing: [] }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <TasksClient
      initialOpenTasks={TASKS}
      initialDoneToday={[]}
      assignees={[{ id: ME, name: 'Scott Aubrey' }, { id: OTHER, name: 'Dana Reyes' }]}
      templates={[]}
      viewerId={ME}
    />,
  )
}

// On document.body, not window: a real keydown always targets an element (body
// when nothing is focused), and the handler reads `target.closest` to avoid
// stealing keys from inputs.
const press = (key: string) => fireEvent.keyDown(document.body, { key })

/** Move focus to the first row, then select it. */
function selectFirst() {
  press('j')
  press(' ')
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('building a selection', () => {
  it('says nothing until something is selected', () => {
    renderPage()

    expect(screen.queryByText(/selected$/)).toBeNull()
  })

  it('reports the count once rows are held', async () => {
    renderPage()
    selectFirst()
    press('j')
    press(' ')

    expect(await screen.findByText('2 selected')).toBeTruthy()
  })

  it('marks the row itself, not just the counter', async () => {
    const { container } = renderPage()
    selectFirst()

    await waitFor(() => {
      expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(1)
    })
  })

  it('says which row is held, not only how many', async () => {
    /*
     * The row used to carry `aria-selected`, which a bare <li> silently drops:
     * a listitem does not support it. So the fill was the entire signal, and a
     * screen reader driving this same keyboard selection into a bulk assign
     * heard nothing about what it had picked up.
     *
     * `role="option"` would be the textbook repair and the wrong one here —
     * an option must not contain focusable widgets, and each row holds a
     * checkbox, a snooze menu and an open action. So it is said in words.
     */
    const { container } = renderPage()
    selectFirst()

    await waitFor(() => {
      const row = container.querySelector('[data-selected="true"]')
      expect(row, 'a row should be held').not.toBeNull()
      expect(row?.textContent).toContain('Selected')
    })

    // And the marker is on the held row alone.
    expect(screen.getAllByText('Selected.')).toHaveLength(1)
  })

  it('takes the announcement back when the row is released', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    press(' ')

    await waitFor(() => expect(screen.queryByText('Selected.')).toBeNull())
  })

  it('lets space take a row back out', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    press(' ')

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })

  it('does not complete anything — that is what x is for', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    // A selection keystroke must never reach the task PATCH surface.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('assigning the selection', () => {
  it('sends every held id in one request', async () => {
    renderPage()
    selectFirst()
    press('j')
    press(' ')
    press('a')

    fireEvent.click(await screen.findByText(/^Me \(/))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/admin/tasks/bulk'))
      expect(call).toBeTruthy()
      expect(call![1].method).toBe('PATCH')
      expect(JSON.parse(call![1].body)).toEqual({
        ids: [TASKS[0].id, TASKS[1].id],
        assignee_id: ME,
      })
    })
  })

  it('offers handing the selection back to nobody', async () => {
    renderPage()
    selectFirst()
    press('a')

    fireEvent.click(await screen.findByText(/Nobody/))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/admin/tasks/bulk'))
      expect(JSON.parse(call![1].body).assignee_id).toBeNull()
    })
  })

  it('drops the selection once the write lands', async () => {
    renderPage()
    selectFirst()
    press('a')
    fireEvent.click(await screen.findByText(/^Me \(/))

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })

  it('keeps the selection when the write fails, so the same keys retry it', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'nope' }) })

    press('a')
    fireEvent.click(await screen.findByText(/^Me \(/))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/bulk'))).toBe(true),
    )
    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('acts on the focused row when nothing has been selected yet', async () => {
    renderPage()
    press('j')
    press('a')

    fireEvent.click(await screen.findByText(/^Me \(/))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/bulk'))
      expect(JSON.parse(call![1].body).ids).toEqual([TASKS[0].id])
    })
  })
})

describe('getting out', () => {
  it('clears the selection before it clears the cursor', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    press('Escape')

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })

  it('offers a way out that is not a keystroke', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })

  it('drops rows any filter takes off screen, not just a scope change', async () => {
    // Scope has its own reset; the toolbar filters do not, and "1 selected"
    // over a list showing none is the kind of lie that makes the count
    // worthless. The prune is what covers every other filter on the page.
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    // These tasks are `normal`, so filtering to High empties the list. Radix
    // opens its menu on pointerdown, not click.
    const trigger = screen.getByRole('button', { name: /Any priority/ })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.click(await screen.findByText('High'))

    await waitFor(() => expect(screen.queryByText(/selected$/)).toBeNull())
  })

  it('drops rows a scope change takes off screen', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    // Scope 2 is "team" — assigned to someone else — and these are unassigned,
    // so the held row is no longer on screen to act on.
    press('2')

    await waitFor(() => expect(screen.queryByText(/selected$/)).toBeNull())
  })
})

describe('selecting by mouse', () => {
  it('puts a select box on each row that holds the row without completing it', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: `Select ${TASKS[0].title}` }))

    expect(await screen.findByText('1 selected')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers to hold every row on screen', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')

    fireEvent.click(screen.getByRole('button', { name: 'Select all 3' }))

    expect(await screen.findByText('3 selected')).toBeTruthy()
  })
})

describe('snoozing the selection', () => {
  it('sends every held id and the push in one request', async () => {
    renderPage()
    selectFirst()
    press('j')
    press(' ')
    press('s')

    fireEvent.click(await screen.findByText('3 days'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/admin/tasks/bulk'))
      expect(call![1].method).toBe('PATCH')
      expect(JSON.parse(call![1].body)).toEqual({ ids: [TASKS[0].id, TASKS[1].id], snooze_days: 3 })
    })
    await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull())
  })
})

describe('deleting the selection', () => {
  it('asks before deleting, then sends every held id in one request', async () => {
    renderPage()
    selectFirst()
    await screen.findByText('1 selected')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ deleted: [TASKS[0].id], missing: [], protected: [] }) })

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete task' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/admin/tasks/bulk'))
      expect(call![1].method).toBe('DELETE')
      expect(JSON.parse(call![1].body)).toEqual({ ids: [TASKS[0].id] })
    })
    await waitFor(() => expect(screen.queryByText(TASKS[0].title)).toBeNull())
  })
})
