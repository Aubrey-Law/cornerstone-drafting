# Lead Detail Page Design 2a

## Goal

Rebuild `/admin/leads/[id]` around the question “What should I do next for this lead?” The page will put one deterministic next action above the fold, eliminate blank-value placeholders and duplicate controls, support field-level editing, and combine notes, meetings, calls, and system activity into one timeline.

This work preserves the existing Cornerstone design tokens, shadcn primitives, lead/intake routes, engagement and conversion behavior, transactional persistence, and estate-drafting boundaries. It adds no dependency and does not include design 2b’s stage rail.

## Page Structure

`LeadDetailClient` will render a full-width page without the existing centered `max-w-6xl` wrapper.

The header contains:

- A back link to Leads.
- The lead name at 21px and weight 600.
- A status pill reading `Lead · day N`, where `N` is the calendar-day age of the lead from `created_at`.
- A `Last touch Nd ago` pill based on the newest timestamp among activity, notes, meeting notes, and calls. If none exists, the pill is omitted.
- A subtitle containing the populated values from practice area, lead source, phone, and email.
- `Draft engagement` or `Resume engagement`, `Hire matter` or `View matter`, `Mark lost`, and one overflow menu.

The status selector is removed. The overflow menu provides the remaining valid status transition, including reactivating a lost lead when permitted by the current API rules. The visible status pill is the only status display on the page. `Send intake` is not rendered in the header.

The body uses `px-6 py-4` and:

```text
grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4 items-start
```

At `xl` and above, the left column contains Lead Details followed by the Intake strip. The right column contains a sticky Lead Timeline. Below `xl`, the order is Next Action, Lead Details, Intake, Lead Timeline. The layout must not overflow horizontally at 1280px and must fill the available width at 2400px.

## Next-Action Model

`lib/leads/nextAction.ts` exports the requested `NextAction` type and a pure `computeNextAction` function. It performs no fetching and does not read the clock implicitly. The caller supplies timestamps, and tests freeze or explicitly control the current time used to classify relative dates.

The first matching rule wins:

1. Hired or lost leads return `nothing`.
2. Unsent, incomplete intake returns `send_intake`. If a future appointment falls within 14 days, the title is `Send intake before the discovery call`; otherwise it is `Send intake to get the facts`.
3. Sent, incomplete intake with an appointment no more than three days away returns the resend variant, `Resend intake — still unanswered`.
4. Completed intake without a quoted fee returns `quote_fee`.
5. A quoted fee without an active agreement returns `draft_engagement`.
6. A last touch older than seven days returns `follow_up`.
7. A completed intake not otherwise requiring action returns `review_intake`; all other cases return `nothing`.

Appointment details use the soonest future, non-cancelled appointment linked through `appointments.linked_lead_id`. The detail states its date and whole-day distance and includes `Intake has never been sent.` for the initial-send state.

`LeadNextAction` renders the result as a `role="status"` ribbon with the required badge, token-only colors, title, detail, and right-aligned actions. The ribbon is omitted when the action is `nothing`.

Branch copy and actions are deterministic:

- `quote_fee`: title `Quote the engagement fee`, detail `The intake is complete, but no fee has been quoted.`, with primary `Quote fee` and secondary `Review intake`.
- `draft_engagement`: title `Draft the engagement agreement`, detail `The fee is set and the lead is ready for an agreement.`, with primary `Draft engagement` and secondary `Review intake`.
- `follow_up`: title `Follow up with this lead`, detail states the number of days since the last touch, with primary `Call` when a callable phone exists and secondary `Email` when an email exists.
- `review_intake`: title `Review the completed intake`, detail `Confirm the intake before the next client step.`, with primary `Review intake`.

The component maps intents to existing behavior:

- Send or resend intake uses the existing intake-send route.
- Fill it myself opens `AdminIntakeSheet`.
- Import opens the existing lead intake import dialog.
- Quote fee activates the Quoted fee inline editor.
- Draft engagement uses the existing engagement-draft route.
- Follow up opens the staff softphone when a callable number exists; otherwise it provides an accessible email link when an email exists.
- Snooze calls the new snooze endpoint behavior described below.

The required `computeNextAction` signature does not include snooze state. `LeadDetailClient` suppresses an otherwise-visible ribbon while `lead_next_action_snoozed_until` is in the future.

## Snoozing

A migration adds:

```sql
lead_next_action_snoozed_until timestamptz null
```

to `client_intake`.

