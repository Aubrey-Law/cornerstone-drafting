# Lead Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current two-column read-only lead page with a single-column, editable lead workflow containing top actions, internal notes and Granola meeting notes, followed by activity.

**Architecture:** A lead-specific client shell coordinates focused Details, Notes, and Activity cards. A transactional Supabase RPC persists client and spouse edits; normalized lead notes remain linked to the lead after conversion, while a reusable Granola picker delegates persistence to either lead or matter routes.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase/Postgres with RLS, Vitest, React Testing Library, existing Granola APIs and UI primitives.

## Global Constraints

- Preserve lightweight leads in `client_intake`; do not create a matter to store notes.
- Do not modify estate drafting internals.
- Notes are internal and never client-visible.
- Page order is top actions, Lead Details, Notes, Activity.
- Lead Details uses explicit Edit, Save, and Cancel rather than autosave.
- Hired and Convert use the existing idempotent conversion service.
- Existing matter-note and Granola behavior must remain compatible.

---

### Task 1: Add Transactional Lead Details and Note Persistence

**Files:**
- Create: `supabase/migrations/20260730000000_lite_lead_details_notes.sql`
- Create: `lib/leads/details.ts`
- Test: `tests/lead-details-persistence.test.ts`

**Interfaces:**
- Produces: `LeadDetailsInput`, `validateLeadDetails(input)`, RPC `update_lead_details(p_lead_id, p_details, p_spouse, p_actor_id)`, and tables `lead_notes`, `lead_meeting_notes`.

- [ ] Write failing tests proving validation accepts complete client/spouse data, rejects malformed emails/fees/statuses, and normalizes blank optional values to `null`.
- [ ] Run `npx vitest run tests/lead-details-persistence.test.ts`; expect missing-module failure.
- [ ] Implement `validateLeadDetails` with statuses `lead|hired|lost`, normalized practice area, nonnegative nullable fee, client identity, address, marital status, source, and nullable spouse.
- [ ] Create the migration:
  - `lead_notes`: lead, body, actor, created/updated timestamps.
  - `lead_meeting_notes`: lead, title, meeting date, attendees, body, source `manual|granola`, unique `(lead_id, granola_note_id)` when present, actor, timestamps.
  - Staff-select/insert/update policies; author-or-admin delete policies.
  - `update_lead_details` locks the lead, rejects converted leads, updates `client_intake`, upserts/deletes the spouse contact, and inserts one summarized `details_updated` activity row atomically.
  - Revoke RPC execution from `PUBLIC` and `anon`; grant only `authenticated` and `service_role`, with an internal attorney/admin check.
- [ ] Add source-shape database tests for RLS, grants, locking, spouse handling, and activity insertion; run the focused test until green.
- [ ] Apply to local/hosted Supabase only after tests pass, then query tables, policies, and function privileges and run security advisors.
- [ ] Commit with `feat: add lead details and notes persistence`.

### Task 2: Build the Editable Single-Column Lead Page

