# Task, Calls, Email and Matter UI Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a task's related matter (and let the queue group by it), add bulk delete to the Calls page, put AI drafting inside the shared email composer, and add Email/Text buttons to the matter header.

**Architecture:** Four independent slices over an existing Next.js App Router admin app. No schema changes. One new API route (`POST /api/admin/calls/bulk-delete`); everything else is component-level. The AI-draft change consolidates two code paths into one by moving `DraftWithAiButton` inside `ManualEmailComposer`.

**Tech Stack:** Next.js 15 (App Router, `'use client'` components), TypeScript, Tailwind + shadcn/ui (Radix), Supabase (service-role admin client), Vitest + Testing Library (jsdom), sonner for toasts.

**Spec:** `docs/superpowers/specs/2026-08-03-task-calls-email-matter-ui-updates-design.md`

**Run tests with:** `npx vitest run <path>` (single file) — `npm test` runs the whole suite.

**Known baseline failures (AGENTS.md — do NOT treat as regressions):** `npm run lint` 5 errors; `npm run typecheck` errors confined to `tests/*.test.ts`; `npm test` 3 failures (`design-sheet-readiness`, `design-sheet-spouse-fiduciaries`, `draft-payload-children`).

---

## File Structure

**Create**
- `lib/tasks/types.ts` — *(modify)* add `TaskRecordGroup` + `groupTasksByRecord`
- `app/api/admin/calls/bulk-delete/route.ts` — bulk delete endpoint
- `tests/task-record-grouping.test.ts` — grouping helper unit tests
- `tests/task-detail-related-record.test.tsx` — detail sheet renders the record
- `tests/calls-bulk-delete-route.test.ts` — endpoint behaviour
- `tests/calls-bulk-delete-client.test.tsx` — selection UI
- `tests/matter-header-comms-actions.test.tsx` — header Email/Text buttons

**Modify**
- `components/tasks/TaskDetailSheet.tsx` — related-record line
- `app/admin/tasks/TasksClient.tsx` — Group by Due date | Matter
- `app/admin/calls/CallsPageClient.tsx` — selection + bulk delete
- `components/rail/RailEmailPane.tsx` — `DraftWithAiButton` inside the composer; drop `subjectText`/`bodyText` props
- `components/leads/LeadCommunicationDialog.tsx` — drop the now-duplicate button and its plumbing
- `app/admin/matters/[id]/MatterDetailHeader.tsx` — Email/Text buttons
- `app/admin/matters/[id]/MatterDetailClient.tsx` — wire the two handlers
- `tests/rail-email-pane.test.tsx` — add AI-draft cases

Tasks 1–3 (tasks), 4–5 (calls), 6 (email), 7 (matter header) are independent. Any order works; commit after each.

---

### Task 1: `groupTasksByRecord` helper

**Files:**
- Modify: `lib/tasks/types.ts` (add after `compareTasks`, around line 150)
- Test: `tests/task-record-grouping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/task-record-grouping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupTasksByRecord, type TaskRow } from '@/lib/tasks/types'

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    title: 'Call the client',
    description: null,
    status: 'open',
    priority: 'normal',
    source: 'manual',
    task_type: 'single',
    checklist: [],
    matter_id: null,
    lead_id: null,
    stage_key: null,
    stage_entered_at: null,
    batch_tag: null,
    soft_due_at: null,
    hard_due_at: null,
    due_at: null,
    assignee_id: null,
    estimate_minutes: null,
    remind_at: null,
    recurrence: null,
    template_id: null,
    document_id: null,
    completed_at: null,
    completed_by: null,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('groupTasksByRecord', () => {
  it('groups by record and orders sections alphabetically', () => {
    const groups = groupTasksByRecord([
      task({ id: 'a', matter_id: 'm-2', record_name: 'Whitfield, Margaret' }),
      task({ id: 'b', matter_id: 'm-1', record_name: 'Alvarez, Ruth' }),
      task({ id: 'c', matter_id: 'm-2', record_name: 'Whitfield, Margaret' }),
    ])

    expect(groups.map(group => group.label)).toEqual(['Alvarez, Ruth', 'Whitfield, Margaret'])
    expect(groups[1].tasks.map(t => t.id)).toEqual(['a', 'c'])
  })

  it('puts unlinked tasks last under their own label', () => {
    const groups = groupTasksByRecord([
      task({ id: 'loose' }),
      task({ id: 'linked', matter_id: 'm-1', record_name: 'Alvarez, Ruth' }),
    ])

    expect(groups.map(group => group.label)).toEqual(['Alvarez, Ruth', 'No related matter'])
    expect(groups[1].tasks.map(t => t.id)).toEqual(['loose'])
  })

  it('keeps two records that share a display name in separate sections', () => {
    const groups = groupTasksByRecord([
      task({ id: 'a', matter_id: 'm-1', record_name: 'John Smith' }),
      task({ id: 'b', lead_id: 'l-9', record_name: 'John Smith' }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.key).sort()).toEqual(['l-9', 'm-1'])
  })

  it('labels a linked record with no name rather than merging it into the unlinked group', () => {
    const groups = groupTasksByRecord([
      task({ id: 'a', matter_id: 'm-1', record_name: null }),
      task({ id: 'b' }),
    ])

    expect(groups.map(group => group.label)).toEqual(['Unnamed record', 'No related matter'])
  })

  it('sorts tasks inside a section by effective due date', () => {
    const [group] = groupTasksByRecord([
      task({ id: 'later', matter_id: 'm-1', record_name: 'Alvarez, Ruth', due_at: '2026-08-10T12:00:00.000Z' }),
      task({ id: 'sooner', matter_id: 'm-1', record_name: 'Alvarez, Ruth', due_at: '2026-08-04T12:00:00.000Z' }),
    ])

    expect(group.tasks.map(t => t.id)).toEqual(['sooner', 'later'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/task-record-grouping.test.ts`
