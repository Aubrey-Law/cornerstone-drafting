# Lead Detail Design 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/admin/leads/[id]` into a full-width, next-action-first workflow with inline field editing, real seven-section intake progress, and one deduplicated lead timeline.

**Architecture:** Keep `LeadDetailClient` as the interaction coordinator while extracting pure next-action, intake-progress, and timeline functions. Preserve the existing intake, engagement, conversion, notes, meeting-note, Granola, calls, and transactional lead-update paths. Partial field requests are merged with a trusted server snapshot before invoking the current database RPC; snoozing uses one new atomic RPC.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui, Supabase/Postgres, Zod, Vitest, Testing Library, Sonner.

## Global Constraints

- Do not modify estate drafting, design sheets, draft payloads, or estate generators.
- Do not port drafting code from `aubrey-law-app`.
- Add no dependencies and no new color tokens or gradients.
- Buttons remain `size="sm"` or `h-8`; missing chips use `h-7 rounded-full border border-dashed`.
- Preserve existing intake, engagement, conversion, note, Granola, and call APIs except partial lead PATCH and snooze support.
- Preserve transactional spouse/audit behavior and exact-once note/activity behavior.
- Preserve current accessible labels, alerts, and live regions; inline editors support Tab, Enter, blur, and Escape.
- Render no empty-value em-dash placeholders.
- Do not implement design 2b’s stage rail.
- Preserve the unrelated untracked file `tests/softphone-popup.test 2.tsx`.

## File Map

**Create**

- `lib/leads/nextAction.ts` — pure next-action precedence.
- `lib/leads/intakeProgress.ts` — seven-segment progress aggregation.
- `lib/leads/timeline.ts` — normalize, dedupe, sort, and filter timeline sources.
- `components/leads/LeadNextAction.tsx` — accessible action ribbon.
- `components/leads/LeadTimelineCard.tsx` — composer, filters, actions, and combined list.
- `tests/lead-next-action.test.ts`
- `tests/lead-intake-progress.test.ts`
- `tests/lead-timeline.test.ts`
- `supabase/migrations/20260811000000_lead_next_action_snooze.sql`

**Modify**

- `app/admin/leads/[id]/page.tsx`
- `app/admin/leads/[id]/LeadDetailClient.tsx`
- `app/admin/leads/[id]/LeadIntakeCard.tsx`
- `app/api/admin/leads/[id]/route.ts`
- `lib/leads/details.ts`
- `components/leads/LeadTopActions.tsx`
- `components/leads/LeadDetailsCard.tsx`
- `components/calls/CallList.tsx`
- `app/admin/components/StaffSoftphone.tsx`
- `types/database.ts`
- `tests/lead-details-persistence.test.ts`
- `tests/lead-detail-route.test.ts`
- `tests/lead-detail-interactions.test.tsx`
- `tests/lead-notes.test.tsx`
- `tests/lead-granola-notes.test.tsx`
- `tests/calls-lead-link.test.ts`

Remove `LeadNotesCard.tsx` and `LeadActivityCard.tsx` only after `rg` confirms no remaining runtime consumer.

---

### Task 1: Pure Next-Action Decision Model

**Files:**
- Create: `lib/leads/nextAction.ts`
- Create: `tests/lead-next-action.test.ts`

**Interfaces:**

```ts
export type NextAction = {
  key: 'send_intake' | 'review_intake' | 'quote_fee'
    | 'draft_engagement' | 'follow_up' | 'nothing'
  title: string
  detail: string
  actions: { label: string; kind: 'primary' | 'secondary'; intent: string }[]
}

export function computeNextAction(input: {
  leadStatus: string
  intakeSentAt: string | null
  intakeCompletedAt: string | null
  nextAppointmentAt: string | null
  feeQuoted: number | null
  hasActiveAgreement: boolean
  lastTouchAt: string | null
}): NextAction
```

