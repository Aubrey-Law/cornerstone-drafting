# Spec: `matter_contacts` — one person, many matters

Status: steps 1–3 shipped, step 4 partly (§10, §13–§16). Steps 5–7 are still proposal.

## 1. The problem

A contact is pinned to exactly one household, and a household is exactly one
matter, so a person cannot appear on two matters.

```sql
-- 20260705000000_drafting_baseline_core.sql:135
contacts.client_intake_id uuid REFERENCES client_intake(id) ON DELETE CASCADE
```

Every contact read walks `matter → matter.client_intake_id → contacts`
(`lib/contacts/getHousehold.ts:70`, `lib/draftPayload/assemble.ts:186`,
`app/api/admin/matters/[id]/contacts/route.ts:106`). There is no path from a
contact to a second matter, and `create_matter_with_client` inserts a fresh
`client_intake` row on every call
(`20260814000000_atomic_matter_create.sql:74`), so a returning client becomes a
second person with a second copy of their spouse, children, and fiduciaries.

Two cases this blocks:

- **Returning client, new engagement.** Duplicate person record. Corrections
  (new address, a child's married name) land on one copy; the other silently
  drifts and can be the one that feeds a draft.
- **College Preparation Plan for a client's child.** On the CP track the
  student *is* the client (`lib/collegePrepFields.ts:8`,
  `lib/designSheet/seedCollegePrep.ts:5`). The child already exists as a
  `contacts` row in the parents' household; opening their CP matter mints an
  unrelated `client_intake`. The two records never reference each other.

## 2. Target model

Three changes: split person facts from matter-relative facts, add the join,
rekey roles to the matter.

```sql
-- Person identity. Firm-wide, no household FK.
-- Intrinsic facts only: what is true about this human regardless of matter.
contacts (
  id, first_name, middle_name, last_name, suffix, preferred_name,
  preferred_pronoun, prior_names, date_of_birth, is_us_citizen,
  citizenship_status, email, phone, address_line1, address_line2,
  city, state, zip, county, deceased, source, created_at, updated_at
  -- client_intake_id retired (see §6)
  -- merged_into_id uuid REFERENCES contacts(id)  -- see §9
)

-- The join. One row per person per matter.
matter_contacts (
  id                 uuid primary key default gen_random_uuid(),
  matter_id          uuid not null references matters(id) on delete cascade,
  contact_id         uuid not null references contacts(id) on delete cascade,
  relationship_type  text not null,   -- self | spouse | child | other
  relationship_label text,            -- "Trustee", "Referring CPA", free text
  for_party          text,            -- client | spouse — whose side, when it matters
  child_relationship text,            -- biological | adopted | stepchild
  parentage          text,            -- joint | client | spouse
  is_minor           boolean,         -- explicit override of the DOB derivation
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (matter_id, contact_id)
)

create unique index matter_contacts_one_self
  on matter_contacts (matter_id) where relationship_type = 'self';
create unique index matter_contacts_one_spouse
  on matter_contacts (matter_id) where relationship_type = 'spouse';
create index matter_contacts_contact_idx on matter_contacts (contact_id);

-- Fiduciary appointments are per matter, not per person.
alter table contact_roles
  add column matter_id uuid references matters(id) on delete cascade;
create index contact_roles_matter_idx on contact_roles (matter_id);
-- client_intake_id retired after backfill.
```

### Why the field split falls where it does

`relationship_type`, `child_relationship`, and `parentage` are stated
*relative to the matter's primary client*, not intrinsic to the person. The
college case proves it: the same human is `self` on their CP matter and `child`
on their parents' estate matter. Leaving these on `contacts` reintroduces the
one-household assumption inside a table that no longer has a household column.

Same reasoning for `contact_roles`: a trustee named in a 2024 trust is not
automatically the trustee in a 2026 second engagement. Keying roles to
`client_intake_id` (added `20260716000000_lite_full_intake_columns.sql:145`)
makes every matter for a client share one appointment set, which is wrong the
moment a client has two.

`is_minor` is an override of a DOB derivation (`lib/contacts/childMinor.ts`),
and minority is a fact about a date relative to a matter's signing — matter
side.

### The `self` promotion

Today the client themself has no `contacts` row; their person fields live on
`client_intake`, and `getHousehold` synthesizes a `HouseholdPerson` with
`contact_id: null` (`lib/contacts/getHousehold.ts:18`). The join table cannot
express "parent is `self` on matter A and `other` on matter B" unless the
client is a real `contacts` row.

So: **every `client_intake` gets a `contacts` row with
`relationship_type='self'` on its matter.** This is the largest single piece of
the migration and the main source of risk, because `client_intake`'s person
columns are read across the leads UI, engagement rendering, and email
templates.

De-risk it by keeping `client_intake`'s person columns as a
trigger-maintained projection rather than dropping them. The repo already does
exactly this — `sync_crm_person_from_contact` and `sync_crm_person_from_intake`
(`20260902000000_unify_crm_hub.sql:1020`) keep `cornerstone_crm_people` in step
with `contacts` and `client_intake`. Reuse the pattern: `contacts` becomes
authoritative for the self person, a trigger writes through to
`client_intake.first_name/last_name/email/phone/...`, and the dozens of legacy
readers keep working untouched. Dropping those columns is a later cleanup, not
part of this migration.

## 3. Pre-flight audit

Run before writing the backfill; each result changes it.

```sql
-- Intakes carrying more than one matter. Expected 0 — the backfill's
-- 1:1 assumption depends on it. unify_leads_matters only inserted an
-- opportunity where none existed, but verify rather than assume.
select client_intake_id, count(*), array_agg(id)
from matters group by 1 having count(*) > 1;

-- Matters whose intake is missing. Backfill must skip, not fail.
select m.id from matters m
left join client_intake ci on ci.id = m.client_intake_id
where ci.id is null;

-- Standalone directory contacts (referrers, CPAs). Correctly get zero
-- matter_contacts rows — they belong to no matter.
select count(*) from contacts where client_intake_id is null;

-- contact_roles whose intake disagrees with their contact's intake.
select cr.id from contact_roles cr
join contacts c on c.id = cr.contact_id
where cr.client_intake_id is distinct from c.client_intake_id;

-- Probable duplicate people, for the §9 merge queue. Not fixed by this
-- migration; sizing input only.
select lower(email), count(*) from contacts
where email is not null and email <> '' group by 1 having count(*) > 1;

-- Contacts already typed 'client'. normalizeContactRelationshipType can emit
-- this (lib/contactRelationship.ts:1) and contactsDirectory filters it out,
-- which suggests some households already store the client as a contact. If any
-- of these really are the client, the self contact minted in step 1 is a second
-- copy of that person and belongs in the §9 merge queue.
select c.id, c.client_intake_id, c.first_name, c.last_name, ci.first_name, ci.last_name
from contacts c join client_intake ci on ci.id = c.client_intake_id
where c.relationship_type = 'client';
```

## 4. Backfill

Deterministic, given the 1:1 audit passes.

```sql
-- 1. Self contact per matter, from the intake's person columns.
insert into contacts (first_name, middle_name, last_name, suffix, preferred_name,
                      preferred_pronoun, date_of_birth, is_us_citizen,
                      citizenship_status, email, phone, address_line1,
                      address_line2, city, state, zip, county, source)
select ci.first_name, ci.middle_name, ci.last_name, null, ci.preferred_name,
       ci.preferred_pronoun, ci.date_of_birth, ci.is_us_citizen,
       ci.citizenship_status, ci.email, ci.phone, ci.address_line1,
       ci.address_line2, ci.city, ci.state, ci.zip, ci.county, 'backfill_self'
from client_intake ci
where exists (select 1 from matters m where m.client_intake_id = ci.id)
returning id;   -- capture the ci.id ↔ contacts.id mapping

-- 2. Join rows for the self contact.
-- 3. Join rows for every existing contact, carrying relationship_type,
--    child_relationship, parentage, is_minor across from contacts.
insert into matter_contacts (matter_id, contact_id, relationship_type,
                             relationship_label, child_relationship,
                             parentage, is_minor)
select m.id, c.id, c.relationship_type, c.relationship_label,
       c.child_relationship, c.parentage, c.is_minor
from contacts c
join matters m on m.client_intake_id = c.client_intake_id
on conflict (matter_id, contact_id) do nothing;

-- 4. Rekey roles to the matter.
update contact_roles cr
set matter_id = m.id
from matters m
where m.client_intake_id = cr.client_intake_id;
```

Do **not** deduplicate people in the backfill. Two `contacts` rows for the same
human stay two rows; merging is a reviewed operation (§9). A migration that
silently merges on email will merge a couple sharing one address.

Backfill must be idempotent and re-runnable — `source = 'backfill_self'` plus
`on conflict do nothing` gives that.

## 5. What breaks loudly under multi-matter

These resolve a matter from an intake with `.maybeSingle()`. Today they return
one row; the first client with two matters turns each into a PGRST116 error or
a coin flip. All must move to "by matter" before any second matter exists.

| Site | Current | Fix |
|---|---|---|
| `lib/draftPayload/resolveMatterId.ts:59` | `matters.eq(client_intake_id).eq(hired).maybeSingle()` | resolve by matter id only; delete the intake fallbacks |
| `lib/draftPayload/resolveMatterId.ts:44` | same via `design_sheets.client_intake_id` | `design_sheets.matter_id` is already unique per version — use it |
| `lib/queries/contactsDirectory.ts:69` | one `matter_number` per person | list of matters per person |
| `client_intake.matter_id` | single back-pointer | drop; query `matters where client_intake_id = …` |
| `app/admin/leads/[id]/page.tsx:84`, `app/api/admin/leads/[id]/route.ts:145,195` | spouse via `contacts.eq(client_intake_id).eq(spouse).maybeSingle()` | `loadSpouseContact(admin, matterId)` |
| `delete_intake_contact(p_contact_id, p_client_intake_id)` | deletes the person | detach from the matter; delete the person only when no `matter_contacts` remain |

## 6. Read/write path migration

63 direct `from('contacts')` call sites across 34 files, but the household
helpers are already the intended choke point and most callers go through them.
Re-key these eight from `intakeId` to `matterId` and the bulk follows:

```
lib/contacts/getHousehold.ts           -- the single read surface
lib/contacts/loadSpouseContact.ts
lib/contacts/loadHouseholdChildren.ts
lib/contacts/saveHouseholdContact.ts   -- takes `householdId` today; becomes matterId
lib/contacts/saveHouseholdChildren.ts
lib/contacts/saveAdditionalContacts.ts
lib/contacts/persistFiduciaryRoles.ts  -- wipe scope becomes per-matter
lib/contacts/intakeFiduciarySnapshot.ts
```

`getHousehold` keeps its exact return shape (`Household`, `HouseholdPerson`)
with one change: `self.contact_id` stops being `null`. Callers that branch on
`contact_id === null` to mean "this is the client" must switch to
`relationship_type === 'self'`. Grep for that before merging — it is the most
likely silent regression in the whole migration.

Direct callers still needing repointing after the helpers:

```
app/api/admin/matters/[id]/contacts/route.ts        (4 sites)
app/api/admin/matters/[id]/design-sheet/contacts/route.ts (5 sites)
app/actions/adminIntake.ts                          (fiduciary persistence)
app/api/intake/contacts/route.ts                    (portal writes)
lib/draftPayload/assemble.ts:186                    (drafting read)
lib/leadFiduciaries.ts, lib/intakeContactHydration.ts
lib/queries/contactsDirectory.ts, lib/queries/firmDirectory.ts, lib/queries/matterCore.ts
lib/lawmatics/importMatter.ts, lib/sms/outbound.ts, lib/calendarAttention.ts
components/intake/FiduciaryContactPicker.tsx
```

### Writers that live in SQL, not TypeScript

Repointing the app is not enough — several `SECURITY DEFINER` functions insert
`contacts` rows keyed by `client_intake_id` and would keep minting legacy rows
after step 3. Current definitions:

| Function | Latest definition | What it writes |
|---|---|---|
| `update_lead_opportunity_field` | `20260921000000_college_prep_practice_area.sql:72` | spouse contact upsert (line 262) |
| `update_lead_opportunity_details` | `20260917000000_convert_preserves_matter_edits.sql:443` | spouse contact upsert (line 521) |
| `ensure_lead_matter` | `20260824000000_matter_lifecycle_v3.sql:239` | auto-creates the opportunity matter per lead |
| `create_matter_with_client` | `20260814000000_atomic_matter_create.sql:27` | always inserts a new `client_intake` |
| `convert_lead_to_matter` | `20260921000000_college_prep_practice_area.sql:346` | hires the intake's existing matter |
| `delete_intake_contact` | `20260717000001_lite_delete_intake_contact_rpc.sql` | deletes person + roles by intake |

Each is redefined whole in a later migration rather than patched, so the
migration follows that convention: `create or replace` the full body with the
join-aware version. `ensure_lead_matter` is the trigger that makes lead↔matter
1:1 today; step 5 is where it stops being the only way a matter appears.

`persistFiduciaryRoles`'s wipe-and-recreate scope
(`role ∈ {personal_rep, trustee, poa, hcp, guardian} × priority ∈ {1,2} ×
for_party`) becomes matter-scoped. Leaving it intake-scoped would have a second
matter's fiduciary save wipe the first matter's appointments — the single worst
data-loss risk in this change. Cover it with a test before touching the writer.

## 7. RLS

The portal policies traverse `contacts → client_intake → user`
(`20260705000000_drafting_baseline_core.sql:182-215`). With `client_intake_id`
gone from `contacts`, they must traverse the join:

```sql
-- clients_manage_own_contacts, rewritten
exists (
  select 1
  from matter_contacts mc
  join matters m on m.id = mc.matter_id
  join client_intake ci on ci.id = m.client_intake_id
  where mc.contact_id = contacts.id
    and (ci.user_id = auth.uid() or ci.client_user_id = auth.uid())
)
```

Two consequences to decide on:

- A shared contact is now visible to every client who has a matter with that
  person on it. For a parent and child that is intended. Confirm it is
  acceptable in general before shipping — it is a genuine visibility widening.
- Standalone directory contacts (`client_intake_id is null` today, no
  `matter_contacts` rows after) become invisible to all portal users. That is
  correct and matches today's behavior, but assert it in a test.

`tests/rls-security-policies.test.ts` covers these policies and will need
updating in the same PR.

## 8. Design-sheet contact references

Design sheets store `contacts.id` values inside `decisions` jsonb, so contact
identity is load-bearing for drafting. Anything that changes a contact id
(a merge, §9) must rewrite these:

```
trustee_slots[].contact_id, executor_slots[], poa_slots[], hcp_slots[],
guardian_slots[], temporary_guardian_slots[],
spouse_trustee_slots[], spouse_executor_slots[], spouse_poa_slots[],
spouse_hcp_slots[]                       -- lib/designSheet/buildInitialSheet.ts:159
excluded_guardians[].contact_id          -- lib/designSheet/excludedGuardians.ts:8
fiduciary_contact_details{contactId}     -- keyed BY contact id, not a value
fiduciary_document_inclusions{contactId} -- same
client_hipaa_additional_agent_contact_ids[], spouse_… -- lib/draftPayload/healthcare.ts:72
remote_beneficiary_individuals[]         -- lib/draftPayload/assemble.ts:293
```

The two map-keyed structures are the trap: a naive value-rewrite misses them.

The join table itself does not disturb these — a design sheet belongs to one
matter (`design_sheets_matter_id_version_key`), and the ids it holds stay
valid. This section is a constraint on the merge tool, and a reason to build
the merge tool as one RPC rather than ad-hoc SQL.

## 9. Deduplication is a separate feature

The join table lets a person hold many matters going forward. It does not
collapse the duplicates already in the database — that needs a merge operation,
and merging is destructive enough to be attorney-reviewed rather than
automatic.

```sql
merge_contacts(p_winner uuid, p_loser uuid) returns void
```

Repoints, in one transaction: `matter_contacts` (on conflict, keep the winner's
row and drop the loser's), `contact_roles`, `sms_messages.contact_id`,
`calls.contact_id`, `email_log.contact_id`,
`cornerstone_crm_people.contact_id`, then rewrites every design-sheet reference
in §8, then tombstones the loser via `merged_into_id` rather than deleting it —
so a bad merge is reversible and old links resolve.

`cornerstone_crm_people` already carries `duplicate_review_status`
(`unreviewed | reviewed | merged`,
`20260901000000_cornerstone_crm_mailgun_campaigns.sql:29`). Reuse it for the
review queue instead of inventing a second one.

Ship this after the join table. The join table is what stops *new* duplicates;
the merge tool cleans up the ones already there.

## 10. Sequencing

Each step is independently shippable and leaves the app working.

1. **Schema + backfill, no behavior change.** ✅ Shipped —
   `supabase/migrations/20260925000000_matter_contacts_join.sql`. Creates
   `matter_contacts`, adds `contact_roles.matter_id`, promotes self contacts,
   adds the write-through trigger to `client_intake`. Keeps
   `contacts.client_intake_id` populated and authoritative. Nothing reads the
   new tables yet. Reversible. See §13 for what the build changed about this
   plan.
2. **Dual-write.** ✅ Shipped —
   `supabase/migrations/20260926000000_matter_contacts_dual_write.sql` and
   `npm run check:matter-contacts`. Done with database triggers rather than by
   patching writers (see §13). Run the check against production for a few days
   before starting step 3.
3. **Flip the readers.** ✅ Shipped — see §15. Every contact *read* goes
   through the join; `contacts.client_intake_id` is write-only.
4. **Fix the single-row assumptions** (§5) and rewrite RLS (§7). 🟡 RLS and
   contact removal shipped — see §16. The §5 lookups are blocked on decision
   §12.3 (whether a second engagement reuses its client's intake), which
   decides whether they are wrong at all.
5. **Open the door.** Matter creation accepts an existing `client_intake_id`
   / contact instead of always inserting; add a "New matter for this client"
   action; matter and contact pages list all related matters.
6. **Merge tool** (§9) and the duplicate review queue.
7. **Cleanup.** Drop `contacts.client_intake_id`,
   `contact_roles.client_intake_id`, `client_intake.matter_id`, and the
   `delete_intake_contact` RPC.

Steps 1–4 are the migration proper. Step 5 is the feature that answers the
original question. Steps 6–7 pay off the old data.

## 11. Test plan

New coverage:

- `matter_contacts` invariants: one `self` per matter, one `spouse` per matter,
  no duplicate `(matter_id, contact_id)`.
- A contact on two matters appears in both households with different
  `relationship_type` values, and edits to person fields show on both.
- `persistFiduciaryRoles` on matter B leaves matter A's roles intact.
- `getHousehold` self has a non-null `contact_id` and
  `relationship_type === 'self'`.
- Backfill is idempotent: running it twice produces the same row counts.
- RLS: a portal client sees a contact shared with their matter; a standalone
  directory contact is invisible to every portal client.

Existing suites that will move and must stay green: `build-draft-payload`,
`draft-payload-family`, `draft-payload-children`,
`design-sheet-fiduciary-persistence`, `design-sheet-spouse-fiduciaries`,
`design-sheet-seed-from-intake`, `matter-people-redesign`,
`intake-fiduciary-snapshot`, `college-prep-design-sheet`, `firm-directory`,
`contact-side-panel`, `rls-security-policies`.

Repo gates each migration PR must satisfy: `migration-drift`,
`migration-snapshot-replayable`, `supabase-types-drift` (regenerate
`types/supabase.generated.ts` via `scripts/generateSupabaseTypes.mjs`),
`matter-page-schema-coverage`.

Per `AGENTS.md`, steps 3 and 4 touch drafting internals (`buildDraftPayload`,
design-sheet persistence). That is allowed with a good reason and careful test
coverage — this is one — but it means the drafting suites are the gate, not a
formality.

## 12. Decisions needed before step 1

1. **Shared-contact visibility.** Once a person is on two clients' matters,
   each of those portal clients can see that contact row (§7). Acceptable, or
   does the portal need per-matter filtering of contact fields?
2. **Address on a shared person.** A child at college has one address on the
   parents' matter and another on their own. Intrinsic-to-person (one address,
   last write wins) or matter-relative (address moves to `matter_contacts`)?
   The spec above assumes intrinsic; the CP case is the argument against.
3. **Second matter, same intake or new one?** Step 5 can either reuse the
   client's existing `client_intake` row (one lead record, many matters) or
   create a new intake per engagement linked to the same person. The intake
   answers are engagement-specific — assets, plan type — which argues for a new
   intake per matter and makes `client_intake` truly per-matter. Deciding this
   late means reworking step 1's trigger.
4. **Merge policy.** Automatic-on-exact-email-match with review, or
   attorney-initiated only? A married couple sharing an inbox makes automatic
   matching unsafe.

## 13. Step 1 as built

Three things the implementation had to settle that this spec had not.

**Making the self contacts invisible.** The plan said promote the client into
`contacts`; it did not say what stops those rows from showing up. New rows in
`contacts` are visible to readers that do not filter by intake, so the self
contacts are inserted with `client_intake_id` NULL — which hides them from every
intake-scoped reader — plus three targeted exclusions:

- `sync_crm_person_from_contact` skips `relationship_type = 'self'`. Without it
  the backfill mints a `cornerstone_crm_people` row per self contact, duplicating
  the CRM person `sync_crm_person_from_intake` already maintains for the same
  human.
- `lib/queries/contactsDirectory.ts` excludes `'self'` alongside `'client'`.
- `lib/queries/firmDirectory.ts` skips `'self'` in `buildFirmPeople`.

The first is the one that would have shipped a visible regression: every client
would have appeared twice in the CRM hub.

**The write-through trigger is UPDATE-only.** Firing on insert would have the
backfill write `client_intake`'s own values back over themselves and bump
`updated_at` on every intake — which lead aging and list ordering read. It is
inert until step 2 writes a self contact, which is the intended state.

**`ON CONFLICT` does not cover partial unique indexes.** `on conflict
(matter_id, contact_id) do nothing` does not catch `matter_contacts_one_self`,
so a matter that already named a different person as its client raised instead
of skipping. Both backfill inserts now carry an explicit `not exists` guard, and
the `contact_roles` ambiguity check only considers roles still awaiting a matter
so a re-run is a clean no-op. Verified against PostgreSQL 16: virgin run, re-run,
and re-run after a client was given a second matter and a child was given their
own College Prep matter.

**Still open:** contacts already typed `'client'` (§3's last query). If those are
the client themselves, step 1 has minted a second copy of that person, and the
pair belongs in the §9 merge queue. Needs a look at production data — the
migration deliberately does not guess.

## 14. Step 2 as built

**Triggers, not patched writers.** The spec said "every contact write populates
both". There are 24 such writes across 13 TypeScript files, plus the six
`SECURITY DEFINER` functions in §6 that write `contacts` from SQL and never go
through the app. Patching each is fragile in the way that matters most here: a
missed writer diverges silently, and the thing that would catch it is a reader
that has already flipped. So the dual-write is four triggers instead:

| Trigger | On | Does |
|---|---|---|
| `sync_matter_contacts_from_matter` | `matters` insert | mints the self contact if absent, joins it, joins the whole existing household |
| `sync_matter_contacts_from_contact` | `contacts` insert/update | joins the contact to its household's matters; moves the rows when the household changes |
| `sync_self_contact_from_intake` | `client_intake` update | keeps the self contact current while the app still writes the intake |
| `sync_contact_role_matter` | `contact_roles` insert | fills `matter_id` when the intake has exactly one matter |

Deletes need no trigger — `matter_contacts` cascades on both foreign keys.

**The recursion the pair creates.** Step 1 installed self contact →
`client_intake`. Step 2 needs the reverse, because the app still writes the
intake. Postgres fires an UPDATE trigger even when values are unchanged, so the
two would write to each other until the stack blew. Both directions are now
guarded on `is distinct from`: the answering write matches zero rows, fires no
trigger, and the cycle stops after one hop.

**Ambiguity is left unset, not guessed.** `sync_contact_role_matter` leaves
`matter_id` null when the intake carries more than one matter, rather than
attaching an appointment to the wrong engagement. The consistency check reports
those, and they need resolving by hand before step 3 re-keys roles.

**Verification.** Against PostgreSQL 16 with the step-1 fixture: new
client + matter, adding a spouse, a second matter for the same client (inherits
the household, zero duplicate people), intake edit propagating to the self
contact and back, a no-op write not ping-ponging, detach/re-attach/delete, and
role matter assignment in both the unambiguous and ambiguous cases.

The consistency checker was then run against the database those triggers had
actually written — 4 matters, 10 contacts, 11 join rows — and reported exactly
one gap, the deliberate ambiguous role. It was written independently of the
triggers, so the agreement is a real cross-check rather than a restatement.
Injecting a dropped join row and a matter with no self contact produced
`missing_join_row` and `matter_without_self` as expected.

**Before step 3:** run `npm run check:matter-contacts` on production for a few
days. It exits non-zero on any disagreement. Step 3 should not start while it
reports drift.

## 15. Step 3 as built

Flipped by subsystem, as this spec anticipated — the matter-keyed ones first,
then the lead-keyed ones. **Every contact read now goes through the join.**

### Flipped

| Reader | Now keyed by |
|---|---|
| `getHousehold` | matter; returns `matterId`, and `self.contact_id` is a real id |
| `loadSpouseContact`, `loadHouseholdChildren` | matter, via `matter_contacts` |
| `loadIntakeFiduciarySnapshot` | matter, and filters roles to that matter |
| `persistFiduciaryRoles` | matter — **wipe scope included** |
| `buildDraftPayload`, the draft route, template preview | `loadMatterContacts` |
| design-sheet contact search, `fetchMatterContacts`, matter People tab | `loadMatterContacts` |
| matter + design-sheet contact write guards | `contactOnMatter` |
| lead detail page + API, channels, engagement draft, compose-context | matter, via the lead's `matter_id` |
| leads list, calendar attention | `loadMatterContactsForMatters`, batched |
| admin intake form fiduciary prefill | matter, matching what the save writes |

Two new helpers carry most of it: `lib/contacts/loadMatterContacts.ts` (the
drop-in for `from('contacts').eq('client_intake_id', …)`, with a batched
`loadMatterContactsForMatters` so lists do not go N+1) and
`lib/contacts/assertContactOnMatter.ts`.

The admin intake form was reading fiduciary roles by intake while
`persistAdminFiduciaries` had started writing them by matter. Left alone, that
pair would have shown the form a second engagement's fiduciaries and then
rewritten only this matter's on save. Both ends are matter-keyed now.

**The write guards were a live bug, not just a re-key.** Contact updates and
deletes routed through a matter were scoped with
`.eq('client_intake_id', intakeId)` — the *household*. Once a client has two
matters, a request routed through one could edit or delete a person the other
owns. `contactOnMatter` scopes to the join, which is what actually confines the
write.

### Not flipped, deliberately

**Writes stay on the legacy FK.** `saveHouseholdContact`,
`saveHouseholdChildren`, `saveAdditionalContacts` and the contact inserts in
`persistFiduciaryRoles` still set `client_intake_id`; the step 2 triggers build
the join from it. That is what "write-only" means here, and it keeps this step
to reads.

**Only writes still touch the household FK**, in `saveHouseholdContact`,
`saveHouseholdChildren`, `saveAdditionalContacts`, `leadFiduciaries`, the
portal's contact routes and the Lawmatics import — plus the reads that exist
only to dedupe inside those writes.

`hydrateIntakeWithContacts` is the one read left on it, deliberately: it
decorates an *intake row* with household facts for readiness scoring, is called
from token-authenticated portal flows that hold no matter, and the facts it
needs (spouse, children) are household-level. It moves in step 7 with the
column.

### The risk this step carries

**The re-key is invisible to the type checker.** Both keys are `string`, so a
caller left passing an intake id compiles clean. There is no branded type, and
adding one would touch far more than this change. Two things stand in for it:
`getHousehold` throws `no primary client in matter_contacts` when handed an
intake id, and the reader tests assert the *filters* each query applies rather
than only its result.

`loadSpouseContact` nearly caused a silent regression of exactly this kind: its
narrow default column set has no address fields, and `fetchMatterFallback`
formats the spouse's address. It takes a `columns` argument now, and that caller
passes `'*'`.

### Verification

Full suite green (320 files, 3202 tests) with 11 new reader tests, typecheck and
eslint clean. Three drafting-payload tests needed their stubs extended with
`matter_contacts` rows — those failures were the flip working as intended, since
a `contacts` stub alone is no longer reachable.

Not verified end to end: the app was never run against a database. Docker image
pulls are blocked by the network policy here, so there is no local Supabase, and
these paths are exercised only through mocked clients. `npm run
check:matter-contacts` on production remains the gate before step 4.

### Step 3, second pass: the lead subsystem

Lead URLs stay intake-based, so each of these needed the lead's matter. None of
them had to look it up: the lead row already carries `matter_id`, and the pages
and routes involved were loading it anyway. That matters because §5 is about
*deleting* intake → matter lookups, not adding more.

The leads list and the calendar attention feed both read contacts for many
records at once, so they use `loadMatterContactsForMatters` — one join query
and one contacts query regardless of list length, rather than the N+1 a naive
flip would have produced. Calendar attention already held the matters, so it
keys on them directly and maps back to intakes only for the readiness rules.

Five test files needed updating, and each failure was informative rather than
noise: three drafting-payload stubs needed `matter_id` on their join rows once
`loadMatterContacts` became a wrapper over the batched form; two source-text
assertions encoded the old query shape and were rewritten to assert the new one
while keeping their intent (that leads have their own channels route, and that
calendar attention batches rather than querying per appointment); and the lead
detail harness had to serve `matter_contacts` before `contacts`.

One of those caught something real: the lead PATCH route sets `matterId` only
when a conversion happens, so keying the post-write spouse read on it alone
would have returned a null spouse from every ordinary lead edit. It falls back
to the lead's existing matter.

## 16. Step 4 as built (partial)

Two halves. The authorization half shipped; the §5 lookups are blocked on a
decision.

### Shipped — `20260927000000_matter_contacts_rls.sql`

**RLS moved onto the join.** The portal policies traversed
`contacts.client_intake_id → client_intake → auth.uid()`. That column is
write-only after step 3 and is dropped in step 7, at which point the policies
would have matched nothing. RLS failing closed beats failing open, but it would
have taken the portal's fiduciary picker
(`components/intake/FiduciaryContactPicker.tsx`, the one client-side reader on
the anon key) down with it.

**Narrowed from `FOR ALL` to `SELECT`.** The portal has that one reader and no
client-side writer — every portal write goes through a service-role route,
which bypasses RLS entirely, so granting INSERT/UPDATE/DELETE to `authenticated`
was permitting more than anything used. `FOR ALL` would also have been
unusable: its `WITH CHECK` runs against the row being inserted, and a new
contact has no join row yet (the step 2 trigger adds it immediately after), so
every portal insert would have failed the check.

**Contact removal is now per matter.** `delete_intake_contact` deleted the
person and all their roles. With one person on several matters that erases them
everywhere — removing a trustee from the 2026 engagement would have taken them
off the 2024 one. `delete_matter_contact(contact, matter)` detaches from the
named matter, clears only that matter's appointments, and deletes the person
only once no matter references them. The old function stays until step 7 so a
deploy racing the migration keeps working.

**Verified against PostgreSQL 16**, with RLS actually enabled and `auth.uid()`
stubbed per session — the first run silently passed because the fixture had
never enabled RLS on `contacts`, which is worth remembering when reading any
policy test:

- A portal client sees exactly the people on their matters; a signed-in user
  with no matter sees none; writes are refused.
- Standalone directory contacts stay invisible to every portal user.
- Removing someone from one of their two matters leaves the person and their
  other matter intact; removing them from the last one deletes them; detaching
  a contact who was never on the matter is a no-op.

**Decision §12.1 is now concrete rather than hypothetical.** A person named on
two clients' matters is visible to both of those clients — demonstrated with a
trustee shared between two households. Neither client gains any other visibility
into the other's household. That is the intended semantics (it is what lets a
parent and child share one record), but it is a real widening and should be
confirmed rather than assumed.

### Blocked — the §5 lookups

Seven places resolve a matter from an intake with `.maybeSingle()`
(`resolveMatterId`, `adminIntake`, the portal intake routes, `createLead`,
`syncAssetIntakeToDesignSheet`, the intake shell). Whether any of them is wrong
depends entirely on decision §12.3:

- **New intake per engagement** — which is what `create_matter_with_client`
  does today — keeps intake → matter at 1:1 forever, and every one of these
  stays correct. Step 5 would instead attach the *existing* person to the new
  matter rather than letting `sync_matter_contacts_from_matter` mint a fresh
  self contact.
- **Shared intake across engagements** makes all seven ambiguous, and each
  needs a matter threaded through from its caller.

`lib/queries/contactsDirectory.ts` needs work under either branch, but different
work: a shared intake means one person with several matter numbers, while a new
intake per engagement means the same human appears as several directory rows and
the directory has to key on `contacts` instead.

Note that §5's own table says to drop `client_intake.matter_id` and "query
`matters where client_intake_id = …`" instead — that is self-contradictory under
a shared intake, since it is exactly the ambiguous lookup. Whichever branch is
chosen, that row of the spec needs rewriting.