Expected: FAIL — `groupTasksByRecord is not a function` (or a TypeScript/import error naming that export).

- [ ] **Step 3: Implement the helper**

In `lib/tasks/types.ts`, directly below the `compareTasks` function, add:

```ts
/** One matter/lead section of the task queue, in render order. */
export interface TaskRecordGroup {
  key: string
  label: string
  tasks: TaskRow[]
}

/**
 * Group tasks by the record they hang off — alphabetical by display name, with
 * unlinked work last. Keyed by record id, not name, so two clients who share a
 * name stay in separate sections.
 */
export function groupTasksByRecord(tasks: TaskRow[]): TaskRecordGroup[] {
  const NO_RECORD = 'none'
  const groups = new Map<string, TaskRecordGroup>()

  for (const task of tasks) {
    const key = task.matter_id ?? task.lead_id ?? NO_RECORD
    const label = key === NO_RECORD
      ? 'No related matter'
      : task.record_name?.trim() || 'Unnamed record'
    const existing = groups.get(key)
    if (existing) existing.tasks.push(task)
    else groups.set(key, { key, label, tasks: [task] })
  }

  const linked = [...groups.values()].filter(group => group.key !== NO_RECORD)
  linked.sort((a, b) => a.label.localeCompare(b.label))

  const unlinked = groups.get(NO_RECORD)
  const ordered = unlinked ? [...linked, unlinked] : linked
  for (const group of ordered) group.tasks.sort(compareTasks)
  return ordered
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/task-record-grouping.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tasks/types.ts tests/task-record-grouping.test.ts
git commit -m "Add groupTasksByRecord helper for task queue grouping"
```

---

### Task 2: Related record on the Task Details sheet

**Files:**
- Modify: `components/tasks/TaskDetailSheet.tsx`
- Test: `tests/task-detail-related-record.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/task-detail-related-record.test.tsx`:

```tsx
// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TaskDetailSheet } from '@/components/tasks/TaskDetailSheet'
import type { TaskRow } from '@/lib/tasks/types'

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    title: 'Send the trust draft',
    description: null,
    status: 'open',
    priority: 'normal',
    source: 'manual',
    task_type: 'single',
    checklist: [],
    matter_id: null,
    lead_id: null,
    stage_key: null,
    stage_entered_at: null,
    batch_tag: null,
    soft_due_at: null,
    hard_due_at: null,
    due_at: null,
    assignee_id: null,
    estimate_minutes: null,
    remind_at: null,
    recurrence: null,
    template_id: null,
    document_id: null,
    completed_at: null,
    completed_by: null,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderSheet(row: TaskRow) {
  return render(
    <TaskDetailSheet
      task={row}
      open
      onOpenChange={vi.fn()}
      onUpdated={vi.fn()}
      onDeleted={vi.fn()}
    />,
  )
}

afterEach(cleanup)

describe('TaskDetailSheet related record', () => {
  it('links a matter task to its matter', () => {
    renderSheet(task({ matter_id: 'm-1', record_name: 'Whitfield, Margaret' }))

    const link = screen.getByRole('link', { name: 'Whitfield, Margaret' })
    expect(link).toHaveAttribute('href', '/admin/matters/m-1')
  })

  it('links a lead task to its lead', () => {
    renderSheet(task({ lead_id: 'l-9', record_name: 'Harold Pike' }))

    expect(screen.getByRole('link', { name: 'Harold Pike' })).toHaveAttribute(
      'href',
      '/admin/leads/l-9',
    )
  })

  it('says so when the task hangs off nothing', () => {
    renderSheet(task())

    expect(screen.getByText('No related record')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/task-detail-related-record.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "link" and name "Whitfield, Margaret"`.

