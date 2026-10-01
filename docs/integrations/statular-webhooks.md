# Statular Incoming Webhooks — Review and Cornerstone Implementation Plan

> Reviewed against Statular's "Incoming Webhooks" article (firm docs, 2026) and the
> Statular integration Cornerstone already ships: the Markdown design-sheet export in
> `lib/designSheet/statularExport.ts` and the question map in
> `lib/designSheet/statularInterviewMap.ts`.
>
> Status: **plan, not built.** Nothing in this document is wired yet. It names the files
> a build would touch and the decisions that have to be made before one starts.

## 1. What the API actually is

Statular's incoming webhooks are a **two-endpoint create-only ingest**, not an
integration API. Reading the article closely, the shape is:

| Property | Value | Consequence for Cornerstone |
|---|---|---|
| Direction | Inbound to Statular only | Cornerstone is the **caller**. This is unlike every existing `app/api/webhooks/*` route, which receives. |
| Actions | `create client`, `create matter` — one per URL | Two URLs, two payload builders. No update, no upsert. |
| Credential | The URL itself; no key, no header, no signature | Must be sealed at rest and never logged. |
| Response | `201 {"id": 12345}` | The **only** thing Statular tells us. Store it or lose the link. |
| Reads | None. Cannot list, export, or look up | We can never reconcile by querying Statular. Our stored id is the only handle. |
| Field handling | Unknown field ⇒ `422`, whole request fails | Our payload builder must be strictly whitelisted, and tested. |
| Retries | Optional `Idempotency-Key` header, ≤200 chars | Deterministic key from our own row ids. See §5. |
| Limits | 30/min, 500/day per webhook; 4 active webhooks per firm | Generous for solo volume; still worth pre-empting. |
| Attribution | Records are created **as the admin who minted the webhook**, who is also the default drafter | Fine for a one-admin firm. Becomes a `403` if that account is deactivated. |

Two limits deserve to be stated plainly up front, because they decide the whole design:

**The webhooks cannot carry the design sheet.** The create-matter payload is four
fields: `client_id`, `doc_id`, `state`, `matter_name` (plus `drafter_id`). There is no
route through this API for trust structure, fiduciaries, distribution, or healthcare
answers. The Markdown export remains the only path for those, and remains a manual
upload.

**The webhooks cannot update.** A client created by webhook and then corrected in
Cornerstone diverges permanently. This is a **push-once handoff**, not a sync, and the
UI has to say so rather than implying two systems stay level.

## 2. Where this fits the workflow we already have

Today, exporting a matter to Statular is entirely manual:

1. Attorney creates the client in Statular by hand.
2. Attorney creates the matter in Statular by hand, picking the document package.
3. Attorney downloads `?format=statular` from the design sheet
   (`app/api/admin/matters/[id]/design-sheet/export/route.ts`) and uploads the `.md`
   into that matter, where Statular's extractor reads the answers.

The webhooks automate **steps 1 and 2** — the retyping — and leave step 3 exactly as it
is. That is the whole win, and it is a real one: the client, spouse, children,
addresses and the matter shell stop being re-keyed, and the matter arrives already
named and already pointed at the right document package.

It is worth being clear-eyed that this is the smaller half of the work. Step 3 is where
the 295 design-sheet fields live. Nothing here shortens it.

## 3. Recommended architecture

**Push twice, through the durable job queue, recording one link row per matter.**

```
Attorney clicks "Create in Statular"  (or a stage transition fires it)
        │
        ├─ preflight: required fields present? already linked? webhooks configured?
        │
        ├─ enqueue workflow_job  push_statular_client   (dedupe_key = matter uuid)
        │        └─ POST client webhook → 201 {id} → statular_links.statular_client_id
        │
        └─ enqueue workflow_job  push_statular_matter   (chained, requires client_id)
                 └─ POST matter webhook → 201 {id} → statular_links.statular_matter_id
```

Four reasons for the queue rather than an inline `fetch` in the route handler:

- `workflow_jobs.dedupe_key` is `UNIQUE` (`supabase/migrations/20261004000000_solo_practice_efficiency_billing.sql:108`).
  A double-click cannot enqueue twice, which is a stronger guarantee than
  `Idempotency-Key` alone because it never leaves our database.
- `claim_workflow_jobs` / `finish_workflow_job` already give attempts, `max_attempts`,
  backoff via `available_at`, and `last_error`. A `429` or a network blip becomes a
  retry instead of an error toast.