- [ ] **Step 1: Write failing precedence and date-boundary tests**

Use fake time:

```ts
beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-25T16:00:00Z')))
afterEach(() => vi.useRealTimers())
```

Cover hired/lost suppression, unsent intake with and without a day-14 appointment, unanswered intake at day 3 versus day 4, completed intake without fee, fee without agreement, last touch at day 7 versus older, review fallback, and nothing fallback. Assert the exact approved titles, detail sentences, labels, kinds, and intents.

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest run tests/lead-next-action.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure function**

```ts
const DAY_MS = 86_400_000
const daysUntil = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS)
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY_MS)

export function computeNextAction(input: NextActionInput): NextAction {
  if (input.leadStatus === 'hired' || input.leadStatus === 'lost') return NOTHING
  const appointmentDays = input.nextAppointmentAt ? daysUntil(input.nextAppointmentAt) : null

  if (!input.intakeCompletedAt && !input.intakeSentAt) {
    const soon = appointmentDays !== null && appointmentDays >= 0 && appointmentDays <= 14
    return initialIntakeAction(input.nextAppointmentAt, appointmentDays, soon)
  }
  if (!input.intakeCompletedAt && input.intakeSentAt
      && appointmentDays !== null && appointmentDays >= 0 && appointmentDays <= 3) {
    return unansweredIntakeAction(input.nextAppointmentAt!, appointmentDays)
  }
  if (input.intakeCompletedAt && input.feeQuoted === null) return QUOTE_FEE
  if (input.feeQuoted !== null && !input.hasActiveAgreement) return DRAFT_ENGAGEMENT
  if (input.lastTouchAt && daysSince(input.lastTouchAt) > 7) {
    return followUpAction(daysSince(input.lastTouchAt))
  }
  if (input.intakeCompletedAt) return REVIEW_INTAKE
  return NOTHING
}
```

Define `NOTHING`, `QUOTE_FEE`, `DRAFT_ENGAGEMENT`, and `REVIEW_INTAKE` as readonly objects with the exact spec copy. `initialIntakeAction`, `unansweredIntakeAction`, and `followUpAction` construct only the approved dynamic date/day text. Do not include snooze state in this function.

- [ ] **Step 4: Run the test to verify success**

```bash
npx vitest run tests/lead-next-action.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/leads/nextAction.ts tests/lead-next-action.test.ts
git commit -m "feat: compute lead next actions"
```

---

### Task 2: Trusted Partial Updates and Atomic Snoozing

**Files:**
- Create: `supabase/migrations/20260811000000_lead_next_action_snooze.sql`
- Modify: `lib/leads/details.ts`
- Modify: `app/api/admin/leads/[id]/route.ts`
- Modify: `types/database.ts`
- Modify: `tests/lead-details-persistence.test.ts`
- Modify: `tests/lead-detail-route.test.ts`

**Interfaces:**

```ts
export const leadEditableFields = [
  'firstName', 'middleName', 'lastName', 'preferredName',
  'email', 'phone', 'dateOfBirth', 'address',
  'maritalStatus', 'practiceArea', 'source', 'fee', 'urgency',
  'estimatedEstateValue', 'hasMinorChildren', 'qualificationNotes', 'spouse',
] as const
export type LeadEditableField = typeof leadEditableFields[number]

export function mergeLeadFieldPatch(
  lead: LeadSnapshotRow,
  spouse: LeadSpouseSnapshot | null,
  patch: { field: LeadEditableField; value: unknown },
): ValidatedLeadDetails
```

- [ ] **Step 1: Write failing validation and route tests**

Test that a phone-only patch preserves the server’s identity and spouse fields; status is rejected as an inline field; required identity cannot be erased; the route loads current lead/spouse before validation; only the merged payload reaches `update_lead_opportunity_details`; legacy complete status requests remain supported; unauthorized requests stop before database access.