The existing lead PATCH route accepts a dedicated `nextActionSnoozedUntil` field. The server validates that it is a future ISO timestamp or `null`, updates the lead, and inserts one `lead_activity` row in the same database transaction. The activity title describes the snooze and its detail records the selected expiration. The UI initially uses one deterministic snooze duration of seven days; no duration picker is in scope.

## Field-Level Lead Editing

`LeadDetailsCard` removes the whole-card editing state and Save/Cancel controls. Each populated field renders as a keyboard-focusable button. Enter or click changes only that field to its appropriate input, select, or textarea.

Editing behavior:

- Enter commits text and numeric inputs.
- Blur commits when the value changed and remains valid.
- Escape restores the previously persisted value without sending a request.
- Select choices commit when selected.
- Each request PATCHes only the edited field.
- A per-field `aria-live="polite"` indicator reports Saving and Saved.
- Validation errors keep or restore the previous server value as appropriate, return focus to the field trigger, and surface a Sonner error toast.
- Controls retain explicit accessible labels and error descriptions.

The client partial PATCH contract is mapped to the existing database update shape on the server. The route loads the current lead and spouse, merges the one validated field into that server snapshot, validates the resulting complete record, and invokes the existing transactional lead-details RPC. It must not trust a client-supplied full snapshot or bypass spouse/audit transaction boundaries.

Status is not a Lead Details field. Status transitions continue through the dedicated top-action paths.

### Visible and Missing Fields

The card’s populated area uses a three-column grid and renders only fields that have values. It includes the fields needed to calculate a 14-field completeness measure:

1. Name
2. Email
3. Phone
4. Address
5. Date of birth
6. Marital status
7. Spouse, when married
8. Practice area
9. Lead source
10. Quoted fee
11. Urgency
12. Estimated estate value
13. Minor children
14. Qualification notes

Conditional spouse completeness counts as complete when the lead is not married. Address is complete when street, city, state, and ZIP are populated. Name is complete when first and last name are populated.

The card displays `{filled} of 14 complete` and a 4px progress bar.

Below a divider, every incomplete field appears exactly once as a dashed, rounded `+ Add {label}` chip. Priority chips are ordered Address, Marital status, Spouse, Estate value, Minor children, Quoted fee, Urgency, and DOB; remaining incomplete fields follow in the completeness-list order. No em-dash placeholder is rendered.

Clicking a chip opens only that field’s editor. `+ Add Spouse` enters the existing spouse add flow. Removing a populated spouse retains the existing confirmation dialog and persists the removal through the transactional route.

The footer reads `Intake answers land here automatically — you rarely need to type these.` and retains `MatterAssistantQuickPrompts` on a muted background with:

- Summarize intake
- Analyze MA estate tax
- Draft a pre-call email

## Intake Status Strip

`LeadIntakeCard` becomes a compact status strip. It contains:

- Heading `Intake`.
- One state line, such as `Never sent · nothing submitted · 0 of 7 sections`.
- `Open intake` and `Copy link` buttons. `Copy link` is disabled with an accessible explanation until a link exists.
- Seven labeled progress segments: Contact, Household, Assets, Real estate, Fiduciaries, Wishes, Review.

Send, Resend, Fill, and Import controls live in the next-action ribbon and are not duplicated in the strip. The assistant quick prompts move to Lead Details.

Progress is derived from `lib/intakeSections.ts` and `lib/intakeReadiness.ts`, with these explicit group rules:

- Contact: referral and personal. Optional referral does not block completion; personal must be complete.
- Household: family plus every active spouse and children section.
- Assets: the estate section’s non-real-property requirements.
- Real estate: complete when `has_real_property` is false; when true, both address and value must be populated. An unanswered `has_real_property` is incomplete.
- Fiduciaries: every active client, spouse, and guardian fiduciary section. Warning-only unanswered nominations use the existing section-completion behavior rather than submission readiness.
- Wishes: goals.
- Review: the intake status is submitted or approved.

The strip receives the actual intake row loaded by the page. It does not infer completion from `intake_sent_at` or fabricate section state.

## Unified Lead Timeline

`components/leads/LeadTimelineCard.tsx` replaces the page’s separate `LeadNotesCard`, `LeadActivityCard`, and Calls card.

The timeline card contains:

- An `Add an internal note` composer and `Add` button.
- Secondary actions for Meeting note, Import Granola, and Log call.
- Filter chips for All, Notes, Calls, and System.
- One newest-first list with a 22px marker, 1px connector, title, actor/date metadata, and optional body.
- One muted footer line when there are no calls, rather than a separate empty Calls card.

