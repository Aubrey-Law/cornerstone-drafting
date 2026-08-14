# Spec: `matter_contacts` — one person, many matters

Status: proposal. Nothing below is implemented.

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

1. **Schema + backfill, no behavior change.** Create `matter_contacts`, add
   `contact_roles.matter_id`, promote self contacts, add the write-through
   trigger to `client_intake`. Keep `contacts.client_intake_id` populated and
   authoritative. Nothing reads the new tables yet. Reversible.
2. **Dual-write.** Every contact write populates both the legacy FK and
   `matter_contacts`. Add a consistency check comparing the two
   representations, in the shape of `scripts/reconcileFieldConsistency.ts`.
   Run it against production for a few days.
3. **Flip the readers.** Re-key the eight household helpers to `matterId`,
   then the direct callers (§6). `contacts.client_intake_id` becomes
   write-only. This is the big PR; split by subsystem (design sheet, leads,
   drafting, comms) if review gets unwieldy.
4. **Fix the single-row assumptions** (§5) and rewrite RLS (§7). After this,
   a second matter per client is *safe* but not yet reachable from the UI.
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