- [ ] **Step 3: Implement the related-record line**

In `components/tasks/TaskDetailSheet.tsx`:

Add to the imports at the top of the file:

```tsx
import Link from 'next/link'
```

Add `taskRecordHref` to the existing `@/lib/tasks/types` import block:

```tsx
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  describeRecurrence,
  taskRecordHref,
  type ChecklistItem,
  type TaskPriority,
  type TaskRecurrence,
  type TaskRow,
  type TaskStatus,
} from '@/lib/tasks/types'
```

Immediately after `const currentTask = task` (just below the `if (!task) return null` guard), add:

```tsx
  const recordHref = taskRecordHref(currentTask)
```

Then, inside the scrollable body — as the first child of
`<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">`, above the Title label — add:

```tsx
            <div className="space-y-1.5 text-sm">
              <span className="font-medium">Related matter</span>
              {recordHref && currentTask.record_name ? (
                <Link
                  href={recordHref}
                  className="block truncate text-sm text-primary hover:underline"
                >
                  {currentTask.record_name}
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">No related record</p>
              )}
            </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/task-detail-related-record.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add components/tasks/TaskDetailSheet.tsx tests/task-detail-related-record.test.tsx
git commit -m "Show the related matter on the task detail sheet"
```

---

### Task 3: Group the Tasks page by matter

**Files:**
- Modify: `app/admin/tasks/TasksClient.tsx`
- Test: none new — this is wiring over the Task 1 helper, which is covered. Verified in the browser in Task 8.

- [ ] **Step 1: Add the grouping state and import**

In `app/admin/tasks/TasksClient.tsx`, add `groupTasksByRecord` to the existing `@/lib/tasks/types` import block:

```tsx
import {
  TASK_SOURCES,
  TASK_SOURCE_LABEL,
  compareTasks,
  groupTasksByRecord,
  taskDueGroup,
  type TaskPriority,
  type TaskRow,
  type TaskSource,
  type TaskDueGroup,
} from '@/lib/tasks/types'
```

Add a type alias below `type ScopeKey = 'mine' | 'team' | 'unassigned'`:

```tsx
type GroupKey = 'due' | 'matter'
```

Add the state next to the other `useState` calls (below `const [openOnly, setOpenOnly] = useState(true)`):

```tsx
  const [groupBy, setGroupBy] = useState<GroupKey>('due')
```

- [ ] **Step 2: Derive the matter sections**

Directly below the existing `groups` memo, add:

```tsx
  const recordGroups = useMemo(
    () => (groupBy === 'matter' ? groupTasksByRecord(scoped) : []),
    [groupBy, scoped],
  )
```

- [ ] **Step 3: Make J/K follow the rendered order**

Replace the existing `focusOrder` memo with:

```tsx
  // What J/K walk through, in the order the groups render.
  const focusOrder = useMemo(
    () => [
      ...(groupBy === 'matter'
        ? recordGroups.flatMap(group => group.tasks)
        : [...groups.overdue, ...groups.today, ...groups.week, ...(laterOpen ? groups.later : [])]),
      ...(doneOpen ? doneTodayScoped : []),
    ],
    [groupBy, recordGroups, groups, laterOpen, doneOpen, doneTodayScoped],
  )
```

- [ ] **Step 4: Make the Group dropdown selectable**

Replace the `DropdownMenu` block that currently renders `Group: Due date` (the one containing `<DropdownMenuItem disabled>Due date</DropdownMenuItem>`) with:

```tsx
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs">
                Group: {groupBy === 'matter' ? 'Matter' : 'Due date'}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Group by</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => { setGroupBy('due'); setFocusId(null) }}>
                Due date
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setGroupBy('matter'); setFocusId(null) }}>
                Matter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
```

