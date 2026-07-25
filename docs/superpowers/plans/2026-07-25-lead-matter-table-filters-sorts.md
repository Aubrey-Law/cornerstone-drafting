# Lead and Matter Table Filters and Sorts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side search, filters, and explicit Sort by dropdowns to `/admin/leads` and `/admin/matters`.

**Architecture:** Put deterministic filtering and non-mutating sorting in two focused helpers under `lib/adminTables/`. The existing client components own only UI state and compose their existing status/card filters with those helpers. Focused Vitest tests cover the helpers and render both real table components to verify that the controls change visible rows while preserving sort state on filter reset.

**Tech Stack:** Next.js App Router, React 19, TypeScript, shadcn/Radix Select, Vitest, Testing Library.

## Global Constraints

- Scope is limited to `/admin/leads` and `/admin/matters`; the drafting hub and drafting internals remain unchanged.
- Filtering happens before sorting, entirely over records already loaded by each page.
- Missing names, numbers, fees, dates, and activity timestamps sort after populated values.
- Clear filters resets search and narrowing filters but preserves the selected sort.
- Bulk selection remains scoped to visible rows and is not discarded when controls change.
- No database schema, API, server query, URL-state, or dependency changes.

## File Structure

- Create `lib/adminTables/leadTable.ts`: lead display-name/provisional-number derivation, filter types, progress predicates, and stable non-mutating sorting.
- Create `lib/adminTables/matterTable.ts`: matter filter types, search/stage/practice predicates, derived last-activity timestamp, and stable non-mutating sorting.
- Create `tests/admin-table-controls.test.ts`: literal fixtures and unit behavior for both helpers.
- Create `tests/admin-list-controls.test.tsx`: real component interactions for search, Select controls, sort persistence, and visible-row selection.
- Modify `app/admin/leads/LeadsClient.tsx`: render and wire the lead search, Practice, Progress, and Sort by controls.
- Modify `app/admin/matters/MattersClient.tsx`: replace inline list processing with the helper and add Sort by.

---

### Task 1: Deterministic Lead Table Controls

**Files:**
- Create: `lib/adminTables/leadTable.ts`
- Create: `tests/admin-table-controls.test.ts`

**Interfaces:**
- Produces:
  - `LeadTableRow` with the fields consumed by lead filtering/sorting.
  - `LeadTableFilters = { search: string; practice: string; progress: LeadProgressFilter }`.
  - `LeadProgressFilter = 'all' | 'intake_not_sent' | 'intake_pending' | 'intake_complete' | 'engagement_pending' | 'engagement_signed'`.
  - `LeadSortKey = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'fee_desc' | 'last_activity'`.
  - `EMPTY_LEAD_TABLE_FILTERS`.
  - `leadDisplayName(lead)`.
  - `provisionalLeadNumber(lead, fallbackYear?)`.
  - `filterAndSortLeads(leads, filters, sortKey)`.

- [ ] **Step 1: Write failing lead helper tests**

Add literal fixtures for six leads whose names, practices, intake states,
engagement states, fees, created dates, and activity dates differ. Add tests
that directly establish the intended contract:

```ts
it('searches lead identity fields including provisional number', () => {
  expect(ids(filterAndSortLeads(leads, {
    ...EMPTY_LEAD_TABLE_FILTERS,
    search: '2026-EP-Smith',
  }, 'newest'))).toEqual(['smith'])
})

it.each([
  ['intake_not_sent', ['new']],
  ['intake_pending', ['intake-sent']],
  ['intake_complete', ['intake-done', 'agreement-sent', 'signed']],
  ['engagement_pending', ['agreement-sent']],
  ['engagement_signed', ['signed']],
] as const)('filters %s progress', (progress, want) => {
  expect(ids(filterAndSortLeads(leads, {
    ...EMPTY_LEAD_TABLE_FILTERS,
    progress,
  }, 'newest'))).toEqual(want)
})

it.each([
  ['newest', ['newest', 'older', 'missing']],
  ['oldest', ['older', 'newest', 'missing']],
  ['name_asc', ['alpha', 'zulu', 'missing']],
  ['name_desc', ['zulu', 'alpha', 'missing']],
  ['fee_desc', ['high', 'low', 'missing']],
  ['last_activity', ['recent', 'stale', 'missing']],
] as const)('sorts leads by %s with missing values last', (sort, want) => {
  expect(ids(filterAndSortLeads(sortFixtures, EMPTY_LEAD_TABLE_FILTERS, sort))).toEqual(want)
})

it('does not mutate the input lead array', () => {
  const original = [...sortFixtures]
  filterAndSortLeads(sortFixtures, EMPTY_LEAD_TABLE_FILTERS, 'name_asc')
  expect(sortFixtures).toEqual(original)
})
```

