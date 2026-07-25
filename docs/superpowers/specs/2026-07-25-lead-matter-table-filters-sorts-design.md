# Lead and Matter Table Filters and Sorts

**Date:** 2026-07-25

## Scope

Add filtering and explicit “Sort by” controls to the administrative tables at
`/admin/leads` and `/admin/matters`. The drafting hub and drafting internals are
out of scope.

## Goals

- Make lead and matter lists easier to narrow without leaving the page.
- Make each table’s ordering explicit and reversible through a dropdown.
- Preserve the redesigned table layouts, existing insight cards, bulk
  selection behavior, and row actions.
- Keep the interaction immediate by operating on the records already loaded by
  each page.

## Lead Table

The existing Open, Lost, and All tabs remain the primary status filter. The
pipeline insight cards continue to narrow the Open view.

Add a toolbar with:

- Search across client name, email, phone, provisional lead number, and practice
  area.
- Practice Area: All plus the existing configured practice-area choices.
- Progress:
  - All
  - Intake not sent
  - Intake pending
  - Intake complete
  - Engagement pending
  - Engagement signed
- Sort by:
  - Newest
  - Oldest
  - Name A-Z
  - Name Z-A
  - Fee high-low
  - Last activity

Progress filters use the same intake and engagement fields that render the
table’s progress indicator. “Engagement pending” means an engagement has been
sent but is not signed. Missing names, fees, dates, and activity timestamps sort
after populated values.

## Matter Table

Retain the existing search, stage-group pills, and Practice Area filter. Add a
Sort by dropdown with:

- Last activity
- Newest
- Oldest
- Client A-Z
- Client Z-A
- Matter number

The default remains Last activity, using the same derived activity timestamp
shown in the table. Missing client names, matter numbers, and dates sort after
populated values.

## Behavior and State

Both tables filter first and sort the resulting rows second. All processing is
client-side over the records supplied to the page.

Bulk selection continues to operate on visible rows. Changing filters or sort
order does not discard selections, while the selection count and “select all”
state reflect only currently visible rows.

“Clear filters” resets search and narrowing filters but preserves the selected
sort. Sorting changes order but does not narrow the list, so it is not treated
as an active filter.

When filters produce no matches, each page shows its existing empty-state
presentation with filter-specific copy.

## Implementation Boundaries

Pure filter and sort helpers will own comparison and predicate behavior so the
React components remain focused on controls and rendering. They will not mutate
the arrays passed in from server components.

No database schema, API, server query, drafting workflow, or URL-state changes
are required.

## Accessibility

Search inputs and dropdown triggers receive explicit accessible labels. Native
selection semantics remain available through the existing Select components.
Controls remain keyboard-operable, and sort labels state their direction
without relying on icons alone.

## Testing

Use test-driven development for the pure helpers and component-facing behavior:

- Lead search, practice, and each progress predicate.
- Lead ordering for every sort option, including missing-value placement.
- Matter filtering remains intact when sorting is applied.
- Matter ordering for every sort option, including derived last activity.
- Helpers do not mutate their input arrays.
- Clear-filters behavior does not reset sorting.
- Visible-row bulk selection semantics remain unchanged.

Run focused tests for the new helpers and the existing lead/matter suites,
changed-file lint, and `git diff --check`. Repository-wide baseline failures
remain outside this feature unless the changed files introduce a regression.
