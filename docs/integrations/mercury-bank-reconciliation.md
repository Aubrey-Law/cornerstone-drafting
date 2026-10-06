# Mercury bank integration

## Status: Phase 1 and 1b shipped; Phase 3 blocked on a static egress IP

Phase 1 — the read-only deposit worklist — merged in
[#538](https://github.com/Aubrey-Law/cornerstone-drafting/pull/538) and is dark until
`MERCURY_API_TOKEN` is set. Phase 1b (applying a proposal) is built as a daily run that offers
each matched deposit through the delegation dial rather than as a button on the card; see
`docs/operations/mercury-deposit-payments.md`. It keeps "propose, human confirms" as the
default and lets the firm raise exact, memo-confirmed matches to Act and report. Phase 3
(pushing invoices to Mercury) is specified here but not built; it cannot start until the egress
problem in Phase 2 is funded.

## Context

Cornerstone Lite already owns a complete, well-tested invoicing subsystem: `invoices` /
`invoice_items` with gapless numbering, DOCX+PDF rendering, email send via Resend, reminder
drafts, credit notes, refunds/disputes, a Stripe checkout path, a payments ledger in integer
cents, and a monthly accounting CSV (`app/api/admin/billing/export/route.ts`). Before Phase 1
there was no connection to the bank at all: every ACH/check deposit was hand-keyed as a
payment, and the only accounting handoff was a CSV a human downloaded.

**Mercury Accounting will be the firm's sole accounting system in 2027.** QuickBooks Online is
not used. This matters because the repo currently says otherwise —
`docs/superpowers/plans/2026-09-02-workbench-overhaul.md` named QBO as the accounting system
and deferred a QBO integration. That document was corrected in #538; any remaining QBO
references in onboarding or preferences material are still stale.

That correction inverts the usual guardrail. The question is not "how do we keep Mercury from
becoming a second ledger" — Mercury *is* the intended ledger. The question is how Cornerstone
feeds it without either system drifting.

### Target architecture

| System | Owns |
|---|---|
| **Cornerstone** | AR **origination** — matter context, fee schedules and milestones, legal-plan claims, the gapless invoice number, the client/matter relationship. |
| **Mercury** | Invoice **delivery and collection** (native ACH/card pay link), cash, and **accounting**. |

Two consequences drive the phasing:

1. **Invoice push is on the critical path**, not an optional extra. If AR only ever lives in
   Cornerstone, Mercury Accounting's books are structurally incomplete.
2. **Once Mercury sends and collects, most of the matching problem disappears.** Mercury links a
   payment to its own invoice natively, so Cornerstone polls status instead of inferring from
   amount and name. The fuzzy matcher stops being the endgame and becomes a permanent bridge for
   money that never flows through a Mercury invoice — paper checks, direct ACH, and legal-plan
   carrier EFT (carriers do not pay via a client pay-link).

### Decisions taken

| Question | Decision |
|---|---|
| Who invoices the client | **Mercury sends and collects.** Cornerstone builds from matter/fee data and pushes. |
| Reconciliation posture | **Propose, human confirms.** Never auto-post. |
| Static egress IP | **A funded 2027 prerequisite**, costed below — not a vague blocker. |
| Deposit account allowlist | **Income ••0876 only** (`40e1b452-85d1-11f1-92ba-23367ea93847`). Env var, so widening is config. |
| Payer-name reliability | **Mixed/unknown** → start balanced, retune against real data. |
| Split payments | **One-to-one.** Odd cases stay manual via the existing payment form. |
| Invoice identity | **Cornerstone's `invoices.number` is pushed as Mercury's `invoiceNumber`.** One number, two systems. |

### What the live account shows

Verified read-only against the firm's real Mercury account:

- **Mercury invoicing is currently a trial.** Exactly two invoices: `INV-1` ($1, Cancelled, a
  test) and `INV-1002` ($725, Paid, "College Preparation Plan"). Two customers, one a test. So
  the push path is a greenfield build, not a migration.
- **A naive reconciler would produce garbage.** In a 15-transaction sample, most positive-amount
  transactions were *not* client payments: `internalTransfer` pairs between the firm's own
  Profit-First accounts (showing as matched +25/−25), `Mercury IO Cashback` credits (+0.18,
  +0.56), and credit-card autopay pairs. Filtering must be allowlist-by-account plus
  denylist-by-kind, never "amount > 0".
- **Six accounts, Profit-First:** OpEx ••2536, Profit ••6261, Govt Payments ••9774,
  **Income ••0876**, Reserve ••3258, Payroll ••0301. Client money lands in Income — it is the
  `destinationAccountId` on both existing invoices.

---

## Phase 1 — read-only deposit worklist (shipped, zero migration)

Read-only Mercury tokens need **no IP whitelist**, which is what let this ship first. Proves the connection, and
delivers the deposit worklist that stays useful permanently for out-of-band payments.

### New files — `lib/integrations/mercury/`

| File | Responsibility |
|---|---|
| `config.ts` | `getMercuryConfig()` → `{ baseUrl, token, incomeAccountIds }` or throws `IntegrationError('attention','configuration_required')`. `getMercuryConfigStatus()` returns **booleans only**. Base-URL hostname allowlist (`api.mercury.com`, `api-sandbox.mercury.com`), https only — mirroring `lib/integrations/statular/config.ts`. |
| `money.ts` | `decimalToCents()` / `centsToDecimalString()`. The only place dollars exist. |
| `types.ts` | Zod schemas: account, transaction, invoice, customer, page envelope. Amount fields `.transform(decimalToCents)` and **named `amountCents`**, so a raw dollar value has no name to travel under. |
| `client.ts` | `mercuryRequest<T>()` + `listMercuryAccounts`, `listMercuryTransactions`, `getMercuryTransaction`, `listMercuryInvoices`, `getMercuryInvoice`. |
| `normalize.ts` | Pure. Mercury transaction → `MercuryDeposit`. |
| `reconcile.ts` | **Pure.** `classifyDeposit()` + `proposeDepositMatches()`. |
| `deposits.ts` | `'server-only'` orchestration: fetch Mercury, load open invoices + applied references, call the pure matcher. The only file touching both sides. |

**Reuse, don't rebuild.** Copy the client discipline verbatim from
`lib/integrations/lawmatics/client.ts`: `'server-only'`, plain `fetch` (no SDK),
`REQUEST_TIMEOUT_MS = 30_000` + `AbortController` + caller-signal forwarding,
`cache: 'no-store'`, `redirect: 'error'`, a `responseFailure(response)` switch (429 →
`retryable`/`rate_limited` with parsed `Retry-After`; ≥500 → `retryable`; 401/403/404/422 →
`attention`/\*), and the standing rule: **never read or log a provider error body**. Reuse
`IntegrationError` / `safeIntegrationError` from `lib/integrations/errors.ts`. Take the
reconciliation posture from `lib/esign/reconcile.ts` — read-only from the provider, write only
on an authoritative response.

Client notes: use **`postedStart`/`postedEnd`**, never `start`/`end` (those filter `createdAt`
and miss settled transactions). Follow `page.nextPage` in a **bounded** loop with a hard cap,
the idiom already in `allAccountingRows` (`lib/queries/invoiceBalances.ts`). **No retry loop in
the client** — a 429 propagates with `retryAfterMs`; retries belong to `lib/workflowJobs.ts`,
which already honours it. Keep every path in one `MERCURY_PATHS` constant: singular-vs-plural
for single-resource paths (`/ar/invoices/{id}` vs `/ar/invoice/{id}`) is **unconfirmed** and
must be verified with the read-only token.

### Money conversion — `money.ts`

Mercury returns decimal **dollars** (`725`, `0.18`, `-12.48`); the app is integer **cents**.
`Math.round(x * 100)` is wrong — `Math.round(1.005 * 100) === 100`, and
`(1.005).toFixed(2) === "1.00"`. So operate on the decimal *string*:

1. Accept `number | string`; reject null/NaN/Infinity/objects/empty with
   `IntegrationError('attention','amount_invalid')`.
2. For a number use `value.toString()` — JS emits the shortest round-tripping decimal, so
   `1.005` becomes `"1.005"`, recovering the intent that `* 100` destroys.
3. Normalize exponent notation (`7.25e2`, `1e-2`).
4. Match `/^-?\d+(\.\d{1,2})?$/`. **More than two fractional digits throws**
   (`amount_precision`) — a 3-decimal amount from a bank means an assumption broke, and
   rounding silently turns that into quietly wrong money.
5. Compute in `BigInt`, assert `MAX_SAFE_INTEGER`, return `Number`.

`centsToDecimalString()` is the inverse, built by integer division and `padStart` (never
`cents / 100`). Phase 3 needs it for `unitPrice`.

### The matcher — `reconcile.ts` (pure, no I/O, no clock)

```ts
proposeDepositMatches(input: {
  deposits: readonly MercuryDeposit[]
  invoices: readonly OpenInvoice[]        // balanceCents from loadInvoiceBalances()
  incomeAccountIds: readonly string[]
  appliedReferences: ReadonlySet<string>  // 'mercury:<txnId>' already on billing_payments
  dateWindowDays?: number                 // default 45
  todayKey: string                        // injected; never reads a clock
}): DepositProposal[]
```

**Stage 1 — filter** (`classifyDeposit`, first match wins). This is what the live evidence
demands:

| Condition | Ignore reason |
|---|---|
| `amountCents <= 0` | `not_a_credit` |
| account not in `incomeAccountIds` | `wrong_account` |
| `kind === 'internalTransfer'` | `internal_transfer` — kills the +25/−25 pairs |
| `kind === 'creditCardTransaction'` | `card_activity` — kills autopay pairs |
| counterparty matches a house pattern | `house_credit` — kills `Mercury IO Cashback` |
| status ∈ {cancelled, failed, reversed, blocked} | `not_settled` |
| status `pending` | `pending_settlement` — shown, never proposed |
| reference already applied | → `already_applied` |

House patterns: an exported, anchored, case-insensitive `readonly RegExp[]` (`/^mercury\b/`,
`/\bio cashback\b/`, `/\bmercury (checking|savings|treasury|vault)\b/`,
`/\binterest (payment|paid)\b/`). Ignored deposits are **still returned with their reason**,
collapsed in the UI — a silently dropped deposit is indistinguishable from a bug.

**Stage 2 — score** each surviving deposit × open invoice:

- **Amount is the gate.** `=== balanceCents` → +100; `=== subtotalCents` (full face value of a
  partially-paid invoice) → +60; otherwise 0. **No fuzzy amount matching** — "close enough" on a
  bank feed is how you post the wrong payment.
- **Name**, via `normalizePayerName()` (lowercase, strip punctuation/diacritics, drop
  `the|trust|revocable|living|family|llc|inc|estate|of`, token-set Dice) against
  `billToName ?? clientName`: ≥0.80 → +40; ≥0.50 → +20; surname exact → +10.
- **Date** vs `issueDate`: within window → +15; posted >2 days *before* issue → −50 **and cap
  confidence at `possible`** (a client can wire before the invoice is cut; hard-excluding would
  hide real money).
- Exactly one open invoice overall → +5.

Confidence: amount-exact **and** a name reason → `exact`; amount-exact alone → `probable`;
otherwise `possible`. Weights start here and get retuned against the real queue — the function
is pure, so that is a safe change.

**Ambiguity is a first-class output, never a coin-flip.** Top two within 15 points →
`ambiguous` with all candidates and no winner (identical amounts are common in a flat-fee
practice — $725 College Prep already repeats). Best confidence only `possible` → `ambiguous`,
so a name-only match never looks like a decision the software made. A post-pass tracks running
per-invoice allocation so two deposits can't both claim one invoice; without it, the RPC's
over-balance exception ends up doing the UI's job. No candidates → `unmatched`, and shown,
because an unmatched real deposit is exactly what the firm needs to see.

**Why propose, never auto-post.** The evidence (most credits aren't payments); posting isn't
inert (`record_invoice_payment` flips `billing_items.status`, can write
`matter_details.fee_payment_status`, stops the reminder cadence, and on the checkout path emails
a receipt — a wrong auto-post tells a client they've paid); repo culture
(`prepareInvoiceReminders` drafts and never sends; `lib/esign/reconcile.ts` says in a comment
that a background job emailing clients "is how a reconciliation sweep turns into an incident");
the bank has no invoice linkage, so every match is an inference; and there is no
`unrecord_invoice_payment` — an auto-poster with no undo is a one-way door.

### Modified files

| File | Change |
|---|---|
| `lib/integrations/types.ts` | Add `'mercury'` to `IntegrationProvider`. |
| `lib/integrations/records.ts` | Add a `PERSISTABLE_PROVIDERS` set asserted in `identity()`. **Necessary:** `integration_external_records.provider` has `check (provider in ('lawmatics','statular'))` (`supabase/migrations/20261203000000_scheduler_integration_foundation.sql:30`), so widening the TS union alone would make an invalid write typecheck. |
| `app/admin/billing/page.tsx` | Mount `<MercuryDeposits />` in the existing `<Suspense>` region on the `insights` tab, beside `<BillingSummary />`. |
| `scripts/validateEnv.mjs` | One `PARTIAL_FEATURES` entry: trigger `MERCURY_API_TOKEN`, requires `MERCURY_INCOME_ACCOUNT_IDS`. |
| `VERCEL_ENV_CHECKLIST.md` | New "Optional — Mercury bank reconciliation" section mirroring the existing "Optional — online invoice payment" tone; document the 45-day token policy and the static-IP prerequisite. |
| `docs/superpowers/plans/2026-09-02-workbench-overhaul.md` | **Correct the stale QBO premise.** Record that Mercury Accounting is the 2027 system of record and QBO is not used, so the next reader doesn't re-derive the wrong architecture. |

### Route and UI

`app/api/admin/billing/mercury/deposits/route.ts` — `GET ?days=30&limit=100`.
`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`. `requireAdmin(req)`;
Zod query (`days` 1–120, `limit` 1–200) → 400 on the first issue; token unset → **503**, the
same first-class off state as the checkout route. `IntegrationError` → `safeIntegrationError()`
body, 429 for rate limits (echo `Retry-After`), 503 other retryable, 502 attention. Response
carries `{ generatedAt, window, accounts, summary, proposals }` and **only what the card
renders** — explicitly drop `trackingNumber`, `cardId`, `categoryData`, `mercuryCategory`,
account numbers and balances.

`app/admin/billing/MercuryDeposits.tsx` is an **async server component** calling
`loadMercuryDepositProposals()` directly — no self-fetch, matching how `BillingSummary` works.
The GET route is the JSON contract for verification and future client refresh, not the page's
data source. `MercuryDepositsCard.tsx` clones the structure of `RecentPaymentsCard.tsx` and
formats money with `moneyExact()` from `app/admin/billing/financeFormat.ts`, which takes
**cents** — closing the loop on the conversion.

Sections: **Proposed** → **Needs a decision** (each candidate with its reasons) → **Unmatched**
→ **Ignored** (collapsed `<details>`, grouped with counts: "33 ignored · 21 internal transfers,
8 card activity, 4 Mercury credits"). Unconfigured → render `null`. Each proposed row ends in a
**"Record payment" button, `disabled` in Phase 1** — the visible seam that makes the Phase 1b
diff tiny.

`eslint.config.mjs` sets `theme/no-raw-palette`, `theme/no-arbitrary-font-size` and
`theme/no-surface-opacity` to **error** — tokens only (`text-muted-foreground`, `border-border`,
`text-green`, `var(--chart-1)`). Reuse the `components/billing/BillingStatusBadge.tsx` idiom for
confidence badges rather than inventing colours.

### Config

Env vars, not `lib/secretBox.ts` — the token is a **firm-level** credential, and `secretBox` is
built for per-user keys (it needs `USER_API_KEYS_ENCRYPTION_SECRET` and a table, which forces a
migration). Every other firm-level credential here is an env var.

- `MERCURY_API_TOKEN` — Read Only token. **Unset = feature off**, card absent, route 503.
- `MERCURY_INCOME_ACCOUNT_IDS` — required when the token is set. Do **not** hardcode the Income
  UUID in source; document it in the checklist. Unset → everything classifies `wrong_account`
  and the card says "Choose the deposit account", a legible failure.
- `MERCURY_API_BASE_URL` — optional, defaults to production; only the sandbox host is otherwise
  accepted.

No `firm_settings` boolean: milestones and durable jobs need a flag because they ship *dark*
with inert schema. Mercury has no dark schema — the env var already is the switch, exactly as
`PAYMENTS_PROVIDER` is.

### Why zero migration, and what it costs

Nothing is persisted: proposals are derived on demand from a live Mercury read plus `invoices`
and `billing_payments`. No webhook, so no dedupe-table CHECK to widen. No new payment method —
`'ach'` is already in the `billing_payments` CHECK. Phase 1 is reversible by unsetting one env
var, which is worth real money for a first integration against a bank.

Honest costs: no audit trail of what the matcher decided (mitigated by determinism plus
returning `ignoreReason`, so it is always re-derivable); no "dismiss forever", so a genuine
non-invoice deposit nags on every load; no cron, so it is on-demand only; and the 45-day token
expiry has no keep-alive (see Risks).

---

## Phase 1b — apply a proposal (small, one migration)

`POST /api/admin/billing/mercury/deposits/apply`, body
`{ transactionId, invoiceId, amountCents, receivedAt }`:

1. `requireAdmin`; Zod-validate.
2. **Re-fetch the transaction from Mercury** (`getMercuryTransaction`). Following
   `lib/esign/reconcile.ts`: write only on an authoritative response — a stale page must not be
   able to post money.
3. Re-derive cents from the authoritative payload. Disagreement with the submitted amount, a
   no-longer-settled status, or a non-income account → **409, no write**. The client's number
   exists only to detect drift; it is never trusted.
4. Duplicate pre-check on `external_reference = 'mercury:' + transactionId` → `{ duplicate: true }`.
5. `rpc('record_invoice_payment', { …, p_method: 'ach', p_external_reference: 'mercury:<id>', p_received_at: postedAt, p_actor_id: auth.userId, p_processor_fee_cents: 0 })`.
6. Errors → `billingFailure()`, which already maps `22003` → 409, `P0002` → 404, `42501` → 403.

**Correction worth flagging:** `external_reference` gives *detectable*, not *enforced*
idempotency. Verified — the only unique constraint touching that column is on
`billing_adjustments (provider, external_reference, kind)`; `billing_payments` has no such
index, and `record_invoice_payment` has no internal short-circuit the way
`complete_invoice_checkout_session` does. Two concurrent applies can both pass step 4 and both
write, and a *partial* payment double-posts silently. So Phase 1b's migration must add:

```sql
create unique index concurrently if not exists billing_payments_external_reference_key
  on public.billing_payments (external_reference, billing_item_id)
  where external_reference is not null;
```

`billing_item_id` belongs in the key because one RPC call writes N rows sharing the reference.
The existing Stripe path already writes `external_reference`, so check production for
historical duplicates first — if the index fails to build, that failure is itself useful.

---

## Phase 2 — static egress IP (funded prerequisite, blocks Phase 3)

Mercury requires **IP whitelisting for any read-and-write token**; writes from a
non-whitelisted IP get 403. Vercel serverless has no stable egress IP. Three options:

| Option | Shape | Trade-off |
|---|---|---|
| **Vercel Enterprise Secure Compute** | Native, no extra hop | Enterprise-tier pricing; heaviest commitment |
| **Static-IP forward proxy** (QuotaGuard/Fixie) | Cheapest, fastest to stand up | The Mercury **write** token transits a third party — a real security consideration for a banking credential |
| **Small always-on host** for the write path only | Full control of the credential; fixed IP | A second deployable to run and monitor |

**Recommendation: the always-on host.** Only the write path moves; Vercel keeps serving the app
and all reads. It avoids putting a banking write token through a third-party proxy, and the
surface is small — a single service that accepts an authenticated internal call and forwards it
to Mercury. Cost and operational burden should be confirmed against the Secure Compute quote
before committing.

This is on the critical path to the 2027 goal. Nothing in Phase 1/1b depends on it.

---

## Phase 3 — Cornerstone pushes, Mercury sends and collects

New: `lib/integrations/mercury/{invoices,customers,jobs}.ts` (a `mercury_push_invoice`
`WorkflowJobType` — retries and backoff come free from `lib/workflowJobs.ts`), and
`app/api/admin/billing/invoices/[id]/mercury/route.ts`.

Flow: on issue, ensure a Mercury customer exists for the matter's client (map stored in
`integration_settings` via the existing `sanitizeProviderIdMap()`), then `POST /ar/invoices`
with `invoiceNumber` = **Cornerstone's `invoices.number`**, `destinationAccountId` = Income
••0876, line items from `invoice_items` via `centsToDecimalString()`, and
**`sendEmailOption: 'SendNow'`** — Mercury emails the client with a native ACH/card pay link.

**The hazard inverts, it does not disappear.** Cornerstone currently emails every issued invoice
through Resend. If Mercury also sends, the client gets two invoice emails from two senders with
two payment links. So Phase 3 must *suppress Cornerstone's send* for pushed invoices in the same
change that enables Mercury's. Make `sendEmailOption` a **required, no-default field** in the
request schema so it can never be implicit, and set `creditCardEnabled`/`achDebitEnabled`
explicitly rather than inheriting their `true` defaults — a card-fee-bearing option nobody chose
is its own small incident.

Then payment detection becomes a **status poll**, not a guess: there are no invoice webhooks
(Mercury's documented events are transaction/balance only), so a sweep on the existing
workflow-jobs cron reads `GET /ar/invoices` and records a payment when status flips to `Paid`.
Reuse `record_invoice_payment` with `external_reference = 'mercury-invoice:<id>'`.

**What stays on the matcher permanently:** paper checks, direct ACH, and legal-plan carrier EFT
(MetLife/LegalEASE/ARAG — carriers do not pay via a client pay-link, and those claims remain
Cornerstone-originated AR). The Phase 1 worklist is not throwaway scaffolding.

**Also revisit at this point:** Stripe checkout becomes largely redundant for direct-pay once
Mercury collects. Keep it as a card fallback or retire it — a decision, not an assumption.

---

## Tests

Every row but the last shipped with Phase 1 — 78 tests, weighted to the money conversion and
the pure matcher, the two places a defect would cost real money.

| File | Asserts |
|---|---|
| `tests/mercury-money.test.ts` | **Highest value.** Table: `725→72500`, `0.18→18`, `-12.48→-1248`, `"1.10"→110`, `7.25e2→72500`, `1e-2→1`, `0.07→7`; `1.005`, `0.30000000000000004`, `MAX_SAFE_INTEGER`, `NaN`/`null`/`"abc"` all throw. A named regression test asserting that `1.005` *throws* while `Math.round(1.005*100)` silently returns `100` and `(1.005).toFixed(2)` returns `"1.00"`, so both wrong answers sit beside the right behaviour in the file. Round-trip property across magnitudes incl. negatives. Every throw is an `attention` `IntegrationError` that does not echo the bad value. |
| `tests/mercury-reconcile-matcher.test.ts` | **Highest value.** Fixtures shaped from the real 15-transaction sample: `internalTransfer` excluded and a +25/−25 pair yields zero proposals; cashback +0.18/+0.56 → `house_credit`; non-income account → `wrong_account`; `pending` shown but never proposed. Then: exact balance + single candidate → `proposed`/`exact`; two identical open balances → `ambiguous`, 2 candidates, no winner; name-only → `ambiguous`; posted before issue → capped `possible`; applied reference → `already_applied`; two deposits contending → both `ambiguous`; determinism (same input twice → `toStrictEqual`, clock frozen). |
| `tests/mercury-client.test.ts` | Modelled on `tests/payments-stripe.test.ts`. Stubbed fetch: Bearer header; `cache: 'no-store'`; `redirect: 'error'`; path allowlist rejects absolute URLs and traversal; **query uses `postedStart`/`postedEnd`**; 429 → `rate_limited` + `retryAfterMs` (numeric and HTTP-date); 500 → retryable; 401/403/404/422 → attention; abort → timeout; pagination stops at the cap. Plus the sentinel from `tests/integration-error-classification.test.ts`: a 422 body containing a sentinel must not appear in the serialized error, and neither must the token. |
| `tests/mercury-schemas.test.ts` | `status: 'Paid'` (capitalized) accepted; `lineItems` absent on list / present on get both parse; `canceledAt` (single-l) optional; unknown fields ignored; the `{ "<resource>": [...], "page": {...} }` envelope parses per resource. |
| `tests/mercury-config.test.ts` | `getMercuryConfigStatus()` returns booleans only and its JSON contains no token substring; base-URL allowlist rejects non-Mercury hosts, http, embedded credentials. |
| `tests/mercury-deposits-route.test.ts` | Modelled on `tests/billing-routes.test.ts`. 401 without admin; 503 token unset; 400 on `days=0`/`days=999`; response contains no `trackingNumber`, `cardId`, account number or token; error-status mapping. |
| `tests/integration-records.test.ts` *(extend)* | The `PERSISTABLE_PROVIDERS` guard rejects `'mercury'` while the SQL CHECK still excludes it. |
| *(Phase 1b)* `tests/mercury-apply-payment.test.ts` | Duplicate reference → `{duplicate:true}` with **no** RPC call; refetch mismatch → 409 with no RPC call; happy path passes `p_method:'ach'` and `p_external_reference:'mercury:<id>'`; `22003` → 409. |

---

## Switching Phase 1 on, and verifying it

Phase 1 is merged but inert until the environment variables are set. This is the procedure for
turning it on and confirming it behaves.

1. Mint a **Read Only** token in the Mercury dashboard — no IP whitelist needed. Do **not** mint
   read-and-write yet.
2. `.env.local`: `MERCURY_API_TOKEN=<token>`,
   `MERCURY_INCOME_ACCOUNT_IDS=40e1b452-85d1-11f1-92ba-23367ea93847`
3. `node scripts/validateEnv.mjs` → clean. Temporarily unset `MERCURY_INCOME_ACCOUNT_IDS`,
   re-run, confirm the partial-feature warning fires, restore.
4. `npm run typecheck && npm test && npm run lint`
5. `npm run dev`, then
   `curl -s -H "Authorization: Bearer <admin jwt>" 'http://localhost:3002/api/admin/billing/mercury/deposits?days=90' | jq '.summary'`
   → `scanned` well above zero, `ignored` the large majority, `proposed` in low single digits.
6. **The acceptance test for the hazard:**
   `… | jq '[.proposals[] | select(.status=="ignored") | .ignoreReason] | group_by(.) | map({reason:.[0], n:length})'`
   → the +0.18/+0.56 cashback rows are `house_credit`, the +25/−25 pair is `internal_transfer`.
7. Grep the full response for `trackingNumber`, `cardId`, the token, any account number — all absent.
8. Open `/admin/billing?tab=insights`: card renders, counts match step 5, "Record payment" disabled.
9. **Rollback:** unset `MERCURY_API_TOKEN`, restart — card absent, route 503, every other billing
   surface unchanged.
10. **Dead token:** revoke it in Mercury, reload — a "Reconnect Mercury" line, no 500, no stack.
11. Hand-check one `proposed` deposit against Mercury's UI and the Cornerstone invoice before
    anyone enables Phase 1b.

---

## Risks

- **Dual invoicing during the transition (Phase 3).** The window where both Cornerstone and
  Mercury can email an invoice is the single most client-visible failure mode. Suppressing the
  Resend send must land in the same change that turns on the Mercury send, not after it.
- **Invoice-number divergence.** Mercury auto-assigns `invoiceNumber` when the field is omitted.
  Omit it once and the two sequences diverge permanently. Always push Cornerstone's number, and
  test that it round-trips.
- **45-day token expiry.** A read-only token auto-deletes after 45 days of no activity; a
  read-and-write token silently downgrades to read-only after 45 days without a *write* — which
  would make Phase 3 pushes start failing with nothing obviously changed. Accept a clear
  "Reconnect Mercury" state in Phase 1; add a weekly `GET /accounts` keep-alive on the existing
  workflow-jobs cron when Phase 3 lands. Worth naming that a keep-alive existing solely to
  satisfy a vendor's expiry policy is a smell we'd be accepting deliberately.
- **Rate limits are unpublished.** Handled empirically: 429 → retryable with parsed
  `Retry-After`, no retry loop in the client.
- **Pending ACH can reverse.** Never propose a pending deposit; show it in its own group.
- **Unconfirmed singular/plural single-resource paths.** Verify with the read-only token; one
  constants object keeps the fix to one line.
- **Legal-plan claims never flow through Mercury AR.** Carrier reimbursements arrive as bank
  deposits with no invoice linkage, so Mercury Accounting will see the cash but not the
  receivable. Decide before 2027 whether those claims get pushed as Mercury invoices too (so AR
  is complete) or stay Cornerstone-only with the deposit matcher as the bridge.