Name the break each test catches: wrong field coverage, overlapping progress
rules, wrong direction, missing values promoted above real values, or in-place
`.sort()` mutation.

- [ ] **Step 2: Run the lead tests and verify RED**

Run:

```bash
npm test -- --run tests/admin-table-controls.test.ts
```

Expected: FAIL because `@/lib/adminTables/leadTable` does not exist.

- [ ] **Step 3: Implement the minimal lead helper**

Create the types and helper. Use `intake_completed_at || status === 'completed'`
for intake completion, require `engagement_sent_at` and a non-signed status for
engagement pending, normalize searches with `trim().toLocaleLowerCase()`, and
sort a decorated copy:

```ts
const decorated = filtered.map((lead, index) => ({ lead, index }))
decorated.sort((a, b) => compareLeads(a.lead, b.lead, sortKey) || a.index - b.index)
return decorated.map(item => item.lead)
```

Use explicit null-last comparators rather than sentinel values:

```ts
function compareNullable<T>(
  left: T | null,
  right: T | null,
  compare: (a: T, b: T) => number,
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return compare(left, right)
}
```

- [ ] **Step 4: Run the lead tests and verify GREEN**

Run:

```bash
npm test -- --run tests/admin-table-controls.test.ts
```

Expected: all lead helper tests PASS.

- [ ] **Step 5: Commit the lead helper slice**

```bash
git add lib/adminTables/leadTable.ts tests/admin-table-controls.test.ts
git commit -m "feat: add lead table filtering and sorting"
```

---

### Task 2: Lead Table Toolbar and Interaction

**Files:**
- Modify: `app/admin/leads/LeadsClient.tsx`
- Create: `tests/admin-list-controls.test.tsx`

**Interfaces:**
- Consumes `EMPTY_LEAD_TABLE_FILTERS`, `filterAndSortLeads`, `LeadTableFilters`,
  and `LeadSortKey` from Task 1.
- Produces accessible controls named `Search leads`, `Filter leads by practice area`,
  `Filter leads by progress`, and `Sort leads by`.

- [ ] **Step 1: Write failing lead component tests**

Use jsdom, Testing Library, and real `LeadsClient`. Mock only router/auth/toast
boundaries:

```ts
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
```

Render three complete `LeadRow` fixtures and verify user-visible behavior:

```ts
it('searches and filters leads before applying the selected sort', async () => {
  const user = userEvent.setup()
  render(<LeadsClient initialLeads={leadRows} esignEnabled />)

  await user.type(screen.getByRole('searchbox', { name: 'Search leads' }), 'jane')
  expect(screen.getByRole('link', { name: 'Jane Alpha' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Zoe Beta' })).toBeNull()

  await selectOption(user, 'Filter leads by progress', 'Intake pending')
  expect(screen.queryByRole('link', { name: 'Jane Alpha' })).toBeNull()
})

it('clear filters preserves lead sort order and visible-row selection', async () => {
  const user = userEvent.setup()
  render(<LeadsClient initialLeads={leadRows} esignEnabled />)

  await selectOption(user, 'Sort leads by', 'Name Z-A')
  await selectOption(user, 'Filter leads by practice area', 'Estate Planning')
  await user.click(screen.getByRole('checkbox', { name: 'Select all visible leads' }))
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))

  expect(visibleLeadNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
  expect(screen.getByText('2 selected')).toBeTruthy()
})
```

The local `selectOption` helper opens the labeled Radix combobox and clicks the
option by accessible name. `visibleLeadNames()` reads links whose href begins
with `/admin/leads/`, testing rendered order rather than implementation state.