Add snooze tests for a valid future ISO timestamp, malformed timestamp, past timestamp, missing lead, converted lead, exact single activity insert, and service-role actor validation.

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/lead-details-persistence.test.ts tests/lead-detail-route.test.ts
```

Expected: FAIL on missing partial-patch helpers and snooze schema.

- [ ] **Step 3: Add strict partial-patch parsing and server snapshot mapping**

```ts
const leadFieldPatchSchema = z.object({
  field: z.enum(leadEditableFields),
  value: z.unknown(),
}).strict()

export function mergeLeadFieldPatch(lead, spouse, patch) {
  const complete = snapshotToLeadDetailsInput(lead, spouse)
  if (patch.field === 'address') completeAddress(complete, patch.value)
  else if (patch.field === 'spouse') complete.spouse = parseSpouseValue(patch.value)
  else assignScalarField(complete, patch.field, patch.value)
  return validateLeadDetails(complete)
}
```

`completeAddress`, `parseSpouseValue`, and `assignScalarField` each use explicit Zod schemas. Never spread request keys into the database or trusted snapshot.

- [ ] **Step 4: Add the migration**

```sql
alter table public.client_intake
  add column if not exists lead_next_action_snoozed_until timestamptz;

create or replace function public.snooze_lead_next_action(
  p_lead_id uuid,
  p_until timestamptz,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lead public.client_intake;
  v_activity public.lead_activity;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_actor_id is null or not exists (
    select 1 from public.users u
    where u.id = p_actor_id and u.role in ('attorney', 'admin')
  ) then
    raise exception 'Attorney or admin access required' using errcode = '42501';
  end if;
  if p_until <= statement_timestamp() then
    raise exception 'Snooze time must be in the future' using errcode = '22023';
  end if;

  select * into v_lead from public.client_intake
  where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if v_lead.lead_status in ('hired', 'lost') then
    raise exception 'Next action is unavailable for this lead' using errcode = '22023';
  end if;

  update public.client_intake
  set lead_next_action_snoozed_until = p_until,
      updated_at = statement_timestamp()
  where id = p_lead_id returning * into v_lead;

  insert into public.lead_activity (lead_id, event_type, title, detail, actor_id)
  values (
    p_lead_id, 'next_action_snoozed', 'Next action snoozed',
    'Snoozed until ' || to_char(
      p_until at time zone 'America/New_York',
      'Mon FMDD, YYYY FMHH12:MI AM'
    ),
    p_actor_id
  ) returning * into v_activity;

  return jsonb_build_object('lead', to_jsonb(v_lead), 'activity', to_jsonb(v_activity));
end;
$$;

revoke execute on function public.snooze_lead_next_action(uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.snooze_lead_next_action(uuid, timestamptz, uuid)
  to service_role;
```

- [ ] **Step 5: Discriminate request shapes in the route**

Handle `{ nextActionSnoozedUntil }` first, `{ field, value }` second, and the current complete payload last. The snooze path validates a future ISO timestamp and calls `snooze_lead_next_action`. The field path loads current lead and spouse, calls `mergeLeadFieldPatch`, then invokes the current update RPC. Neither new path changes lead status.

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/lead-details-persistence.test.ts tests/lead-detail-route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260811000000_lead_next_action_snooze.sql \
  lib/leads/details.ts 'app/api/admin/leads/[id]/route.ts' \
  types/database.ts tests/lead-details-persistence.test.ts tests/lead-detail-route.test.ts
git commit -m "feat: persist lead field edits and snoozes"
```

---

### Task 3: Seven-Segment Intake Progress

**Files:**
- Create: `lib/leads/intakeProgress.ts`
- Create: `tests/lead-intake-progress.test.ts`
- Modify: `app/admin/leads/[id]/LeadIntakeCard.tsx`
- Modify: `tests/lead-detail-interactions.test.tsx`

**Interfaces:**

```ts
export type LeadIntakeSegment = {
  id: 'contact' | 'household' | 'assets' | 'real_estate'
    | 'fiduciaries' | 'wishes' | 'review'
  label: string
  complete: boolean
}
export function getLeadIntakeProgress(intake: IntakeRow): LeadIntakeSegment[]
```

- [ ] **Step 1: Write failing aggregation tests**

Test fixed seven-label order; Contact requiring personal but not optional referral; conditional spouse/children Household behavior; Assets blocking on non-property estate requirements; Real estate false/true/address/value cases; conditional spouse/guardian Fiduciaries; Wishes; and submitted/approved Review.

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest run tests/lead-intake-progress.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement aggregation from current intake helpers**

```ts
function activeStepComplete(intake: IntakeRow, id: string) {
  const step = getStepById(id)
  if (!step) throw new Error(`Unknown intake step: ${id}`)
  if (step.condition && !step.condition(intake)) return true
  return step.isComplete(intake)
}

export function getLeadIntakeProgress(intake: IntakeRow): LeadIntakeSegment[] {
  return [
    { id: 'contact', label: 'Contact', complete: activeStepComplete(intake, 'personal') },
    { id: 'household', label: 'Household',
      complete: ['family', 'spouse', 'children'].every(id => activeStepComplete(intake, id)) },
    { id: 'assets', label: 'Assets', complete: estateWithoutRealPropertyComplete(intake) },
    { id: 'real_estate', label: 'Real estate', complete: realEstateComplete(intake) },
    { id: 'fiduciaries', label: 'Fiduciaries',
      complete: ['fiduciaries', 'spouse_fiduciaries', 'guardian']
        .every(id => activeStepComplete(intake, id)) },
    { id: 'wishes', label: 'Wishes', complete: activeStepComplete(intake, 'goals') },
    { id: 'review', label: 'Review',
      complete: intake.status === 'submitted' || intake.status === 'approved' },
  ]
}
```

`realEstateComplete` returns true only for explicit false or true with both populated property fields. `estateWithoutRealPropertyComplete` reuses the estate issues/completion rules while neutralizing only the two separately represented property fields.

- [ ] **Step 4: Rebuild `LeadIntakeCard`**

Props become `{ intake, intakeUrl, onOpen, onCopy }`. Render the state sentence, `Open intake`, `Copy link`, and seven labeled segments with accessible complete/incomplete labels. Do not render Send, Resend, Import, or assistant prompts.

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/lead-intake-progress.test.ts tests/lead-detail-interactions.test.tsx
```

Expected: progress and intake-strip assertions PASS. Failures belonging to later header/details tasks remain expected.

- [ ] **Step 6: Commit**

```bash
git add lib/leads/intakeProgress.ts tests/lead-intake-progress.test.ts \
  'app/admin/leads/[id]/LeadIntakeCard.tsx' tests/lead-detail-interactions.test.tsx
git commit -m "feat: show real lead intake progress"
```

---

### Task 4: Unified Timeline

**Files:**
- Create: `lib/leads/timeline.ts`
- Create: `components/leads/LeadTimelineCard.tsx`
- Create: `tests/lead-timeline.test.ts`
- Modify: `components/calls/CallList.tsx`
- Modify: `app/admin/components/StaffSoftphone.tsx`
- Modify: `tests/lead-notes.test.tsx`
- Modify: `tests/lead-granola-notes.test.tsx`
- Modify: `tests/calls-lead-link.test.ts`

**Interfaces:**

```ts
export type LeadTimelineItem = {
  id: string
  kind: 'note' | 'meeting' | 'call' | 'system'
  title: string
  body: string | null
  actorId: string | null
  actorName: string
  occurredAt: string
  editableNoteId?: string
}
export function buildLeadTimeline(sources: LeadTimelineSources): LeadTimelineItem[]
export function filterLeadTimeline(
  items: LeadTimelineItem[],
  filter: 'all' | 'notes' | 'calls' | 'system',
): LeadTimelineItem[]
```

- [ ] **Step 1: Write failing pure tests**

Test note and meeting normalization, call normalization, cross-source descending sort, unknown actor as System, each filter, and dedupe of a note plus matching `note added` echo. Prove unrelated activity remains.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/lead-timeline.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement conservative dedupe**

Prefer explicit source-note metadata when available. For legacy echoes, suppress only note-added/meeting-note-added event types with the same actor and timestamps within five seconds:

```ts
const ECHO_WINDOW_MS = 5_000
const matchesLegacyEcho = (activity, item) =>
  recognizedEchoKind(activity) === item.kind
  && activity.actor_id === item.actorId
  && Math.abs(Date.parse(activity.created_at) - Date.parse(item.occurredAt)) <= ECHO_WINDOW_MS
```

Never dedupe by title alone.

- [ ] **Step 4: Build `LeadTimelineCard`**

Move existing note composer, edit/delete, meeting dialog, and Granola dialog behavior from `LeadNotesCard`. Keep the pending guard, content preservation on errors, existing routes, and author-or-admin permission. Add `All`, `Notes`, `Calls`, and `System` chips with `aria-pressed`. Render one marker/connector list and one muted calls-empty footer.

- [ ] **Step 5: Add the softphone open event**

```ts
export const OPEN_STAFF_SOFTPHONE_EVENT = 'cornerstone:open-softphone'

useEffect(() => {
  const openPhone = () => setOpen(true)
  window.addEventListener(OPEN_STAFF_SOFTPHONE_EVENT, openPhone)
  return () => window.removeEventListener(OPEN_STAFF_SOFTPHONE_EVENT, openPhone)
}, [])
```

`Log call` dispatches this event. Do not prefill or dial.

- [ ] **Step 6: Migrate tests**

Change note/Granola tests to render `LeadTimelineCard`, retaining all mutation and failure assertions. Add combined ordering, filters, exact-once echo, note permissions, calls-empty footer, and Log call event tests. Update the calls source-contract test to expect initial call rows passed to the timeline, not `<CallList>` on the page.

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/lead-timeline.test.ts tests/lead-notes.test.tsx \
  tests/lead-granola-notes.test.tsx tests/calls-lead-link.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/leads/timeline.ts components/leads/LeadTimelineCard.tsx \
  components/calls/CallList.tsx app/admin/components/StaffSoftphone.tsx \
  tests/lead-timeline.test.ts tests/lead-notes.test.tsx \
  tests/lead-granola-notes.test.tsx tests/calls-lead-link.test.ts
git commit -m "feat: unify the lead timeline"
```

---

### Task 5: Inline Details and Completeness

**Files:**
- Modify: `components/leads/LeadDetailsCard.tsx`
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`
- Modify: `tests/lead-detail-interactions.test.tsx`

**Interfaces:**

```ts
type LeadDetailsCardProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  activeField: LeadEditableField | null
  onActiveFieldChange: (field: LeadEditableField | null) => void
  onSaveField: (field: LeadEditableField, value: unknown) => Promise<void>
  onRemoveSpouse: () => void
}
```

- [ ] **Step 1: Write failing inline-edit tests**

Assert no card-level Edit/Save/Cancel; populated-only cells; blank chips; no status field or em-dash placeholder; exact completeness count; one-click phone editor; Enter commit sending only `{ field: 'phone', value }`; blur commit; Escape cancellation without fetch; Saving/Saved live state; error rollback/toast; and spouse confirmation.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/lead-detail-interactions.test.tsx
```

- [ ] **Step 3: Replace scattered field arrays with one registry**

```ts
type FieldDefinition = {
  key: LeadEditableField
  label: string
  missingLabel: string
  complete: (lead: LeadRecord, spouse: LeadSpouse | null) => boolean
  display: (lead: LeadRecord, spouse: LeadSpouse | null) => string | null
  input: 'text' | 'email' | 'date' | 'number' | 'select' | 'textarea'
    | 'address' | 'spouse'
  options?: readonly { value: string; label: string }[]
}
```

Encode the exact 14 completeness units. Non-married spouse counts complete; Address requires street/city/state/ZIP; Name requires first/last.

- [ ] **Step 4: Implement one-field editor behavior**

Maintain one local draft and last persisted value. Enter commits non-textareas; Escape restores; blur commits only when focus leaves the full compound editor. On failure, restore the persisted value, close, return focus to the trigger, and let the coordinator show `toast.error`.

- [ ] **Step 5: Render meter, missing chips, and footer**

Use a three-column populated grid, 4px bar, priority order Address/Marital status/Spouse/Estate value/Minor children/Quoted fee/Urgency/DOB, then remaining incomplete fields. Add the caption and exact assistant prompts:

```ts
[
  { label: 'Summarize intake', prompt: "Summarize this client's situation" },
  { label: 'Analyze MA estate tax', prompt: 'Analyze MA estate tax exposure' },
  { label: 'Draft a pre-call email', prompt: 'Draft a pre-call email for this lead' },
]
```

- [ ] **Step 6: Wire partial saving**

```ts
async function saveField(field: LeadEditableField, value: unknown) {
  try {
    const json = await call<LeadPatchResponse>(
      `/api/admin/leads/${lead.id}`, { field, value }, 'PATCH',
    )
    setLead(json.lead)
    setSpouse(json.spouse)
    await refreshActivity()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not save field')
    throw error
  }
}
```

Remove whole-card `form`, `editing`, `save`, and `cancel` state after the new tests pass.

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/lead-detail-interactions.test.tsx \
  tests/lead-details-persistence.test.ts tests/lead-detail-route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/leads/LeadDetailsCard.tsx \
  'app/admin/leads/[id]/LeadDetailClient.tsx' tests/lead-detail-interactions.test.tsx
git commit -m "feat: edit lead details inline"
```

---

### Task 6: Header, Ribbon, and Full-Width Composition

**Files:**
- Create: `components/leads/LeadNextAction.tsx`
- Modify: `components/leads/LeadTopActions.tsx`
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`
- Modify: `tests/lead-detail-interactions.test.tsx`

**Interfaces:**

```ts
type LeadNextActionProps = {
  action: NextAction
  busyIntent: string | null
  onIntent: (intent: string) => void
}
```

- [ ] **Step 1: Write failing header, ribbon, and layout tests**

Assert the ribbon is first after the header; Send intake occurs once; visible status occurs once; subtitle includes phone; actions are Draft/Resume, Hire/View, Mark lost, overflow; no status combobox; hired/lost and future snooze hide the ribbon; Quote fee opens the fee editor; `max-w-6xl` is absent; `xl:grid-cols-[1.6fr_1fr]` and `xl:sticky` are present.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/lead-detail-interactions.test.tsx
```

- [ ] **Step 3: Implement `LeadNextAction`**

Render `role="status"`, numbered badge, title/detail, and actions. Primary actions use default Button; secondary actions use outline. Use `border-primary/45` and the nearest already-supported primary alpha background utility. Return null for `nothing`.

- [ ] **Step 4: Simplify `LeadTopActions`**

Remove intake and Select props. Retain Draft/Resume and Hire/View. Add Mark lost plus a shadcn overflow menu containing only valid remaining status transitions, including Reactivate for lost leads.

- [ ] **Step 5: Map every ribbon intent**

```ts
switch (intent) {
  case 'send_intake': return void sendIntake()
  case 'fill_intake':
  case 'review_intake': return setIntakeSheetOpen(true)
  case 'import_intake': return setImportIntakeOpen(true)
  case 'quote_fee': return setActiveField('fee')
  case 'draft_engagement': return void draftEngagement()
  case 'call':
    return window.dispatchEvent(new Event(OPEN_STAFF_SOFTPHONE_EVENT))
  case 'email':
    return window.location.assign(`mailto:${lead.email}`)
  case 'snooze':
    return void snoozeNextAction(new Date(Date.now() + 7 * 86_400_000).toISOString())
}
```

- [ ] **Step 6: Recompose the page**

```tsx
<main className="flex-1 overflow-auto px-6 py-4">
  <div className="space-y-4">
    {visibleAction && (
      <LeadNextAction
        action={visibleAction}
        busyIntent={busyIntent}
        onIntent={intent => void handleNextAction(intent)}
      />
    )}
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
      <div className="space-y-4">
        <LeadDetailsCard
          lead={lead}
          spouse={spouse}
          activeField={activeField}
          onActiveFieldChange={setActiveField}
          onSaveField={saveField}
          onRemoveSpouse={removeSpouse}
        />
        <LeadIntakeCard
          intake={lead}
          intakeUrl={intakeUrl}
          onOpen={() => setIntakeSheetOpen(true)}
          onCopy={() => void copyIntakeUrl()}
        />
      </div>
      <div className="xl:sticky xl:top-4">
        <LeadTimelineCard
          leadId={lead.id}
          leadPhone={lead.phone}
          initialNotes={initialNotes}
          initialMeetingNotes={initialMeetingNotes}
          initialCalls={initialCalls}
          initialActivity={activity}
          actorNames={actorNames}
          currentUser={currentUser}
          onActivityChange={refreshActivity}
        />
      </div>
    </div>
  </div>
</main>
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/lead-detail-interactions.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/leads/LeadNextAction.tsx components/leads/LeadTopActions.tsx \
  'app/admin/leads/[id]/LeadDetailClient.tsx' tests/lead-detail-interactions.test.tsx
git commit -m "feat: make lead detail next-action first"
```

---

### Task 7: Server Loader, Actors, Calls, Appointment, and Last Touch

**Files:**
- Modify: `app/admin/leads/[id]/page.tsx`
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`
- Modify: `lib/leads/timeline.ts`
- Modify: `tests/lead-detail-route.test.ts`
- Modify: `tests/calls-lead-link.test.ts`
- Modify: `tests/lead-detail-interactions.test.tsx`

**Interfaces:**

```ts
initialCalls: CallRowData[]
actorNames: Record<string, string>
nextAppointmentAt: string | null
lastTouchAt: string | null
```

- [ ] **Step 1: Write failing loader/source tests**

Assert appointment query is linked-lead/future/non-cancelled/ascending/limit-one; calls query is lead-scoped/newest-first; actor IDs are collected and loaded with one users query; initial calls remove the client fetch requirement; the whole intake row reaches the strip; and Last touch selects the newest activity/note/meeting creation/call timestamp.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/lead-detail-route.test.ts tests/calls-lead-link.test.ts
```

- [ ] **Step 3: Extend server loading**

Add to the existing parallel queries:

```ts
admin.from('appointments').select('start_time')
  .eq('linked_lead_id', id)
  .gte('start_time', new Date().toISOString())
  .neq('status', 'cancelled')
  .order('start_time', { ascending: true }).limit(1).maybeSingle()

admin.from('calls')
  .select('id, direction, status, participant_number, started_at, duration_seconds, recording_url, voicemail_url, summary, firm_user_email')
  .eq('lead_id', id).order('started_at', { ascending: false }).limit(50)
```

Gather unique actor IDs from notes, meetings, and activity, then query `users.id, full_name, email` once. Display `full_name || email || 'System'`.

- [ ] **Step 4: Compute Last touch**

```ts
export function newestTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string =>
      Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}