- The cron runner (`/api/cron/workflow-jobs`, every 5 min, `vercel.json`) is a single
  serialized worker, so Statular's 30/min ceiling cannot be approached by accident.
- Chaining is explicit. The article warns not to send the matter if the client failed;
  a job that requires `statular_client_id` in its payload cannot.

Note two things about the queue as it stands: `processWorkflowJobs` does **not** check
`firm_settings.durable_workflow_jobs_enabled` — that flag gates enqueueing at call
sites — and `workflow_jobs.job_type` carries a `CHECK` constraint, so the two new job
types need a migration, plus the union in `lib/workflowJobs.ts:11`.

### Data model

One new table, one new settings row shape:

```sql
-- statular_webhooks: the sealed URLs. At most two rows (client, matter).
create table public.statular_webhooks (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('client', 'matter')),
  label          text not null,
  url_ciphertext text not null,   -- sealSecret() — lib/secretBox.ts
  url_iv         text not null,
  url_tag        text not null,
  url_hint       text not null,   -- "stat_whk_EXAM…" for the settings list
  active         boolean not null default true,
  last_used_at   timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
-- One live webhook per kind (partial unique must be an index, not a constraint).
create unique index statular_webhooks_one_active_per_kind
  on public.statular_webhooks (kind) where active;
-- statular_links: what we pushed, and what Statular called it.
create table public.statular_links (
  matter_id           uuid primary key references public.matters(id) on delete cascade,
  statular_client_id  bigint,
  statular_matter_id  bigint,
  client_pushed_at    timestamptz,
  matter_pushed_at    timestamptz,
  last_error          text,
  payload_fingerprint text            -- see §5
);
```

Both `REVOKE ALL ... FROM anon, authenticated` and are read through the service role
only, matching `user_mcp_connectors` (`supabase/migrations/20260708000001_user_api_keys_mcp_connectors.sql:32`),
which is the closest existing precedent: same `sealSecret` / `openSecret` helpers, same
three-column ciphertext/iv/tag layout, same `USER_API_KEYS_ENCRYPTION_SECRET` key
material.

Storing the URL in an env var instead is tempting and worse: rotation would need a
redeploy, and `url_hint` + `last_used_at` are exactly what makes a leaked-credential
decision possible later.

## 4. Field mapping

Cornerstone's model lines up better than expected. The client lives in
`client_intake`, the spouse and children in `contacts`
(`supabase/migrations/20260705000000_drafting_baseline_core.sql`).

### Create client

| Statular field | Cornerstone source | Notes |
|---|---|---|
| `first_name` * | `client_intake.first_name` | **Nullable in our schema.** Preflight must block. |
| `last_name` * | `client_intake.last_name` | Same. |
| `middle_name` | `client_intake.middle_name` | |
| `email` | `client_intake.email` | Statular validates the format; validate ours first. |
| `phone` | `client_intake.phone` | Send `formatPhoneForStorage` output, not the display form. |
| `dob` | `client_intake.date_of_birth` | Already a `date`. |
| `gender` | — | **No source.** We store `preferred_pronoun`, not gender. Omit; see gaps. |
| `marital_status` | `client_intake.marital_status` | Free text on both sides. Pass through. |
| `address.*` | `address_line1/2, city, county, state, zip` | Note the camelCase keys: `streetAddress1`, `streetAddress2`, `city`, `county`, `state`, `zip`. County exists on our side — send it. |
| `partner` | `true` when a `contacts` row has `relationship_type = 'spouse'` | The unique index `uq_contacts_one_spouse` guarantees at most one. |
| `partner_*` | that spouse row's name/email/phone/`date_of_birth` | |
| `partner_address` | spouse row's address columns | Only when it differs; otherwise omit. |
| `children[]` | `contacts` where `relationship_type = 'child'` | See below. |
| `notes` | **synthesized** | Best use of this field: matter number, the Cornerstone matter URL, and "created by Cornerstone push on <date>". It is the only free-text field, and it is what makes the two records findable from each other. |

Children map almost exactly. Statular wants `name` plus `relationship` of
`joint | settlor1 | settlor2`; ours is `contacts.parentage` of `joint | client | spouse`
(`lib/contacts/getHousehold.ts:42`). So:

```
joint  → joint
client → settlor1
spouse → settlor2
```