- [ ] **Step 2: Run the lead component tests and verify RED**

Run:

```bash
npm test -- --run tests/admin-list-controls.test.tsx
```

Expected: FAIL because the four lead controls are absent.

- [ ] **Step 3: Wire lead control state and rendering**

In `LeadsClient`:

```ts
const [tableFilters, setTableFilters] = useState<LeadTableFilters>(EMPTY_LEAD_TABLE_FILTERS)
const [sortKey, setSortKey] = useState<LeadSortKey>('newest')
```

Build the status/card-filtered base list first, then call
`filterAndSortLeads(baseLeads, tableFilters, sortKey)`. Add a compact toolbar
below the existing status pills with:

- a `Search` icon and `<input type="search" aria-label="Search leads">`;
- Practice Area and Progress `Select` controls;
- a right-aligned Sort by `Select`;
- Clear filters shown only when search/practice/progress narrows the list.

Clear only the table filters:

```ts
const clearTableFilters = () => setTableFilters(EMPTY_LEAD_TABLE_FILTERS)
```

Update the select-all label to `Select all visible leads`. Keep existing
Open/Lost/All tabs, insight-card state, actions, selection storage, and dialogs
unchanged.

- [ ] **Step 4: Run lead component and helper suites**

Run:

```bash
npm test -- --run tests/admin-list-controls.test.tsx tests/admin-table-controls.test.ts tests/leads.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the lead UI slice**

```bash
git add app/admin/leads/LeadsClient.tsx tests/admin-list-controls.test.tsx
git commit -m "feat: add lead list controls"
```

---

### Task 3: Deterministic Matter Table Controls

**Files:**
- Create: `lib/adminTables/matterTable.ts`
- Modify: `tests/admin-table-controls.test.ts`

**Interfaces:**
- Produces:
  - `MatterTableFilters = { search: string; practice: string; stageGroup: StageGroup | 'all' }`.
  - `MatterSortKey = 'last_activity' | 'newest' | 'oldest' | 'client_asc' | 'client_desc' | 'matter_number'`.
  - `EMPTY_MATTER_TABLE_FILTERS`.
  - `matterLastActivityAt(matter)`.
  - `filterAndSortMatters(matters, filters, sortKey)`.

- [ ] **Step 1: Write failing matter helper tests**

Extend `tests/admin-table-controls.test.ts` with literal `MatterListRow`
fixtures:

```ts
it('keeps matter search, practice, and stage-group filtering composed', () => {
  expect(matterIds(filterAndSortMatters(matters, {
    search: 'smith',
    practice: 'EP',
    stageGroup: 'active',
  }, 'last_activity'))).toEqual(['matching-matter'])
})

it.each([
  ['last_activity', ['recent', 'stale', 'missing']],
  ['newest', ['newest', 'older', 'missing']],
  ['oldest', ['older', 'newest', 'missing']],
  ['client_asc', ['alpha', 'zulu', 'missing']],
  ['client_desc', ['zulu', 'alpha', 'missing']],
  ['matter_number', ['number-001', 'number-010', 'missing']],
] as const)('sorts matters by %s with missing values last', (sort, want) => {
  expect(matterIds(filterAndSortMatters(
    matterSortFixtures,
    EMPTY_MATTER_TABLE_FILTERS,
    sort,
  ))).toEqual(want)
})

it('derives last activity from the newest timestamp carried by the pipeline view', () => {
  expect(matterLastActivityAt(matterWithSeveralDates))
    .toBe(Date.parse('2026-07-24T12:00:00Z'))
})

