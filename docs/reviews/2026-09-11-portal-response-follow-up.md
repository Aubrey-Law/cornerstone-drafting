# Portal response follow-up

## Release evidence

PR #461 is merged as `2b57d59fd89c245597e0810d99d8df075f09e53d`. The production alias resolved to READY deployment `dpl_5ZmBEBwrN8HdroWGBwh8gWAh9zgD` at that commit. Post-merge Application CI, database schema checks, and migration drift passed.

After reloading production, 12 repeated list/detail cycles measured 342–804 ms for the matters list and 730–1,162 ms for the selected matter detail. An initial detail check took 1,056 ms; four other matter details took 671–998 ms. Single Tasks, Leads, and Billing checks took 914, 472, and 670 ms respectively. These are tool-observed AX clicks followed by a visible primary control, including automation overhead; they are not native browser timings or statistically sufficient acceptance of intermittent delays. The first Leads readiness assertion expected a heading named Leads, but the actual heading is Opportunities; that failed selector is excluded, and the successful repeat used the visible New lead button.

No `[matter-detail-timing]` entries were returned for the release during the checked interval. This does not prove all requests are fast or that log delivery has been verified end-to-end. The previously observed intermittent 5–6-second navigation delay remains unresolved. Google Calendar visibly reported disconnected, so connected-calendar acceptance remains pending owner setup.

## Confirmed portal delay and change

The client send action persisted its message and then awaited the attorney notification email before returning. The composer remains disabled during that action. A blocked email-provider fixture reproduced a pending send even after the insert succeeded.

The action now schedules its existing notification with Next.js `after`, returning the persisted message immediately after scheduling. The callback still awaits the existing email helper; it is attached to the request lifecycle rather than an untracked promise. The installed Next.js implementation preserves request context and registers work with the server runtime. See the [Next.js after reference](https://nextjs.org/docs/app/api-reference/functions/after).

Authentication, matter status checks, the session-bound insert, notification recipient/category, and read acknowledgements are unchanged. A failed insert never schedules a notification. Callback failures and scheduling failures cannot turn an already saved message into a failed-send response. No durable queue, retry policy, database migration, provider connection, or SMS path is enabled. Notifications remain best effort and bounded by the hosting runtime's execution limit; this is not durable notification delivery.

## Verification scope

The new action tests reproduce the old delay and verify the saved response precedes email work, exactly one notification is scheduled after persistence, delivery/scheduling failures preserve send success, and failed writes or rejected access never schedule alerts. Component tests verify draft recovery after a failed send, retrying history without losing the current conversation or draft, and retrying read acknowledgement for displayed message IDs only. Existing tests retain realtime echo deduplication and portal history authorization coverage.

All new tests use synthetic local fixtures and mocks at the service boundaries. No real client message or notification was sent. Actual two-session realtime reconnect behavior and provider delivery after deployment remain separate acceptance checks. This change addresses a confirmed portal send dependency; it does not claim to solve the intermittent matter-navigation slowdown.

Validation on Node 24: 494 test files passed, with 5,066 tests passed and one skipped. The four focused portal files passed all 16 tests. Type checking, lint (10 existing warnings), and `npm run build:ci` passed. The build used the repository's synthetic CI environment and installed Next.js 16.2.12. Before implementation, the new response suite failed three assertions against the old behavior; the principal failure showed that the saved-message response was still pending while the email dependency was unresolved.