Note: `DropdownMenuSeparator` is no longer used by this block. Leave the import alone — it is still imported for the snooze menu; if `npm run lint` reports it unused, remove it from the import list.

- [ ] **Step 5: Render the matter sections**

Replace the `<div>` that renders the due-date groups (the branch after `nothingToShow ? … : (`) with:

```tsx
        <div>
          {groupBy === 'matter' ? (
            recordGroups.map(group => (
              <GroupShell key={group.key} title={group.label} count={group.tasks.length}>
                {group.tasks.map(renderRow)}
              </GroupShell>
            ))
          ) : (
            <>
              <GroupShell title="Overdue" count={groups.overdue.length} accent>
                {groups.overdue.map(renderRow)}
              </GroupShell>
              <GroupShell title={`Today · ${TODAY_LABEL.format(new Date())}`} count={groups.today.length}>
                {groups.today.map(renderRow)}
              </GroupShell>
              <GroupShell title="This week" count={groups.week.length}>
                {groups.week.map(renderRow)}
              </GroupShell>
              <CollapsedGroup
                title="Later"
                count={groups.later.length}
                open={laterOpen}
                onToggle={() => setLaterOpen(prev => !prev)}
              >
                {groups.later.map(renderRow)}
              </CollapsedGroup>
            </>
          )}
          <CollapsedGroup
            title="Done today"
            count={doneTodayScoped.length}
            open={doneOpen}
            onToggle={() => setDoneOpen(prev => !prev)}
          >
            {doneTodayScoped.map(renderRow)}
          </CollapsedGroup>
        </div>
```

- [ ] **Step 6: Typecheck the file**

Run: `npx tsc --noEmit -p tsconfig.typecheck.json 2>&1 | grep TasksClient`
Expected: no output (errors elsewhere in `tests/*` are the documented baseline).

- [ ] **Step 7: Commit**

```bash
git add app/admin/tasks/TasksClient.tsx
git commit -m "Let the Tasks queue group by related matter"
```

---

### Task 4: Bulk delete endpoint

**Files:**
- Create: `app/api/admin/calls/bulk-delete/route.ts`
- Test: `tests/calls-bulk-delete-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/calls-bulk-delete-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const requireAdmin = vi.hoisted(() => vi.fn())
const deleteIn = vi.hoisted(() => vi.fn())
const revalidateSidebarCounts = vi.hoisted(() => vi.fn())

vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => ({ delete: () => ({ in: deleteIn }) }) }),
}))

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

function request(body: unknown) {
  return new Request('http://test/api/admin/calls/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<
    typeof import('@/app/api/admin/calls/bulk-delete/route').POST
  >[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ err: null, userId: 'u1' })
  deleteIn.mockResolvedValue({ error: null })
})

describe('POST /api/admin/calls/bulk-delete', () => {
  it('deletes every selected call in one query', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A, ID_B] }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ deleted: 2 })
    expect(deleteIn).toHaveBeenCalledWith('id', [ID_A, ID_B])
    expect(revalidateSidebarCounts).toHaveBeenCalled()
  })

  it('refuses a non-admin', async () => {
    requireAdmin.mockResolvedValue({ err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A] }))

    expect(response.status).toBe(401)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('rejects an empty selection', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [] }))

    expect(response.status).toBe(400)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('rejects ids that are not call ids', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A, 'id.eq.anything'] }))

    expect(response.status).toBe(400)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('rejects more than 200 ids', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: Array.from({ length: 201 }, () => ID_A) }))

    expect(response.status).toBe(400)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('surfaces a database failure', async () => {
    deleteIn.mockResolvedValue({ error: { message: 'permission denied' } })
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A] }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'permission denied' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/calls-bulk-delete-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/admin/calls/bulk-delete/route`.

- [ ] **Step 3: Write the route**