it('does not mutate the input matter array', () => {
  const original = [...matterSortFixtures]
  filterAndSortMatters(matterSortFixtures, EMPTY_MATTER_TABLE_FILTERS, 'client_asc')
  expect(matterSortFixtures).toEqual(original)
})
```

- [ ] **Step 2: Run the matter tests and verify RED**

Run:

```bash
npm test -- --run tests/admin-table-controls.test.ts
```

Expected: FAIL because `@/lib/adminTables/matterTable` does not exist.

- [ ] **Step 3: Implement the minimal matter helper**

Move the existing matter search/practice/stage-group predicate and
`lastActivityAt` derivation into the new helper. Preserve the current timestamp
sources: `documents_executed_at`, `drafts_sent_at`, `intake_submitted_at`, and
`matter_created`. Use stable decorated-copy sorting and explicit null-last
comparators as in Task 1.

- [ ] **Step 4: Run the helper suite and verify GREEN**

Run:

```bash
npm test -- --run tests/admin-table-controls.test.ts
```

Expected: all lead and matter helper tests PASS.

- [ ] **Step 5: Commit the matter helper slice**

```bash
git add lib/adminTables/matterTable.ts tests/admin-table-controls.test.ts
git commit -m "feat: add matter table filtering and sorting"
```

---

### Task 4: Matter Sort Control and Final Verification

**Files:**
- Modify: `app/admin/matters/MattersClient.tsx`
- Modify: `tests/admin-list-controls.test.tsx`

**Interfaces:**
- Consumes `EMPTY_MATTER_TABLE_FILTERS`, `filterAndSortMatters`,
  `matterLastActivityAt`, `MatterTableFilters`, and `MatterSortKey` from Task 3.
- Produces an accessible control named `Sort matters by`.

- [ ] **Step 1: Write failing matter component tests**

Mock `useSearchParams` as an empty `URLSearchParams` and render the real
`MattersClient` with three complete `MatterListRow` fixtures:

```ts
it('sorts the filtered matter rows from the Sort by control', async () => {
  const user = userEvent.setup()
  render(<MattersClient matters={matterRows} />)

  await selectOption(user, 'Sort matters by', 'Client Z-A')
  expect(visibleMatterNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
})

it('clear filters preserves matter sort order and visible-row selection', async () => {
  const user = userEvent.setup()
  render(<MattersClient matters={matterRows} />)

  await selectOption(user, 'Sort matters by', 'Client Z-A')
  await selectOption(user, 'Filter by practice area', 'Estate Planning')
  await user.click(screen.getByRole('checkbox', { name: 'Select all visible matters' }))
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))

  expect(visibleMatterNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
  expect(screen.getByText('2 selected')).toBeTruthy()
})
```

- [ ] **Step 2: Run the matter component tests and verify RED**

Run:

```bash
npm test -- --run tests/admin-list-controls.test.tsx
```

Expected: lead tests PASS and matter tests FAIL because `Sort matters by` is
absent.

- [ ] **Step 3: Wire matter helper state and Sort by UI**

Replace inline filter state and `filtered` computation with:

```ts
const [filters, setFilters] = useState<MatterTableFilters>(EMPTY_MATTER_TABLE_FILTERS)
const [sortKey, setSortKey] = useState<MatterSortKey>('last_activity')
const filtered = useMemo(
  () => filterAndSortMatters(matters, filters, sortKey),
  [filters, matters, sortKey],
)
```

Keep search, stage-group pills, Practice Area, and Clear filters behavior
unchanged. Add the Sort by `Select` beside Practice Area. Replace the local
`lastActivityAt` function with `matterLastActivityAt` so the rendered activity
and sort order share the same derivation.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- --run tests/admin-table-controls.test.ts tests/admin-list-controls.test.tsx tests/leads.test.ts tests/matter-delete.test.ts
npx eslint app/admin/leads/LeadsClient.tsx app/admin/matters/MattersClient.tsx lib/adminTables/leadTable.ts lib/adminTables/matterTable.ts tests/admin-table-controls.test.ts tests/admin-list-controls.test.tsx
git diff --check
```

Expected: focused tests and changed-file ESLint exit 0; `git diff --check`
prints no output.

- [ ] **Step 5: Review requirements against the spec**

Confirm from the rendered test behavior and diff:

- Lead search covers name, email, phone, provisional number, and practice.
- Every approved lead progress and sort option exists.
- Every approved matter sort option exists.
- Missing values remain last for both sort directions.
- Sort survives Clear filters.
- Selection remains stored while counts/select-all reflect visible rows.
- Drafting files, APIs, server queries, schema, and dependencies are untouched.

- [ ] **Step 6: Commit the matter UI and verification slice**

```bash
git add app/admin/matters/MattersClient.tsx tests/admin-list-controls.test.tsx
git commit -m "feat: add matter list sorting"
```
