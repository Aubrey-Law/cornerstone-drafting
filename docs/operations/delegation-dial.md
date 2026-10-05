# Delegation dial

Settings → Workflow → Delegation. One position per registry action, firm-wide, deciding
how far Cornerstone may take that action when no person is watching.

| Position | Meaning |
| --- | --- |
| Observe | Record what would have been done as an `observed` proposal. No card, no execution. |
| Propose | Today's behavior: a pending card the attorney accepts, with the confirmation the risk level demands. |
| Act and report | Execute at once through the same gate (fresh preview, idempotency claim, audit), then list it in the morning digest and the "Done for you" card on Today, with undo where the action has one. |
| Act silently | Execute at once. The `action_executions` row is the only trace. |

## Ceilings

The ceiling is a function of the action's risk level (`lib/actions/autonomy.ts`) and is enforced
on write (`setActionAutonomy`) and again on read (`resolveActionAutonomy`), so a stale or
hand-edited row can never grant more than the risk allows.

| Risk | Ceiling | Why |
| --- | --- | --- |
| prepare, internal_write | Act silently | Internal records; every one has an audit row |
| external_write | Act and report | Anything that leaves the firm is always reported |
| legal_financial | Propose | Legal judgment stays with the attorney |
| prohibited | Observe | Never executed |

## Who consults the dial

Only unattended callers. `createActionProposal` applies the dial when the request carries
`applyAutonomy: true`; a proposal a person is about to click leaves it unset and behaves as
before. Today that is the automation rule runner (`lib/automations/server.ts`). A rule's
approval policy can only narrow the dial: `required` caps its proposals at Propose,
`automatic` defers to the dial, `prohibited` never runs live.

**Email triage** (`lib/emailTriage/delegate.ts`) consults the dial for
`email.triage.reply.send` right after the scan stores a draft. The triage page is this action's
Propose surface, so at Propose nothing changes; Observe records "would have sent" proposals;
Act and report sends through the registry action, which shares its send path with the page's
"Send reply" button (`lib/emailTriage/sendReply.ts`). Only senders classified as a client or lead
are ever answered unattended; contacts and possible leads always wait on the page. A cron run
sends as the mailbox owner; a manual refresh sends as the person who clicked.

**Invoice reminders** (`lib/billing/delegateReminders.ts`) consult the dial for
`billing.reminder.send` as soon as `prepareInvoiceReminderDrafts` writes a new draft. A draft
already waiting from an earlier run is not offered again. Final notices never send unattended;
friendly and firm reminders may. The send shares `lib/billing/sendInvoiceReminder.ts` with the
approve route: the approve RPC is the claim, the branded invoice is attached, and a failed send
puts the row back to draft. The hourly cron sends as the firm's attorney
(`resolveUnattendedActor`); a rule running `billing.reminders.prepare` sends as the rule's owner.

**Appointment confirmations** (`lib/appointments/delegateConfirmation.ts`) are the one action
whose default position is Act and report rather than Propose (`defaultAutonomy` in the action
catalog): a client who just booked expects the confirmation at once, so by default it still
goes out immediately and now shows in the digest and on Today. Propose holds confirmations for
a click in Today's approvals; Observe records them without sending. Staff bookings send as the
staff member; client bookings send as the firm's attorney. When no staff user can be resolved
or the action service is unreachable, the booking sends directly as it always did, so a
confirmation is never lost to plumbing. The manage link's raw token rides in the proposal
payload because only its hash is stored; the sent email's own log already holds the same link.
Cancellation notices are not yet routed.

