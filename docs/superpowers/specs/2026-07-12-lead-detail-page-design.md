# Lead Detail Page Redesign

## Goal

Make the lightweight lead page operate like a focused matter detail page without creating a full matter prematurely. The page uses a single-column layout: top actions, editable lead details, internal notes and meeting notes, then activity.

## Page Structure

The header contains Back to Leads plus the lead name and current status. The action row sits directly below it and contains Send/Resend Intake, Draft/Resume Engagement, Convert Matter, and a Lead/Hired/Lost status selector. Hired and Convert use the existing idempotent conversion service; Lost retains the lead.

The content is one column in this order:

1. Lead Details
2. Notes
3. Activity

## Lead Details

The card is read-only by default. Edit opens one form with Save and Cancel. The form covers client name, email, phone, address, marital status, spouse name/email/phone, lead source, practice area, quoted fee, and status.

Save validates required identity fields and email formats, then persists the client-intake and spouse-contact changes as one server operation. If spouse information is removed, the existing spouse contact is removed only after explicit confirmation. Hired status converts the lead before reporting success. Cancel restores the last server-loaded values. A successful save adds one summarized `details_updated` activity event rather than one event per field.

## Notes and Granola

Lead notes use a normalized `lead_notes` table rather than matter IDs. Notes are internal, newest first, and support create, edit, and delete with the same authorization behavior as matter notes. Meeting notes store title, meeting date, attendees, summary/body, source (`manual` or `granola`), external Granola note ID, actor, and timestamps.

The Notes card reuses the matter-page interaction pattern:

- Add note
- Add meeting notes manually
- Import from Granola
- Expand/collapse meeting-note bodies

The Granola search/fetch dialog is extracted into a reusable component whose persistence callback targets either a lead or matter. Importing the same Granola note into the same lead is idempotent. Client data and meeting-note content remain server-side.

When a lead converts, matter history displays linked lead notes and activity without copying or duplicating rows. Existing matter-note behavior remains unchanged.

## Activity

The Activity card is a newest-first, read-only timeline. Notes are managed in Notes, not Activity. Events include lead creation/import, details/status changes, intake sent/completed, engagement drafted/reviewed/sent/viewed/signed, note changes, and conversion/loss. Each event records actor and timestamp.

## API and Data Boundaries

- Extend the lead detail update endpoint to accept the complete edit form and update client plus spouse atomically through a database RPC.
- Add lead-notes list/create/update/delete routes and lead meeting-note create/import routes.
- Keep activity insertion server-side within the same operation that causes the event.
- Add RLS for staff access; note mutation follows existing attorney/admin authorization. Granola credentials remain server-only.
- Do not modify estate drafting internals or convert a lead merely to support notes.

## Error Handling

Validation errors render beside fields. Save/import failures leave the form or dialog open with entered content intact. Conversion conflicts return the already-linked matter. Granola unavailable or duplicate imports produce actionable messages without creating partial notes.

## Verification

- Rendered interaction tests cover Edit, Cancel, validation, Save, spouse upsert/removal confirmation, top actions, and single-column order.
- Route/repository tests cover authorization, atomic updates, notes CRUD, Granola idempotency, activity creation, and conversion reuse.
- Database checks cover RLS and ownership/admin deletion rules.
- Matter detail tests confirm linked lead notes/activity appear once after conversion.
- Run scoped lint, focused tests, TypeScript, and the production Next.js build.

## Boundaries

This redesign does not add reminders/tasks, expose notes to clients, alter Firma webhook contracts, or change estate drafting behavior.
