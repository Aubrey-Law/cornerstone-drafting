# End-to-end navigation and portal follow-up

Date: September 11, 2026
Starting point: `636ed5d4` (merged PR #463)

## Navigation findings

The earlier browser benchmark's repeated 3.07–3.10 second samples included an
automation artifact: the semantic click helper itself took about 3,075 ms before
returning. Direct accessibility clicks followed by visible-content checks removed
that fixed cost. Five warmed production cycles across Today, Tasks, Leads, Matters,
and Billing then completed in 344–765 ms.

Intermittent delays remained real. Later direct-click cycles included Tasks at
2.0–2.3 seconds, Matters at 1.9 seconds, Today at 4.4 seconds, and Billing at 5.4
seconds. During the slow Billing sample, the authenticated admin shell, header, and
sidebar were already rendered while the route showed its `Loading billing` boundary.
That occurrence was therefore below the preserved layout, in the page request rather
than browser paint or initial authentication.

Privacy-safe timing now covers the missing boundaries:

- proxy total, Supabase claims, and fallback role lookup, also emitted through the
  standard `Server-Timing` response header;
- admin layout total, claims, role, and assistant-model label in slow server logs;
- click-to-primary-ready split into response wait, response transfer, and post-response
  browser render in local User Timing, with slow samples mirrored to the browser log.

Only fixed route/phase labels and millisecond values are retained. URLs, query strings,
record identifiers, returned data, and error text are excluded.

A local cold compile produced a 2.27-second admin-layout sample, of which 2.23 seconds
was the claims phase. That is useful attribution evidence but not a production auth
regression: subsequent preserved-layout navigation did not reproduce it, and no auth
shortcut was made from a development cold-start sample.

## Billing critical path

Ten read-only production probes showed the ledger at 62–116 ms after its first cold
sample (306 ms) and the all-matter picker at 61–99 ms. Neither query is consistently
slow enough to explain the multi-second outlier. The picker read was nevertheless an
unnecessary roughly 80 ms dependency on the ledger's primary content. The default
ledger now loads it only when Add Charge opens; the existing server-search picker was
extended to fetch its empty initial page on demand. A local UI check confirmed the
dialog opens and offers the synthetic matter choices.

## Google verification

The production deployment is connected as the firm Google account. Settings reported
a refreshable connection with Calendar, Gmail send, and Gmail modify capabilities;
Today loaded Google events, and Email Triage loaded the mailbox without a permission or
configuration warning. All 18 outbound email categories were Off, and no setting was
changed or message sent. The deployment checklist was corrected to document triage's
`gmail.modify` requirement and its narrower persistence/send behavior.

## Portal two-session and reconnect acceptance

The acceptance run used a fresh local Supabase stack, the repository's synthetic staff
and client fixtures, two independent authenticated Supabase sessions, and
`EMAILS_ENABLED=false`. No production record or provider was used.

The run passed:

- simultaneous staff and client authentication;
- client insert delivered to the staff realtime channel;
- staff insert delivered to the client realtime channel;
- an insert made while the client channel was disconnected recovered from authorized
  recent history;
- a later insert delivered live after the channel reconnected.

That run exposed a product gap: a rejoined UI channel did not request catch-up history,
so an insert committed during the disconnect could remain absent until a full reload.
The shared realtime hook now signals a second `SUBSCRIBED` event. Staff reloads its
message data, while the portal performs an ownership-checked newest-page reconciliation
and de-duplicates the result with current and optimistic rows.

## Verification

- TypeScript typecheck: passed.
- Focused navigation, billing, Google, email-triage, realtime, portal recovery, and
  authorization suites: 12 files and 70 tests passed.
- Full suite: 506 files and 5,232 tests passed, with one skipped.
- Lint: no errors and 10 pre-existing warnings in unrelated files.
- Synthetic CI production build: passed.
- Local two-session acceptance: all five checks passed.
