# Telnyx inbound softphone final fix report

Date: 2026-07-30
Reviewed base: `beaf5c2`
Previously reviewed head: `5cc84e9`
Functional fix commit: `71038e1`

## Status

PASS FOR SCOPED RE-REVIEW.

Every Critical and Important finding, plus the strict-timeout Minor finding, is
resolved in the committed telephony/rail/tests/docs diff. The committed-range
whitespace check requested by Minor 2 also passes. No drafting file or
`package-lock.json` was changed.

Production was deliberately not configured or deployed. The binding review
decision says rollout must wait for this fix diff to pass scoped re-review, and
the rollout plan now enforces that gate.

## Finding-by-finding verdicts

### Critical 1 — incoming Answer/Decline can be hidden

Verdict: RESOLVED.

Evidence:

- `components/softphone/SoftphoneProvider.tsx:25-29,44-55,73-84` adds an
  explicit `incoming` snapshot field, empty default, and equality tracking.
- `components/softphone/Softphone.tsx:704-720` publishes
  `status === STATUS.INCOMING` independently from the existing active-call
  state.
- `components/rail/AdminRail.tsx:274-290` observes incoming state and opens the
  Phone tab when the rail is closed, minimized, or on another tab.
- `components/softphone/Softphone.tsx:831-880` renders visible Decline and
  Answer actions; the prior `Accept` label is now `Answer`.
- `tests/softphone-rail-pane.test.tsx:245-263` drives a real mocked Telnyx
  `telnyx.notification` call update while the rail is closed on its default
  assistant tab, verifies the Phone tab opens, verifies both actions are
  visible, and verifies Answer reaches the Telnyx call.

### Critical 2 — operator checklist omits SIP/Outbound Voice Profile prerequisites

Verdict: RESOLVED.

Evidence:

- `VERCEL_ENV_CHECKLIST.md:177-191` requires
  `sip_uri_calling_preference: "internal"` on Scott's parent Credential
  Connection and an enabled Outbound Voice Profile associated with the TeXML
  application and parent connection.
- `docs/superpowers/specs/2026-07-29-telnyx-inbound-softphone-routing-design.md:43-55`
  records the same architecture prerequisites.
- `docs/superpowers/plans/2026-07-29-telnyx-inbound-softphone-routing.md:619-626`
  makes both settings explicit rollout steps.

### Important 1 — TeXML form callbacks are sent to a JSON-only callback path

Verdict: RESOLVED.

Evidence:

- `app/api/webhooks/telnyx/texml/route.ts:13-29` is a separate
  content-type-aware TeXML callback path. It accepts only
  `application/x-www-form-urlencoded`, verifies the signature over the exact raw
  body, then parses the form.
- `lib/telnyx/client.ts:53-64` exposes raw-request verification for both JSON and
  form consumers while preserving `unwrapTelnyxWebhook` for JSON parsing.
- `lib/telnyx/voice.ts:81-166` validates `CallSid`, `CallStatus`,
  `CallbackSource`, and strict `SequenceNumber`, then normalizes the TeXML
  callback into the existing `calls` row shape.
- `app/api/webhooks/telnyx/texml/route.ts:31-59` claims
  `texml:<CallSid>:<SequenceNumber>` idempotently and upserts normalized call
  history.
- Existing JSON behavior remains in
  `app/api/webhooks/telnyx/voice/route.ts:27-83` and
  `app/api/webhooks/telnyx/messaging/route.ts:45-135`.
- `tests/telnyx-webhook-routes.test.ts:234-269` builds a real URL-encoded body,
  signs the exact bytes with a generated Ed25519 key pair, posts it to the new
  route, and asserts the event claim and normalized call-history row.
- `VERCEL_ENV_CHECKLIST.md:172-191` and
  `docs/superpowers/plans/2026-07-29-telnyx-inbound-softphone-routing.md:609-618`
  now distinguish API-v2 JSON callbacks from TeXML signed form callbacks and
  point the TeXML application to `/api/webhooks/telnyx/texml`.

