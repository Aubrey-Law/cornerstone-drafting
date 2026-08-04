# Task, Calls, Email and Matter UI updates — design

**Date:** 2026-08-03
**Branch:** `claude/ui-updates-task-calls-email-d78730`

Four independent UI changes, batched because they are all small and touch
adjacent surfaces. Each ships on its own and can be reviewed in isolation.

---

## 1. Related matter on tasks

### Problem

A task's related matter is invisible where it matters most. The Task Details
sheet never names the record the task hangs off, so an attorney editing a task
cannot tell which client it belongs to. The Tasks page can only be grouped by
due date, so there is no way to read the queue matter by matter.

### Change

**Task Details sheet** (`components/tasks/TaskDetailSheet.tsx`)

Add a read-only "Related matter" line at the top of the sheet body, above
Title. It renders `task.record_name` as a link to `/admin/matters/{matter_id}`
or `/admin/leads/{lead_id}`, resolved by the existing `taskRecordHref` helper.
When the task has neither relation, it reads "No related record" in muted text.

Read-only by design: re-pointing a task at a different matter is a different
feature with its own validation, and is out of scope here.

**My Day** (`app/admin/components/TodayQueue.tsx`)

Task rows already render through `TaskListRow`, whose `TaskMetaLine` shows the
record name whenever the task is linked and `showRecord` is true (the default).
Verify this against the running app. If the name is already rendering, make no
change and say so; do not invent a redundant second label.

**Grouping** (`app/admin/tasks/TasksClient.tsx`)

The "Group: Due date" dropdown currently offers one disabled option and the
note "Other groupings arrive with saved views." Replace that with two live
options:

- **Due date** — today's behaviour, unchanged (Overdue / Today / This week /
  Later / Done today).
- **Matter** — one collapsible section per related record, sections ordered
  alphabetically by record name, with unlinked tasks last under "No related
  matter". Within a section, tasks keep the existing `compareTasks` order
  (effective due date, then priority, then creation).

The grouping choice is component state, not a URL param — it is a view
preference, and the page already keeps its other filters in state.

J/K keyboard navigation walks the rendered order in both modes. The `focusOrder`
memo is derived from whichever grouping is active, so no separate bookkeeping
is needed.

Done-today tasks continue to live in their own collapsed group in both modes.

### Data

No schema or query change. `fetchTasks` already attaches `record_name` for both
matters and leads (`lib/queries/tasks.ts`, `attachDisplayNames`).

### New helper

`groupTasksByRecord(tasks: TaskRow[]): Array<{ key: string; label: string; tasks: TaskRow[] }>`
in `lib/tasks/types.ts`, next to `compareTasks` and `taskDueGroup`. Pure, no
React, unit-testable. Keyed by `matter_id ?? lead_id ?? 'none'` so two records
sharing a display name do not merge.

---

## 2. Bulk delete on the Calls page

### Problem

`app/admin/calls/CallsPageClient.tsx` deletes one call at a time through a
per-row trash button. Clearing a run of junk or test calls means one dialog per
call.

### Change

**Selection UI**

- A checkbox on each call row.
- A toolbar row above the list holding a select-all checkbox (indeterminate
  when a subset is selected) covering the calls currently rendered.
- When one or more are selected, the toolbar shows "N selected" and a Delete
  button. One confirm dialog, naming the count.
- Selection state is a `Set<string>` of call ids. It clears after a successful
  delete and whenever the filter changes.

The existing per-row delete stays — it is faster for a single call.

**API** — new `app/api/admin/calls/bulk-delete/route.ts`

```
POST /api/admin/calls/bulk-delete
body: { ids: string[] }
→ 200 { deleted: number }
```

- `requireAdmin` guard, matching `app/api/admin/calls/[id]/route.ts`.
- Rejects a non-array body, an empty array, any non-UUID id, or more than 200
  ids, each with a 400.
- One `admin.from('calls').delete().in('id', ids)` call.
- `revalidateSidebarCounts()` on success, then `invalidateSidebarCountsClient()`
  and `router.refresh()` on the client.

A client-side loop of single DELETEs was rejected: N round-trips, and a partial
failure leaves the operator guessing which calls survived.

---