with `birthdate` from `date_of_birth`, and `deceased`, `phone`, `email`, `address`
available if we ever populate them. Note `settlor1`/`settlor2` is positional: if a
future "swap settlors" ever lands in Cornerstone, this mapping inverts with it.

### Create matter

| Statular field | Cornerstone source | Notes |
|---|---|---|
| `client_id` * | `statular_links.statular_client_id` | From the first call. Never guessed. |
| `doc_id` * | **needs a lookup table** | The open question. See gaps. |
| `state` | `client_intake.state` | Two-letter. |
| `matter_name` | `matters.name`, or `matters.matter_number` + client name | Prefer one that carries the matter number, so Statular's list reconciles against ours by eye. |
| `drafter_id` | omit | Defaults to the minting admin, which is correct for a solo firm. |

### Gaps that need a decision before building

1. **`doc_id` is unknown to us.** The article says to ask support for the package ids,
   or to note one from a hand-made matter. This is the single blocking unknown: without
   it the matter webhook cannot be called at all. Once known, it belongs in a small
   mapping — Cornerstone plan type (`lib/matterPlanType.ts`, `lib/designPlanType.ts`)
   and `design_sheets.is_joint` → `doc_id` — held in settings rather than in code, so a
   new Statular package does not need a deploy. Until it is populated, the client push
   can ship alone and the matter push stays dark.
2. **`gender` has no home in Cornerstone.** `preferred_pronoun` is not gender, and
   inferring one from the other would write a fact about a client that nobody stated.
   Recommend omitting the field. Statular's own interview treats gender as optional and
   offers Other / Clear selection, which the webhook's three values cannot express
   anyway.
3. **`marital_status` vocabularies differ.** Ours (`lib/lawmatics.ts:190`) includes
   `divorced`, `widowed`, `separated`; Statular's interview offers Married / Civil union
   / Registered domestic partnership / Unmarried partnership. The webhook field is free
   text, so a pass-through is safe, but do not expect Statular's interview radio to
   land on anything for the unmarried values.
4. **Several things the interview asks are not in the payload at all** — citizenship
   (`is_us_citizen`), aliases, date and place of marriage, survivor designation,
   disabled-veteran status. They stay in the `.md` export. The webhook builds a thin
   client record on purpose; do not try to smuggle them into `notes`.

## 5. Idempotency, and the trap in it

The natural key is our own primary key, which is stable across every retry:

```
cornerstone:matter:<matter uuid>:client
cornerstone:matter:<matter uuid>:matter
```

Well under 200 characters, and it means a re-run after a timeout returns the original
`{id}` rather than creating a second family.

**The trap:** the article says reusing a key with a *different payload* returns `409`.
So if a push half-fails, the attorney corrects a middle name in Cornerstone, and the
job retries, the retry `409`s — and the correct reading of that `409` is "Statular
already has this client, from the earlier payload", not "try again". Handle it as a
terminal, non-retryable outcome that sets `last_error` to something an attorney can act
on: *"Statular already created this client from an earlier attempt. Open Statular to
confirm, then link the record by hand."*

Store a `payload_fingerprint` (hash of the exact JSON sent) alongside the link so this
case is diagnosable after the fact rather than guessed at. And because a `409` can also
mean "the first attempt is still in flight", distinguish the two by whether we have
ever recorded a fingerprint for that key: no fingerprint ⇒ concurrent, retry after a
delay; fingerprint present and different ⇒ terminal.

## 6. Failure handling, and what the attorney sees

Every documented status maps to a distinct outcome. Treating them uniformly would waste
the specificity Statular gives us:

| Status | Retry? | Surface as |
|---|---|---|
| `201` | — | Link stored; badge on the matter shows "In Statular". |
| `401` | No | "The Statular webhook was revoked or the URL is wrong. Create a new one in Statular and paste it in Settings." Mark the row `active = false`. |
| `403` | No | "Statular rejected the webhook: the admin who created it is no longer active in the firm. A current admin must create a replacement." |
| `409` | Depends — see §5 | Concurrent ⇒ back off once. Different payload ⇒ terminal, needs a human. |
| `422` | No | Our bug or missing data. Log the **field names** returned, never the values. |
| `429` | Yes | Back off; the queue's `available_at` already does this. Pre-empt with `consumeRateLimit` (`lib/rateLimit.ts`) at 25/min so we throttle before Statular does. |
| 5xx / network | Yes | Normal queue retry to `max_attempts`. |