### Important 2 — inbound readiness can be true without active/usable Telnyx voice

Verdict: RESOLVED.

Evidence:

- `lib/telnyx/config.ts:50-81` builds inbound readiness from the active
  `VOICE_PROVIDER=telnyx`, the existing outbound Telnyx voice requirements, and
  validated inbound routing.
- `lib/telnyx/config.ts:61-70` includes every failing prerequisite in
  `missing.inboundVoice` before setting `inboundVoiceConfigured`.
- `lib/telnyx/inbound.ts:35-53` returns actionable messages for present-but-invalid
  SIP and fallback values instead of an empty missing list.
- `tests/telnyx-communications.test.ts:111-150` covers complete readiness,
  inactive provider/missing outbound connection, and actionable invalid routing
  output.

### Important 3 — SIP URI validator accepts arbitrary hosts

Verdict: RESOLVED.

Evidence:

- `lib/telnyx/inbound.ts:10,20-31,35-53` restricts the agent target to
  `sip:gencred<alphanumeric>@sip.telnyx.com`, still rejects embedded
  credentials, and reports the expected shape.
- `tests/telnyx-communications.test.ts:249-265` covers both
  credential-bearing URIs and a generated-looking URI on an attacker host.

### Important 4 — cross-endpoint event IDs can poison idempotency

Verdict: RESOLVED.

Evidence:

- `app/api/webhooks/telnyx/voice/route.ts:13-42` verifies that an event has a
  non-empty ID, a `call.*` type, and an object payload before constructing the
  admin client or claiming idempotency.
- `app/api/webhooks/telnyx/messaging/route.ts:39-75` accepts only the supported
  `message.received`, `message.sent`, and `message.finalized` types with an
  object payload before claiming.
- `tests/telnyx-webhook-routes.test.ts:129-196` posts an authentic messaging
  event to Voice and an authentic voice event to Messaging. Each wrong endpoint
  returns 400 without claiming the shared ID; replay to the correct endpoint
  then succeeds and claims/processes it.

### Important 5 — out-of-order voice events can regress terminal call state

Verdict: RESOLVED.

Evidence:

- `lib/telnyx/voice.ts:14-75` defines ranked/terminal call states and a focused
  `mergeTelnyxCallRows` helper. Terminal state and learned answer/end/duration
  fields are sticky.
- `app/api/webhooks/telnyx/voice/route.ts:68-77` uses the helper for existing
  API-v2 JSON callbacks.
- `app/api/webhooks/telnyx/texml/route.ts:49-58` uses the same helper for TeXML
  form callbacks.
- `tests/telnyx-communications.test.ts:176-199` covers a completed-to-ringing
  attempted regression and preserves the prior unknown-first-event fallback.
- `tests/telnyx-webhook-routes.test.ts:198-232` executes the real JSON route
  against a completed row followed by a late initiated event and verifies the
  row remains completed.

### Important 6 — rollout pushes main and probes only status codes

Verdict: RESOLVED.

Evidence:

- `docs/superpowers/plans/2026-07-29-telnyx-inbound-softphone-routing.md:577-603`
  records `REVIEWED_COMMIT`, publishes only the exact feature-branch commit,
  forbids main/production rollout before scoped re-review, and requires the
  deployment source SHA to equal the reviewed SHA.
- `docs/superpowers/plans/2026-07-29-telnyx-inbound-softphone-routing.md:628-651`
  requires response-body and provider assertions: Telnyx token provider,
  communications readiness, exact TeXML destination order/timeout, successful
  authentic JSON/form callbacks, and 401/no-write behavior for tampering.
- The previous `git push origin main` instruction was removed.

### Minor 1 — timeout accepts partial decimal strings

Verdict: RESOLVED.

Evidence:

- `lib/telnyx/inbound.ts:26-31` requires the entire trimmed value to match
  `^\d+$` before converting and clamping; malformed values use the documented
  25-second default.