**Files:**
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`
- Create: `components/leads/LeadDetailsCard.tsx`
- Create: `components/leads/LeadTopActions.tsx`
- Modify: `app/api/admin/leads/[id]/route.ts`
- Test: `tests/lead-detail-interactions.test.tsx`

**Interfaces:**
- Consumes: `validateLeadDetails`, `update_lead_details`, existing intake/draft/convert endpoints.
- Produces: PATCH response `{ lead, spouse, matterId?: string }`.

- [ ] Write rendered interaction tests asserting top actions precede all cards, cards appear Details → Notes → Activity, Details begins read-only, Edit reveals every field, Cancel restores server values, and invalid email blocks Save.
- [ ] Run the interaction test and verify it fails on the current page.
- [ ] Split the current lead shell into top actions and details card; use existing Button/Input/Select components and a single form state snapshot.
- [ ] Implement Save through PATCH. For `status: hired`, the route validates/persists details, invokes `createMatterFromIntake`, and returns the existing/new matter ID; for `lost`, it records loss without conversion.
- [ ] Require confirmation before deleting a populated spouse and keep entered values after server errors.
- [ ] Add route tests for unauthorized, unknown, converted, spouse create/update/delete, Hired idempotency, and Lost retention.
- [ ] Run interaction, route, lead, and conversion tests; run scoped ESLint.
- [ ] Commit with `feat: make lead details editable`.

### Task 3: Add Lead Notes and Meeting Notes

**Files:**
- Create: `components/leads/LeadNotesCard.tsx`
- Create: `app/api/admin/leads/[id]/notes/route.ts`
- Create: `app/api/admin/leads/[id]/notes/[noteId]/route.ts`
- Create: `app/api/admin/leads/[id]/meeting-notes/route.ts`
- Modify: `app/admin/leads/[id]/page.tsx`
- Test: `tests/lead-notes.test.tsx`

**Interfaces:**
- Produces note DTOs with `id`, `body`, `actorId`, `createdAt`, `updatedAt`; meeting-note DTOs additionally include title, date, attendees, source, and Granola ID.

- [ ] Write failing API and rendered tests for create/edit/delete ordinary notes, manual meeting notes, newest-first ordering, expand/collapse, and author/admin deletion.
- [ ] Run tests and verify missing-route/component failures.
- [ ] Implement staff-scoped CRUD routes with server-side activity events (`note_added`, `note_updated`, `note_deleted`, `meeting_note_added`).
- [ ] Build the Notes card using the matter-page visual hierarchy: add-note composer, meeting-note list, manual meeting-note dialog, and internal-only label.
- [ ] Load initial notes in the server page and place the card between Details and Activity.
- [ ] Run focused tests and scoped lint; commit with `feat: add lead notes`.

### Task 4: Reuse Granola Import for Leads

**Files:**
- Modify: `components/meeting-notes/AddMeetingNotesDialog.tsx`
- Modify: `app/admin/matters/[id]/MatterMeetingNotesCard.tsx`
- Modify: `components/leads/LeadNotesCard.tsx`
- Create: `app/api/admin/leads/[id]/meeting-notes/granola/route.ts`
- Test: `tests/lead-granola-notes.test.tsx`

**Interfaces:**
- Produces reusable dialog props `{ target: { kind: 'lead'|'matter'; id: string }, onImported(note) }` while retaining existing matter behavior.

- [ ] Write failing tests for opening Granola from a lead, selecting/fetching a note, persisting to the lead route, duplicate import response, and unchanged matter target behavior.
- [ ] Run tests and confirm failures identify the current matter-only coupling.
- [ ] Refactor only the picker/fetch behavior into reusable target-aware props; keep Granola credentials and note fetching server-side.
- [ ] Implement the lead import route: validate Granola ID, fetch through existing helpers, insert with `source='granola'`, return the existing row on unique conflict, and log one activity event only for a new import.
- [ ] Render “Import from Granola” in Lead Notes and preserve dialog state on errors.
- [ ] Run lead and existing matter meeting-note regressions; commit with `feat: import Granola notes into leads`.

### Task 5: Link Lead History After Conversion and Verify

**Files:**
- Modify: `app/admin/matters/[id]/page.tsx`
- Modify: `app/admin/matters/[id]/MatterDetailClient.tsx`
- Modify: `app/admin/matters/[id]/tabs/notes.tsx`
- Test: `tests/lead-conversion-history.test.tsx`

**Interfaces:**
- Consumes linked `client_intake_id`, lead notes, meeting notes, and `mergeLeadAndMatterActivity`.
- Produces combined display DTOs tagged with `origin: 'lead'|'matter'` and stable IDs.

- [ ] Write failing tests proving converted matters display lead notes/activity once, retain chronological order, and do not copy database rows.
- [ ] Run tests and verify the current matter loader omits lead history.
- [ ] Load linked lead notes/activity in the matter server page, merge by stable source identifiers, and display a small “From lead” label.
- [ ] Keep edits routed to the original lead-note endpoint; do not duplicate into matter notes.
- [ ] Run all lead, notes, Granola, matter activity, and conversion tests.
- [ ] Run `npx tsc --noEmit -p tsconfig.json`, scoped ESLint, `git diff --check`, and `npm run build:next`.
- [ ] Visually verify desktop/mobile single-column order, form error states, notes dialogs, and activity chronology.
- [ ] Commit with `feat: preserve lead history after conversion`.

## Release Acceptance

- Lead page is editable through explicit Save/Cancel.
- Top actions appear above a single Details → Notes → Activity column.
- Manual and Granola meeting notes work without a matter.
- Hired/Convert remain idempotent; Lost does not convert.
- Converted matters show linked lead history exactly once.
- Hosted migration, RLS, focused tests, and production build are green.