Meeting-note and Granola dialogs reuse the current components and routes. Log call opens the existing staff softphone; it is disabled with an accessible explanation if the lead has no callable phone. Prefilling or automatically dialing the number is not part of design 2a.

### Timeline Data

The page server-loads notes, meeting notes, activity, and the initial lead-linked calls. Each source is normalized to a shared discriminated timeline item before rendering:

- Notes use `createdAt`, body, and `actorId`.
- Meeting notes use their creation timestamp for ordering while displaying the meeting date in their body metadata.
- Calls use their recorded creation/start timestamp and the existing call title/body presentation.
- Activity uses `created_at`, title, detail, event type, and actor where available.

The loader resolves actor display names in one batched users query. Unknown actors display `System`, never an invented name.

System activity echoes are removed when the underlying note is already present. Deduplication uses explicit provenance identifiers when available. For legacy rows without provenance, only `note added` and `meeting note added` event types are suppressed when a corresponding note from the same lead, actor, and timestamp window exists. Other activity is retained.

Note editing and deletion remain inline and are revealed on hover or keyboard focus. Permission remains `currentUser.id === actorId || currentUser.role === 'admin'`. Existing atomic note routes remain the only mutation path.

Filters behave as follows:

- Notes includes internal and meeting notes.
- Calls includes calls.
- System includes retained activity.
- All includes every normalized item.

## Data Loading and Last Touch

The lead page loader extends its existing parallel queries to fetch:

- The soonest future non-cancelled linked appointment.
- Lead-linked calls needed by the timeline.
- Actor display information.

`Last touch` is the newest timestamp from notes, meeting-note creation, calls, and activity. It does not use `updated_at` from the lead itself because field edits already appear in activity. Relative-day calculations use calendar days in the configured local timezone and clamp future timestamps to zero days ago.

## Error Handling and Accessibility

- Existing top-action errors retain `role="alert"` and `aria-live="polite"`.
- The ribbon retains `role="status"`.
- Inline editors have stable labels, descriptions, keyboard behavior, visible focus styles, and per-field save state.
- Failed edits restore the last persisted value and show an actionable toast.
- Timeline mutation errors preserve composer/dialog content.
- Calls or actor-loading failures render a muted inline failure state without hiding notes and activity.
- The page uses no empty-value em dashes.
- Both light and dark themes use only existing semantic tokens.

## Testing

### Pure Unit Tests

`computeNextAction` tests cover:

- Hired and lost suppression.
- Initial intake with and without an appointment inside 14 days.
- Sent-but-unanswered intake with an appointment inside three days.
- Completed intake without a fee.
- Fee quoted without an agreement.
- Last touch older than seven days.
- Review-intake and nothing fallbacks.
- Boundary dates at 3, 7, and 14 days.

Intake progress tests cover each seven-segment aggregation, including conditional spouse, children, real-property, and guardian states.

### Interaction Tests

Tests verify:

- The ribbon is the first body element and its primary action sends intake.
- Send intake and the visible lead status each occur once.
- Only populated fields render as detail cells and all blanks render as chips.
- One field can be edited and committed without card-level Save/Cancel controls.
- Enter, blur, and Escape behavior.
- Partial PATCH requests contain only the edited field.
- Save failure restores the prior value and announces the error.
- Spouse add/remove confirmation remains intact.
- Notes, meetings, calls, and activity render in one ordered list.
- A note and its activity echo render once.
- Filters, note permissions, and empty-calls footer behavior.
- The three assistant prompts render in the details footer.

### Route and Database Tests

Tests verify:

- Partial field input is merged with the persisted server snapshot.
- Required identity fields cannot be erased into an invalid record.
- Spouse and activity mutations retain the existing transactional RPC.
- Snooze validation, persistence, activity creation, clearing, and authorization.
- Appointment and call loader queries are scoped to the lead.

### Verification Boundary

Run changed-file ESLint, focused lead/intake/call/appointment tests, `git diff --check`, and the production Next.js build. Run the full test suite and typecheck as a regression signal, but distinguish the documented baseline failures in `AGENTS.md` from changes caused by this work.

Perform a browser check in both themes at approximately 1280px and 2400px. Confirm there is no horizontal overflow, the timeline becomes a single-column final section below `xl`, and focus/keyboard editing works.

## Out of Scope

- Design 2b’s stage rail.
- New dependencies or new color tokens.
- Changes to estate drafting, design sheets, draft payloads, or generators.
- Replacing existing engagement, conversion, intake import, note, meeting-note, Granola, or call persistence systems.
- Reminder/task scheduling beyond the fixed seven-day next-action snooze.