- `tests/telnyx-communications.test.ts:267-274` verifies `7seconds` does not
  parse as `7`.
- `tests/telnyx-communications.test.ts:276-283` preserves the 120-second upper
  clamp for a valid decimal string.

### Minor 2 — committed-range whitespace evidence

Verdict: RESOLVED.

Evidence:

- `docs/superpowers/plans/2026-07-29-telnyx-inbound-softphone-routing.md:500-506,529-563`
  uses `git diff --check origin/main...HEAD`.
- The command was run after functional commit `71038e1` and exited 0 with no
  output.

## Strict TDD evidence

### RED — final-review regressions

Command:

```bash
npx vitest run tests/telnyx-communications.test.ts tests/telnyx-webhook-routes.test.ts tests/softphone-rail-pane.test.tsx
```

Relevant output before production changes:

```text
tests/telnyx-communications.test.ts: 6 failed
  - missing TeXML status route in status output
  - inbound readiness ignored provider/outbound readiness
  - invalid routing had an empty actionable list
  - mergeTelnyxCallRows was absent
  - arbitrary SIP host was accepted
  - 7seconds parsed as 7

tests/telnyx-webhook-routes.test.ts: 4 failed
  - messaging event on voice returned 200 instead of 400
  - voice event on messaging returned 500 instead of 400
  - completed call regressed to initiated
  - TeXML form route did not exist
```

The first combined run also exposed a test-environment problem:
`window.localStorage` was unavailable in this Node/jsdom invocation. That was
not accepted as behavioral RED; the test harness received an in-memory
`localStorage` implementation and the rail test was rerun before production
changes.

Valid rail RED command:

```bash
npx vitest run tests/softphone-rail-pane.test.tsx
```

Relevant output:

```text
Test Files  1 failed (1)
Tests       1 failed | 9 passed (10)
Unable to find role="button" and name "Answer"
DOM evidence: the rail remained w-0/overflow-hidden and the hidden action was
labelled Accept while Decline was also inside the hidden phone pane.
```

Additional compatibility RED command:

```bash
npx vitest run tests/telnyx-communications.test.ts -t "keeps the existing initiated fallback for an unknown first voice event"
```

Relevant output:

```text
Test Files  1 failed (1)
Tests       1 failed | 21 skipped (22)
Expected status initiated; received unknown.
```

### GREEN — focused implementation cycles

Command after the implementation wave:

```bash
npx vitest run tests/telnyx-communications.test.ts tests/telnyx-webhook-routes.test.ts tests/softphone-rail-pane.test.tsx tests/admin-rail-chrome.test.tsx tests/api-route-auth.test.ts
```

Output:

```text
Test Files  5 passed (5)
Tests       242 passed (242)
```

Compatibility GREEN command:

```bash
npx vitest run tests/telnyx-communications.test.ts -t "keeps the existing initiated fallback for an unknown first voice event"
```

Output:

```text
Test Files  1 passed (1)
Tests       1 passed | 21 skipped (22)
```

## Final verification

Repository-wide suite:

```bash
npm test
```

Output:

```text
Test Files  3 failed | 218 passed (221)
Tests       9 failed | 1851 passed | 1 skipped (1861)
```

Eight failures are unrelated localStorage test-environment failures in
`tests/admin-rail.test.tsx` (7) and `tests/lead-board-view.test.tsx` (1);
all fail before reaching Telnyx assertions because `window.localStorage` is
unavailable in this runtime. The remaining unrelated failure is the existing
`tests/matter-overview-frame.test.ts` source-shape expectation for
`aria-label="Matter stage"`. None of those files or the matter/lead behaviors
are changed by this fix. The scoped Telnyx/rail set below is green.

Full Task 4 focused set plus the new route and rail coverage:

```bash
npx vitest run \
  tests/telnyx-communications.test.ts \
  tests/telnyx-webhook-routes.test.ts \
  tests/softphone-popup.test.tsx \
  tests/softphone-rail-pane.test.tsx \
  tests/admin-rail-chrome.test.tsx \
  tests/api-route-auth.test.ts \
  tests/webhook-idempotency.test.ts
```

