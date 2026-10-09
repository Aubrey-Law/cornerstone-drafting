# Internal discovery calls

Staff start or resume Discovery call from a lead's Overview or Intake tab. Each call pins a published form version. Completed calls are read-only; corrections are dated, attributed amendments. Completing a call adds one timeline event, with no automatic email, task, lead-status, or discovery-date changes.

## Installation and release gate

1. Apply normal pending migrations, including `20270131090300_internal_discovery_calls.sql`, to the intended environment. Use a local database first; never reset a linked/shared database.
2. Set the application's normal server database environment variables. The installer reads `.env.local` when present.
3. Run `npm run discovery:form:install` for a read-only check.
4. Run `npm run discovery:form:install -- --apply --actor-id <administrator-user-UUID>` to install and publish the default definition.
5. Confirm Discovery call is available on a fixture lead and verify a draft save/reload before enabling release traffic.

The entry point stays disabled when the schema or published `internal_discovery_call` template is unavailable. The installer preserves an already published definition; it will not overwrite administrator edits. Existing unfinished calls resume their pinned version. Publishing a newer definition affects only new calls.

Administrators manage definitions in the existing form builder. Purpose is fixed at creation, retained on duplication, and defaults to `client_intake` for existing templates. Discovery definitions allow only discovery fields and staff audiences, including conditions and preview. Client/public form resolution rejects discovery templates.

## Staff workflow

- Drafts autosave. Save failures retain local answers and expose retry. Conflicts expose export and a confirmed reload; they never silently replace local work.
- Completion requires call date/time, outcome, and next action. No further action additionally requires a reason.
- Canonical handoff is optional: review Current/Proposed values and explicitly select each change. The server rechecks current values and uses the existing canonical contact/linking mutation. Changes made elsewhere require renewed review.
- Organizer sending, meeting scheduling, and task creation require a separate action. Task creation checks equivalent open tasks and requires an owner and due date. Organizer delivery reports suppressed, redirected, logged, and failed delivery accurately.
- Internal notes and screening answers stay in the discovery record. Existing notes and referral attribution are untouched.

## Verification

Focused tests: `npm exec vitest run tests/discovery-form.test.ts tests/discovery-routes.test.ts tests/discovery-workspace.test.tsx tests/discovery-next-action.test.tsx`.

`tests/integration/discovery-calls.sql` is a rollback-only database check. Run it against an isolated migrated local database using psql variables `definition` (JSON from `DISCOVERY_DEFINITION`) and `hash` (its `hashIntakeFormDefinition` value). It exercises revision conflicts, completion idempotency, timeline uniqueness, canonical handoff conflicts, retired pins, and client/public access denial. The test must not target a shared environment.

Run `npm run lint`, `npm run typecheck`, and `npm test`. Browser verification must include keyboard navigation, failed-save recovery, departure protection, completed-call immutability, and narrow layouts. The development browser pass used synthetic API responses; an authenticated deployment smoke test remains a release requirement.