```

Feed activity `created_at`, note `created_at`, meeting `created_at`, and call `started_at`. Do not use lead `updated_at`.

- [ ] **Step 5: Render header pills**

Add `created_at` and `lead_next_action_snoozed_until` to `LeadRecord`. Render `Lead · day N` and, when present, `Last touch Nd ago`; clamp future touch values to zero days.

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/lead-detail-route.test.ts tests/calls-lead-link.test.ts \
  tests/lead-detail-interactions.test.tsx tests/lead-timeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Remove retired components if unused**

```bash
rg -n "LeadNotesCard|LeadActivityCard" app components tests
```

Delete a component only when this command shows no remaining runtime consumer; otherwise retain it.

- [ ] **Step 8: Commit**

Stage the modified loader/client/tests and any retired component files by explicit path, then:

```bash
git commit -m "feat: load the complete lead workflow"
```

---

### Task 8: Verification and Cleanup

**Files:**
- Modify only files implicated by verification failures.
- Review every file in the File Map.

- [ ] **Step 1: Run the focused suite**

```bash
npx vitest run \
  tests/lead-next-action.test.ts \
  tests/lead-intake-progress.test.ts \
  tests/lead-timeline.test.ts \
  tests/lead-detail-interactions.test.tsx \
  tests/lead-details-persistence.test.ts \
  tests/lead-detail-route.test.ts \
  tests/lead-notes.test.tsx \
  tests/lead-granola-notes.test.tsx \
  tests/calls-lead-link.test.ts \
  tests/create-send-intake.test.ts \
  tests/lite-intake-import.test.ts \
  tests/appointment-booking.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run changed-file ESLint**