Output:

```text
Test Files  7 passed (7)
Tests       257 passed (257)
Exit code   0
```

Changed-file ESLint:

```bash
npx eslint \
  components/rail/AdminRail.tsx \
  components/softphone/Softphone.tsx \
  components/softphone/SoftphoneProvider.tsx \
  lib/telnyx/client.ts \
  lib/telnyx/config.ts \
  lib/telnyx/inbound.ts \
  lib/telnyx/voice.ts \
  app/api/voice/telnyx/inbound/route.ts \
  app/api/webhooks/telnyx/messaging/route.ts \
  app/api/webhooks/telnyx/texml/route.ts \
  app/api/webhooks/telnyx/voice/route.ts \
  tests/admin-rail-chrome.test.tsx \
  tests/api-route-auth.test.ts \
  tests/softphone-rail-pane.test.tsx \
  tests/telnyx-communications.test.ts \
  tests/telnyx-webhook-routes.test.ts
```

Output:

```text
No output; exit code 0.
```

Typecheck:

```bash
npm run typecheck
```

Output:

```text
> node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.typecheck.json
Exit code 0.
```

Whitespace:

```bash
git diff --check
git diff --check origin/main...HEAD
```

Output:

```text
No output; both exited 0. The range check was run after commit 71038e1.
```

Self-review:

- Diff is limited to Telnyx telephony, the admin rail/softphone snapshot,
  focused tests, and operator/design/rollout documentation.
- Existing Telnyx API-v2 JSON callback paths remain intact.
- Twilio provider code and rollback behavior were not changed.
- No drafting internals, migrations, or package lock were changed.
- No API key, SIP password, or other new secret is exposed.

## Files changed

- `VERCEL_ENV_CHECKLIST.md`
- `app/api/webhooks/telnyx/messaging/route.ts`
- `app/api/webhooks/telnyx/texml/route.ts`
- `app/api/webhooks/telnyx/voice/route.ts`
- `components/rail/AdminRail.tsx`
- `components/softphone/Softphone.tsx`
- `components/softphone/SoftphoneProvider.tsx`
- `docs/superpowers/plans/2026-07-29-telnyx-inbound-softphone-routing.md`
- `docs/superpowers/specs/2026-07-29-telnyx-inbound-softphone-routing-design.md`
- `lib/telnyx/client.ts`
- `lib/telnyx/config.ts`
- `lib/telnyx/inbound.ts`
- `lib/telnyx/voice.ts`
- `tests/admin-rail-chrome.test.tsx`
- `tests/api-route-auth.test.ts`
- `tests/softphone-rail-pane.test.tsx`
- `tests/telnyx-communications.test.ts`
- `tests/telnyx-webhook-routes.test.ts`
- `.superpowers/sdd/2026-07-29-telnyx-inbound-softphone-routing/final-fix-report.md`

## Commits

- `5cc84e9` — previously reviewed head.
- `71038e1` — functional final-review fix wave (production code, regression
  tests, operator/design/rollout documentation).

## Deviations and concerns

- No production deployment, Vercel environment mutation, Telnyx portal change,
  or live phone call was performed. Those actions remain correctly gated on
  scoped re-review of this fix diff.
- The repository-wide suite is not fully green: 218 files passed and three
  unrelated files failed as detailed under Final verification. Eight failures
  are caused by unavailable `window.localStorage` in this runtime; one is an
  existing matter-header source-shape assertion outside this diff.
- Vitest printed the runtime's existing Node `module.register()` deprecation
  warning and an experimental localStorage warning. They did not produce test
  failures in the final focused set, which exited 0.
- The TeXML form route defaults an absent direction to inbound because this
  endpoint is dedicated to the inbound TeXML application described by the
  approved design.
- Malformed timeout strings use the documented 25-second default; valid decimal
  strings are clamped to 5–120 seconds.