## 3. Draft with AI in the side rail's email composer

### Problem

`DraftWithAiButton` is wired into the lead email dialog and both SMS composers,
but not into `ManualEmailComposer` itself — so the side rail's Email tab, the
surface used while working a matter, has no AI drafting.

### Change

**`components/rail/RailEmailPane.tsx`**

Render `DraftWithAiButton` on the Subject row of `ManualEmailComposer`, only
when the composer resolves to a matter or lead (`record` is non-null, whether
from `recordOverride` or `railRecordForPath`). On pages with no record scope
the button is absent — there is no context to draft from, and a permanently
disabled control is noise.

On click it posts `channel: 'email'` to:

- `/api/admin/matters/{id}/draft-reply` for a matter, or
- `/api/admin/leads/{id}/draft-reply` for a lead.

Whatever is already in the body is passed as `notes`, so a half-written draft
steers the model — the same pattern the SMS composers use.

The reply's first line is `Subject: ...` (both routes normalize to this). The
composer parses it: subject → `setSubject`, remainder → `setBodyHtml` via the
existing `textToEmailHtml`, and `templateId` resets to `ONE_OFF` because an AI
draft is by definition not a template render.

**`components/leads/LeadCommunicationDialog.tsx`**

Delete the now-duplicate `DraftWithAiButton` above the composer, its
`applyEmailDraft` helper, and the `emailSubject` / `emailBody` state that only
fed it. The `subjectText` / `bodyText` props on `ManualEmailComposer` exist
solely for that path, so they go too — no other caller passes them.

Result: one AI-drafting code path serving the side rail, the lead email dialog
and the matter Communications email tab.

---

## 4. Call / Email / Text on the matter header

### Problem

The lead detail header carries Call, Email and Text buttons
(`components/leads/LeadTopActions.tsx`). The matter header has only Call.

### Change

**`app/admin/matters/[id]/MatterDetailHeader.tsx`**

Add Email and Text buttons beside the existing `CallPhoneLink`, using the same
`Mail` and `MessageSquare` icons and sizing as the lead header. Email is
disabled without `matter.client_email`; Text is disabled without
`matter.client_phone`. Both are mirrored into the mobile overflow dropdown,
where Call already appears.

Two new props: `onEmail` and `onText`.

**`app/admin/matters/[id]/MatterDetailClient.tsx`**

Wire them to `setActiveTab('communications', undefined, 'email')` and
`setActiveTab('communications', undefined, 'sms')`. That helper already writes
`tab` and `channel` to the URL, so the destination is linkable and browser
back/forward behaves.

This reuses the matter Communications tab — its composer, templates,
attachments, portal/SMS/email history and AI drafting — instead of duplicating
a modal composer over the matter page.

Call keeps its current behaviour: `CallPhoneLink` opens the staff softphone
when voice is configured, and falls back to a `tel:` link when it is not.

---

## Testing

Vitest + Testing Library, matching the existing suites.

| Area | Test |
|---|---|
| Task grouping | `groupTasksByRecord` unit test — ordering, unlinked bucket last, same-name records kept separate |
| Task detail | Sheet renders the record name and links to the matter; renders "No related record" for a free-floating task |
| Tasks page | Grouping is thin wiring over the tested helper — verified in the browser, not unit tested |
| Calls | Route test: auth guard, bad body, non-UUID rejection, over-cap rejection, happy path. Client test: select-all, count, confirm, single request |
| Rail email | AI button absent with no record; present for a matter; a drafted reply fills subject and body |
| Matter header | Email and Text render, are disabled without contact details, and call their handlers |

### Baseline

`AGENTS.md` records pre-existing failures on a clean checkout: `npm run lint`
(5 errors), `npm run typecheck` (errors confined to `tests/*.test.ts`), and
`npm test` (3 failures — `design-sheet-readiness`,
`design-sheet-spouse-fiduciaries`, `draft-payload-children`). Report results
against that baseline; do not claim these as regressions or as fixed.

---

## Out of scope

- Re-linking a task to a different matter from the detail sheet.
- Saved views or persisted grouping preferences on the Tasks page.
- Bulk actions on calls other than delete.
- A modal email/SMS composer on the matter page.