```bash
npx eslint \
  'app/admin/leads/[id]/page.tsx' \
  'app/admin/leads/[id]/LeadDetailClient.tsx' \
  'app/admin/leads/[id]/LeadIntakeCard.tsx' \
  'app/api/admin/leads/[id]/route.ts' \
  app/admin/components/StaffSoftphone.tsx \
  components/leads/LeadNextAction.tsx \
  components/leads/LeadTimelineCard.tsx \
  components/leads/LeadTopActions.tsx \
  components/leads/LeadDetailsCard.tsx \
  lib/leads/nextAction.ts lib/leads/intakeProgress.ts \
  lib/leads/timeline.ts lib/leads/details.ts
```

Expected: no changed-file errors.

- [ ] **Step 3: Run repository regression signals**

```bash
npm run typecheck
npm test
```

Compare failures with `AGENTS.md`: existing type errors are confined to tests, and the documented suite baseline has three failures (`design-sheet-readiness`, `design-sheet-spouse-fiduciaries`, `draft-payload-children`). Fix every additional failure.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: PASS. If `package.json` exposes `build:next`, run it as the direct Next build too.

- [ ] **Step 5: Check scope and whitespace**

```bash
git diff --check
git status -sb
```

Confirm the unrelated softphone test is untouched, no dependency file changed, no drafting internal changed, and no stage rail exists.

- [ ] **Step 6: Browser verification**

Using the local stack and seeded attorney account from `AGENTS.md`, verify:

- At 1280px: no horizontal scroll; order is ribbon/details/intake/timeline; Enter/Escape/blur field behavior; no Save/Cancel pair.
- At 2400px: viewport-filling 1.6fr/1fr layout and sticky timeline.
- In both themes: token contrast, focus rings, missing chips, progress segments, ribbon, and errors.
- With no intake and an appointment three days out: correct ribbon and working Send intake.
- With one note plus its activity echo: one rendered note.
- Exactly one Send intake and one visible lead status.

- [ ] **Step 7: Commit verification fixes if required**

Run `git diff --name-only`, inspect every path, stage each verified fix by explicit path, and commit:

```bash
git commit -m "fix: harden lead detail design 2a"
```

Do not create an empty commit.

- [ ] **Step 8: Final report**

Report commit list, focused test count, changed-file lint, typecheck/full-suite baseline comparison, build result, widths/themes checked, migration status, and whether live Supabase verification was performed.