Two confidentiality rules for the logging, consistent with the confidentiality work in
`d97816b`:

- **Never log the URL**, in full or in part, on any path — including error paths, where
  a `fetch` failure message can otherwise carry the request URL. Log `url_hint` only.
- **Never log payload values.** Client names, dates of birth and children's names are
  the payload. Log field names, status codes and counts.

## 7. When to push

Recommended: **an explicit attorney action first**, an automatic trigger second.

The button belongs where the export already lives — the design-sheet toolbar
(`components/guided/DesignToolbarActions.tsx`, next to "Export for Statular (.md)") and
the matter detail page. Reading the two actions side by side is also the clearest
possible statement of the division of labour: *Create in Statular* makes the shell,
*Export for Statular* fills it.

Once that is trusted, the automatic trigger should fire on a stage that means the
client has actually engaged — `drafting` or later, never `new_lead` or
`intake_completed`. A leaked or over-eager trigger on the lead stages would fill
Statular with records for people who never hired the firm, and nothing in this API can
delete them.

Do **not** hang it off intake submission. Intake is client-driven and can be submitted
by someone who never signs an engagement.

## 8. Testing

The `422`-on-unknown-field rule cuts both ways: it is a real hazard in production and a
gift in tests. Mirror Statular's payload as a **strict** Zod schema (`.strict()`) and
parse our own output before sending. A typo like `frist_name` then fails in
`npm test`, not in a client's Statular tenant.

- `tests/statular-webhook-payload.test.ts` — the builders, against fixture
  `client_intake` + `contacts` rows: joint children, one-sided children, no spouse,
  missing county, spouse with a separate address, and the `first_name`-is-null
  preflight.
- `tests/statular-webhook-client.test.ts` — the HTTP layer with an injected `fetch`
  (the pattern `FirmaEsignProvider` already uses in `lib/esign/firma.ts`): one test per
  status row in §6, and one asserting no test ever sees a real URL.
- A dry-run mode that renders the exact JSON without sending, reachable from settings.
  There is no Statular sandbox mentioned anywhere in the article, so the first real
  call lands in the live firm tenant. A dry run is the only rehearsal available.

## 9. Phased plan

**Phase 0 — before any code.** Ask support for the `doc_id` values
(contact@statular.com), and confirm the feature is enabled for the firm at all — the
Webhooks card under Integrations is per-firm and off by default. Mint one client
webhook and one matter webhook, and paste both into Settings while the confirmation
window is open; they are shown exactly once.

**Phase 1 — settings and secret storage.** Migration for `statular_webhooks` and
`statular_links`; `lib/statular/webhooks.ts` for seal/open/list/revoke on top of
`lib/secretBox.ts`; a `StatularWebhooksSection` in the Settings tabs
(`app/admin/settings/StaffSettingsClient.tsx`, alongside `CalendlyLinksSection`),
admin-only, showing kind, label, `url_hint`, last used, and a Revoke button. Paste-only —
the URL is write-once from our side too, and the form should never render it back.

**Phase 2 — the client push.** `lib/statular/payload.ts` (builders + strict schema),
`lib/statular/client.ts` (the HTTP layer, status handling, `Idempotency-Key`), the
`push_statular_client` job type + migration, the preflight, and the button. Ship this
alone: it is useful without the matter push, and it proves the credential path.

**Phase 3 — the matter push.** The `doc_id` mapping in settings, the chained
`push_statular_matter` job, and the matter-page badge showing both ids.

**Phase 4 — the automatic trigger.** Stage-driven enqueue for `drafting` and later,
behind a firm setting, once Phases 2–3 have run by hand often enough to trust.

## 10. Non-goals

Stated so a later reader does not re-litigate them:

- **No sync.** Push-once. A correction after the push is the attorney's to carry across,
  and the UI should say that rather than imply otherwise.
- **No read-back.** The API cannot list or export. Our stored ids are the only handle,
  and losing them means relinking by hand.
- **No design-sheet transfer through webhooks.** It is not in the payload. The `.md`
  export is the answer and stays the answer.
- **No client-side call.** The URL is the credential; it never reaches a browser. Every
  call is server-side, from the queue.
- **No shared webhook.** Statular's own advice is one webhook per outside system.
  Cornerstone gets its own pair, so revoking an intake-form webhook cannot break the
  app, and the firm keeps two of its four slots free.