Create `app/api/admin/calls/bulk-delete/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One dialog should not be able to wipe the whole call log by accident. */
const MAX_IDS = 200

export async function POST(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null
  const ids = body?.ids

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Delete at most ${MAX_IDS} calls at a time` }, { status: 400 })
  }
  if (!ids.every((id): id is string => typeof id === 'string' && UUID_RE.test(id))) {
    return NextResponse.json({ error: 'ids must all be call ids' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { error } = await admin.from('calls').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateSidebarCounts()
  return NextResponse.json({ deleted: ids.length })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/calls-bulk-delete-route.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/calls/bulk-delete/route.ts tests/calls-bulk-delete-route.test.ts
git commit -m "Add bulk delete endpoint for calls"
```

---

### Task 5: Calls page selection UI

**Files:**
- Modify: `app/admin/calls/CallsPageClient.tsx`
- Test: `tests/calls-bulk-delete-client.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/calls-bulk-delete-client.test.tsx`:

```tsx
// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/sidebarCountsClient', () => ({ invalidateSidebarCountsClient: vi.fn() }))

import { CallsPageClient, type AdminCallRow } from '@/app/admin/calls/CallsPageClient'

const CALLS: AdminCallRow[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    direction: 'inbound',
    status: 'completed',
    participant_number: '+16175550101',
    started_at: '2026-08-01T15:00:00.000Z',
    duration_seconds: 65,
    recording_url: null,
    voicemail_url: null,
    summary: null,
    firm_user_email: null,
    matter_id: null,
    lead_id: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    direction: 'outbound',
    status: 'completed',
    participant_number: '+16175550102',
    started_at: '2026-08-01T16:00:00.000Z',
    duration_seconds: 30,
    recording_url: null,
    voicemail_url: null,
    summary: null,
    firm_user_email: null,
    matter_id: null,
    lead_id: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ deleted: 2 }),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Calls bulk delete', () => {
  it('has no selection bar until something is selected', () => {
    render(<CallsPageClient initialCalls={CALLS} filter="all" />)

    expect(screen.queryByRole('button', { name: /delete selected/i })).toBeNull()
  })

  it('selects every call and deletes them in one request', async () => {
    const user = userEvent.setup()
    render(<CallsPageClient initialCalls={CALLS} filter="all" />)

    await user.click(screen.getByRole('checkbox', { name: /select all calls/i }))
    expect(screen.getByText('2 selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /delete selected/i }))
    await user.click(screen.getByRole('button', { name: /^delete 2 calls$/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/admin/calls/bulk-delete')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ids: [CALLS[0].id, CALLS[1].id],
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('counts a single selected call', async () => {
    const user = userEvent.setup()
    render(<CallsPageClient initialCalls={CALLS} filter="all" />)

    await user.click(screen.getAllByRole('checkbox', { name: /^select call from/i })[0])

    expect(screen.getByText('1 selected')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/calls-bulk-delete-client.test.tsx`
Expected: FAIL — no checkbox named "Select all calls".

- [ ] **Step 3: Implement selection and bulk delete**

In `app/admin/calls/CallsPageClient.tsx`:

Add to the imports:

```tsx
import { useEffect } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
```

(`useEffect` joins the existing `import { useMemo, useState } from 'react'` — make it `import { useEffect, useMemo, useState } from 'react'`.)

Add state below `const [deletingId, setDeletingId] = useState<string | null>(null)`:

```tsx
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
```

Below that state, add the reset and the derived flags:

```tsx
  // A new filter or a fresh server page means the old ids may not be on screen.
  useEffect(() => {
    setSelected(new Set())
  }, [filter, initialCalls])

  const allSelected = initialCalls.length > 0 && selected.size === initialCalls.length

  function toggleCall(id: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(initialCalls.map(call => call.id)) : new Set())
  }

  async function bulkDelete() {
    const ids = initialCalls.map(call => call.id).filter(id => selected.has(id))
    setBulkOpen(false)
    setBulkDeleting(true)
    const res = await fetch('/api/admin/calls/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const json = await res.json().catch(() => ({}))
    setBulkDeleting(false)
    if (!res.ok) {
      toast.error(json.error ?? 'Failed to delete calls')
      return
    }
    toast.success(`${ids.length} call${ids.length === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    invalidateSidebarCountsClient()
    router.refresh()
  }
```

Add the selection bar directly above the `{initialCalls.length === 0 ? (` block:

```tsx
      {initialCalls.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
          <Checkbox
            aria-label="Select all calls"
            checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false}
            onCheckedChange={checked => toggleAll(checked === true)}
          />
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : 'Select calls to delete in bulk'}
          </span>
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              disabled={bulkDeleting}
              onClick={() => setBulkOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </Button>
          )}
        </div>
      )}
```

Add the per-row checkbox as the first child of the row wrapper — change

```tsx
            <div key={call.id} className="flex items-start gap-2 pr-2">
              <div className="min-w-0 flex-1">
```

to

```tsx
            <div key={call.id} className="flex items-start gap-2 pr-2">
              <Checkbox
                className="ml-3 mt-3"
                aria-label={`Select call from ${call.participant_number}`}
                checked={selected.has(call.id)}
                onCheckedChange={checked => toggleCall(call.id, checked === true)}
              />
              <div className="min-w-0 flex-1">
```

Add the confirm dialog after the existing single-delete `AlertDialog`, before the closing `</>`:

```tsx
      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} call{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected call log entries. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void bulkDelete()}>
              Delete {selected.size} call{selected.size === 1 ? '' : 's'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/calls-bulk-delete-client.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/admin/calls/CallsPageClient.tsx tests/calls-bulk-delete-client.test.tsx
git commit -m "Add bulk selection and delete to the Calls page"
```

---

### Task 6: Draft with AI inside the email composer

**Files:**
- Modify: `components/rail/RailEmailPane.tsx`
- Modify: `components/leads/LeadCommunicationDialog.tsx`
- Test: `tests/rail-email-pane.test.tsx` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `tests/rail-email-pane.test.tsx` (the file already mocks `next/navigation` with a mutable `pathname.current` and `useAccessToken`):

```tsx
describe('AI drafting in the composer', () => {
  it('offers Draft with AI when the pane is scoped to a matter', async () => {
    pathname.current = '/admin/matters/m1'
    render(<RailEmailPane />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /draft with ai/i })).toBeTruthy(),
    )
  })

  it('hides Draft with AI with no matter or lead in scope', async () => {
    pathname.current = '/admin/calls'
    render(<RailEmailPane />)

    await waitFor(() => expect(screen.getByLabelText('Message')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /draft with ai/i })).toBeNull()
  })
})
```

Note: `RailEmailPane` renders `<ManualEmailComposer />`, so scoping comes from `pathname`. If the existing file's mock list lacks `@/lib/supabaseClient` (used by `DraftWithAiButton`), add this mock alongside the others at the top of the file:

```tsx
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } },
}))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/rail-email-pane.test.tsx`
Expected: the two new tests FAIL (no "Draft with AI" button); the pre-existing tests in the file still pass.

- [ ] **Step 3: Add the button to the composer**

In `components/rail/RailEmailPane.tsx`, add the import:

```tsx
import { DraftWithAiButton } from '@/components/matter/DraftWithAiButton'
```

Inside `ManualEmailComposer`, below the `resolvedVariableOptions` declaration, add:

```tsx
  const draftRoute = record
    ? record.type === 'matter'
      ? `/api/admin/matters/${record.id}/draft-reply`
      : `/api/admin/leads/${record.id}/draft-reply`
    : null

  /** Both draft routes answer with "Subject: …" on line one, then the body. */
  function applyAiDraft(draft: string) {
    const match = draft.match(/^Subject:\s*(.+)\n+([\s\S]*)$/)
    const nextSubject = match ? match[1].trim() : ''
    const nextBody = match ? match[2].trim() : draft.trim()
    setSubject(nextSubject || 'Follow-up')
    setBodyHtml(textToEmailHtml(nextBody))
    // An AI draft is the operator's own words now, not a template render.
    setTemplateId(ONE_OFF)
  }
```

In the Subject block, replace the header row

```tsx
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="rail-email-subject" className="text-[11px] font-medium text-muted-foreground">
              Subject
            </label>
            <select
```

with

```tsx
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="rail-email-subject" className="text-[11px] font-medium text-muted-foreground">
              Subject
            </label>
            {draftRoute && (
              <DraftWithAiButton
                apiPath={draftRoute}
                channel="email"
                notes={emailHtmlToText(bodyHtml)}
                onDraft={applyAiDraft}
              />
            )}
            <select
```

- [ ] **Step 4: Drop the now-duplicate seeding props**

Still in `components/rail/RailEmailPane.tsx`:

Remove `subjectText` and `bodyText` from `ManualEmailComposerProps`:

```tsx
interface ManualEmailComposerProps {
  recordOverride?: { type: 'matter' | 'lead'; id: string } | null
  templateCategories?: string[]
  onSent?: () => void | Promise<void>
  embedded?: boolean
  variableValues?: Record<string, string | null | undefined>
  initialContext?: ComposeContext
}
```

Remove them from the destructured parameters:

```tsx
export function ManualEmailComposer({
  recordOverride,
  templateCategories = ['manual'],
  onSent,
  embedded = false,
  variableValues = {},
  initialContext,
}: ManualEmailComposerProps = {}) {
```

Delete these two refs:

```tsx
  const seededSubjectRef = useRef<string | null>(null)
  const seededBodyTextRef = useRef<string | null>(null)
```

Delete the whole seeding effect (the one beginning `if (subjectText === undefined && bodyText === undefined) return`, ending with `}, [bodyText, subjectText])`).

- [ ] **Step 5: Simplify the lead dialog**

In `components/leads/LeadCommunicationDialog.tsx`:

Remove the email-only state and helper — delete these lines:

```tsx
  const [emailSubject, setEmailSubject] = useState<string | undefined>()
  const [emailBody, setEmailBody] = useState<string | undefined>()
```

```tsx
  function applyEmailDraft(draft: string) {
    const match = draft.match(/^Subject:\s*(.+)\n+([\s\S]*)$/)
    if (match) {
      setEmailSubject(match[1].trim() || 'Follow-up')
      setEmailBody(match[2].trim())
    } else {
      setEmailSubject('Follow-up')
      setEmailBody(draft.trim())
    }
  }
```

In the reset effect, delete the two now-undefined setters so it reads:

```tsx
  useEffect(() => {
    if (!props.open) {
      setMessage('')
      setError(null)
    } else if (props.channel === 'sms' && props.initialMessage) {
      setMessage(props.initialMessage.slice(0, MAX_LEAD_SMS_BODY_LENGTH))
    }
  }, [props.channel, props.initialMessage, props.open])
```

In the email branch, delete the wrapper holding the old button:

```tsx
          <div className="px-4 py-1">
            <DraftWithAiButton
              apiPath={`/api/admin/leads/${props.leadId}/draft-reply`}
              channel="email"
              onDraft={applyEmailDraft}
            />
          </div>
```

and drop the two seeding props from the composer call:

```tsx
          <ManualEmailComposer
            embedded
            recordOverride={{ type: 'lead', id: props.leadId }}
            initialContext={{
```

The SMS branch keeps its own `DraftWithAiButton`, so the `DraftWithAiButton` import stays.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/rail-email-pane.test.tsx`
Expected: PASS — including the two new cases.

- [ ] **Step 7: Typecheck the touched files**

Run: `npx tsc --noEmit -p tsconfig.typecheck.json 2>&1 | grep -E "RailEmailPane|LeadCommunicationDialog"`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add components/rail/RailEmailPane.tsx components/leads/LeadCommunicationDialog.tsx tests/rail-email-pane.test.tsx
git commit -m "Move Draft with AI into the shared email composer"
```

---

### Task 7: Email and Text buttons on the matter header

**Files:**
- Modify: `app/admin/matters/[id]/MatterDetailHeader.tsx`
- Modify: `app/admin/matters/[id]/MatterDetailClient.tsx:782-796`
- Test: `tests/matter-header-comms-actions.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/matter-header-comms-actions.test.tsx`:

```tsx
// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/softphone/SoftphoneProvider', () => ({ useVoiceEnabled: () => false }))

import { MatterDetailHeader } from '@/app/admin/matters/[id]/MatterDetailHeader'
import type { PipelineMatter } from '@/types/database'

function matter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    matter_id: 'm-1',
    client_name: 'Whitfield, Margaret',
    matter_name: 'Whitfield Trust',
    stage: 'intake',
    client_email: 'margaret@example.com',
    client_phone: '+16175550101',
    ...overrides,
  } as PipelineMatter
}

function renderHeader(over: Partial<PipelineMatter>, handlers: { onEmail: () => void; onText: () => void }) {
  return render(
    <MatterDetailHeader
      matter={matter(over)}
      matterNumber="2026-001"
      agingSummary={null}
      intakeCompleted={false}
      intakeId={null}
      unlocking={false}
      showHealthBadge={false}
      factsRailOpen={false}
      onToggleFactsRail={vi.fn()}
      onOpenIntake={vi.fn()}
      onImportIntake={vi.fn()}
      onUnlockIntake={vi.fn()}
      onDelete={vi.fn()}
      onEmail={handlers.onEmail}
      onText={handlers.onText}
    />,
  )
}

afterEach(cleanup)

describe('MatterDetailHeader communication actions', () => {
  it('calls the handlers when Email and Text are clicked', async () => {
    const user = userEvent.setup()
    const onEmail = vi.fn()
    const onText = vi.fn()
    renderHeader({}, { onEmail, onText })

    await user.click(screen.getAllByRole('button', { name: 'Email' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Text' })[0])

    expect(onEmail).toHaveBeenCalled()
    expect(onText).toHaveBeenCalled()
  })

  it('disables Email without an address and Text without a number', () => {
    renderHeader({ client_email: null, client_phone: null }, { onEmail: vi.fn(), onText: vi.fn() })

    expect(screen.getAllByRole('button', { name: 'Email' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Text' })[0]).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/matter-header-comms-actions.test.tsx`
Expected: FAIL — no button named "Email".

- [ ] **Step 3: Add the buttons to the header**

In `app/admin/matters/[id]/MatterDetailHeader.tsx`:

Add `Mail` and `MessageSquare` to the `lucide-react` import:

```tsx
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Loader as Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PanelRight,
  Trash2,
  Upload,
  Clock as UnlockIcon,
} from 'lucide-react'
```

Add two props to `MatterDetailHeaderProps`, below `onToggleFactsRail`:

```tsx
  onEmail: () => void
  onText: () => void
```

Add them to the destructured parameters of `MatterDetailHeader`, below `onToggleFactsRail,`:

```tsx
  onEmail,
  onText,
```

In the desktop action group, directly after the `{matter.client_phone && (<CallPhoneLink … />)}` block, insert:

```tsx
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onEmail}
          disabled={!matter.client_email}
        >
          <Mail className="size-3.5" />
          Email
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onText}
          disabled={!matter.client_phone}
        >
          <MessageSquare className="size-3.5" />
          Text
        </Button>
```

In the mobile dropdown, directly after the `{matter.client_phone && (<DropdownMenuItem asChild><CallPhoneLink … /></DropdownMenuItem>)}` block, insert:

```tsx
          <DropdownMenuItem disabled={!matter.client_email} onClick={onEmail}>
            <Mail className="mr-2 size-3.5" />
            Email client
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!matter.client_phone} onClick={onText}>
            <MessageSquare className="mr-2 size-3.5" />
            Text client
          </DropdownMenuItem>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/matter-header-comms-actions.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Wire the handlers**

In `app/admin/matters/[id]/MatterDetailClient.tsx`, in the `<MatterDetailHeader … />` element around line 782, add two props below `onToggleFactsRail`:

```tsx
        onEmail={() => setActiveTab('communications', undefined, 'email')}
        onText={() => setActiveTab('communications', undefined, 'sms')}
```

- [ ] **Step 6: Typecheck the touched files**

Run: `npx tsc --noEmit -p tsconfig.typecheck.json 2>&1 | grep -E "MatterDetailHeader|MatterDetailClient"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add "app/admin/matters/[id]/MatterDetailHeader.tsx" "app/admin/matters/[id]/MatterDetailClient.tsx" tests/matter-header-comms-actions.test.tsx
git commit -m "Add Email and Text actions to the matter header"
```

---

### Task 8: Verify in the running app and report

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all new tests pass. Exactly the 3 documented baseline failures remain (`design-sheet-readiness`, `design-sheet-spouse-fiduciaries`, `draft-payload-children`). Any other failure is a regression — fix it before continuing.

- [ ] **Step 2: Lint and typecheck**

Run: `npm run lint` then `npx tsc --noEmit -p tsconfig.typecheck.json`
Expected: no *new* errors beyond the AGENTS.md baseline (5 lint errors; typecheck errors confined to `tests/*.test.ts`).

- [ ] **Step 3: Start the dev server**

Use the preview tooling (`preview_start` with a `.claude/launch.json` entry running `npm run dev`, port 3002) — never a bare `npm run dev` in a shell.

- [ ] **Step 4: Check the four surfaces**

1. `/admin` (My Day) — confirm whether task rows already show the related matter under the title. **Report what you find. Do not add a second label if it is already there.**
2. `/admin/tasks` — open a task to see "Related matter" in the sheet; switch Group to Matter and confirm one section per client, unlinked last.
3. `/admin/calls` — tick two calls, confirm "2 selected", delete, confirm the toast and that the rows are gone.
4. A matter detail page — confirm Email and Text appear in the header and switch to the Communications tab on the right channel; open the rail's Email tab and confirm "Draft with AI" is present (and absent on `/admin/calls`).

Check `read_console_messages` for errors after each.

- [ ] **Step 5: Report honestly**

Summarize what changed, paste the test result line, and state the My Day finding plainly — including "already showed it, no change needed" if that is the truth.