**Receptionist bookings** (`lib/retell/followUp.ts`) run when Retell reports a call analysed.
The call's facts come from the agent's `custom_analysis_data` when it is configured to extract
`caller_name`, `caller_email`, `caller_phone`, `reason`, `wants_appointment`, `requested_time`
and `existing_client`; otherwise the light model reads the summary and transcript. The caller is
matched to a matter (the calls table's own phone match), a lead or a contact, and each next step
is its own proposal through the dial, keyed to the call:

| Caller | Proposed |
| --- | --- |
| Existing client (matter matched) | `task.create`: return the call |
| Lead or stranger who named a time, with a full name and email | `appointment.book`: a discovery call at that time, which creates or links the lead and sends the confirmation |
| Lead or stranger who wants an appointment but named no time | `scheduling.link.send` (and `lead.create` for a stranger with a name and email) |
| Stranger with a name and email | `lead.create` |
| Lead with nothing bookable | `task.create`: return the call |
| Stranger with no email | nothing beyond the summary email the receptionist already sends |

All of these start at Propose and wait as cards in the "Waiting for you" section of Today's
"Done for you" card. The summary email to the firm is unchanged.

**Meeting follow-up** (`lib/meetings/followUp.ts`) runs when a meeting note is saved on a hired
matter (`/api/admin/meeting-notes`) or on a lead (the manual and Granola lead meeting-note
routes). The route queues it behind its response (`lib/meetings/schedule.ts`, Next's `after`),
so saving stays quick and nothing in the follow-up can fail the save. The note is read twice:
the design-sheet import's own extraction (`parseDesignSheetImportText`) for field decisions
and the sheet's fiduciary prompt (`proposeFiduciaries`) for appointments, both on a matter only,
and the light model for the attorney's to-dos, what the client agreed to send, and a
plain-language recap. Each becomes its own proposal through the dial, keyed to the note's id so
a re-save proposes nothing twice:

| From the notes | Proposed |
| --- | --- |
| Design decisions that would change the sheet (matter only): field values and fiduciary appointments | `design_sheet.proposal.apply`: one batch, shown line by line as current → proposed. An appointment names who holds the slot now and whether accepting would create a contact. Legal and financial, so it is capped at Propose and always waits for a click. |
| Each thing the attorney agreed to do | `task.create`, dated from the notes or a week out |
| The recap, when the client has an email | `email.draft.compose`: a draft in that record's composer, then `email.draft.send` for the same draft |

Appointments are matched to the people already on the matter when proposed and again when
applied, so a name the matter knows resolves to that contact and a person added in between is
reused rather than created twice. A slot already held by the same person is not proposed.

**Transcripts land on their own.** The meeting-transcripts sweep (`lib/meetings/transcriptSync.ts`,
`/api/cron/meeting-transcripts`, every half hour) reads new Granola notes and the transcripts of
Teams meetings booked through the app, saves each on the matter or lead the meeting belonged to,
and runs the same follow-up as a manual save. The record is taken from the appointment on the
calendar at that time when it is linked to one, else from exactly one open matter or exactly one
active lead whose email was in the meeting; two candidates or none means the note is recorded as
skipped and left for the "Add meeting notes" dialog. Every transcript the sweep looks at is written
to `meeting_transcript_imports`, so nothing is read twice. The sweep acts as the firm's attorney
(`resolveUnattendedActor`) and saves at most five notes a run. Teams transcripts need the
`OnlineMeetingTranscript.Read.All` scope; a connection made before it reports `reconnect_needed`
until the attorney reconnects from Settings. Granola needs `GRANOLA_API_KEY`.

The compose action is a preparation that defaults to Act and report (`defaultAutonomy`), so
the recap is in the composer by the time the attorney looks, and its undo removes only a draft
it created. A draft the attorney already had open on that record is kept untouched. The send
is a separate external write: at Propose it waits as a card in "Waiting for you"; at Act it
goes. A Granola re-import of the same note, or a note under forty characters, proposes nothing.

Every unattended flow in the app now consults the dial; the next ones to add should opt in the
same way as they move onto the registry.

## Undo

An action defines `undo` when it has a clean inverse: create task, add note, create calendar
hold, start, complete and reassign task. Undo runs the inverse from the execution's recorded
before/after projections and marks the row `undone`. A sent email or a stage change has no
undo and says so on the settings page.

## Failure posture

If the settings table cannot be read, the dial resolves to Propose and the proposal waits for
a person. If an acting execution fails, the proposal is marked failed and appears in the
digest as such; nothing retries on its own.
