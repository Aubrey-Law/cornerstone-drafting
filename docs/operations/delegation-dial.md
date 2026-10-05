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

Future unattended flows (invoice reminders, appointment confirmations, receptionist bookings)
opt in the same way as they move onto the registry.

## Undo

An action defines `undo` when it has a clean inverse: create task, add note, create calendar
hold, start, complete and reassign task. Undo runs the inverse from the execution's recorded
before/after projections and marks the row `undone`. A sent email or a stage change has no
undo and says so on the settings page.

## Failure posture

If the settings table cannot be read, the dial resolves to Propose and the proposal waits for
a person. If an acting execution fails, the proposal is marked failed and appears in the
digest as such; nothing retries on its own.
