# Task 5 report

## Result

- Converted matters load linked lead notes, lead meeting notes, and lead activity from `client_intake_id` without inserting or copying rows.
- Notes and activity use stable source identities, suppress represented lead activity, and remain reverse chronological.
- Lead-origin history is labeled `From lead`.
- Lead note edits and deletes continue to use `/api/admin/leads/[leadId]/notes/[noteId]`; matter notes continue to use matter-note actions.
- Drafting internals and the unrelated `LeadDetailClient 2.tsx` were not touched.

## TDD

- RED: `npx vitest run tests/lead-conversion-history.test.tsx` failed with `mergeLinkedNotes is not a function`.
- GREEN: the same suite passed 2/2 after implementing linked display DTO merging and routing.

## Verification

- Lead/notes/Granola/activity/conversion suites: 11 files, 86 tests passed.
- Scoped ESLint: passed.
- `git diff --check`: passed.
- `npm run build:next`: passed, including Next.js TypeScript and all 53 static pages.
- `npx tsc --noEmit -p tsconfig.json`: reports only pre-existing errors in `tests/*.test.ts` (`firma-engagement-poc`, `lead-detail-route`, and `lead-details-persistence`), consistent with the documented baseline; no production-file error was reported.

## Visual verification

Not performed: the requested authenticated desktop/mobile matter state requires a running seeded Supabase/auth environment. Automated component behavior, scoped lint, and the production build were used as the available verification gates.

## Review fixes

- Routed both Save clicks and Cmd/Ctrl+Enter lead-origin edits exclusively through the lead-note handler; matter routing remains unchanged.
- Added rendered tests for lead/matter click and keyboard mutations, delete routing, origin labels, loader-shaped provenance, chronological order, and exact-once deduplication.
- Added `matter_notes.source_lead_note_id` as an immutable, nullable, unique foreign-key provenance field in `20260730020000_link_lead_history.sql`; linked lead meeting notes remain direct read-only projections rather than copied matter rows.
- Selected and mapped the provenance field in the server loader.
- Bounded linked lead activity to the newest 200 records, removed the duplicate client activity fetch, and made all matter/linked-history query errors fail explicitly.
- Review verification: 11 focused files / 90 tests passed; scoped ESLint and `git diff --check` passed; `npm run build:next` passed. The direct `tsconfig.json` check continues to report only the documented pre-existing test typing errors.

## Final activity provenance fix

- Corrected exact-once activity merging to follow the persisted direction: `lead_activity.source_matter_activity_id` references `matter_activity.id`.
- The production loader now maps that field through `buildLinkedMatterActivity`; it no longer relies on nonexistent `matter_activity.metadata.source_lead_activity_id` provenance.
- Added a loader-shaped rendered timeline test proving mirrored activity renders once, lead-only activity retains `From lead`, and chronology remains correct.
- TDD RED: the new builder was missing and the inverse merge retained the mirrored lead row. GREEN: 3 focused files / 12 tests passed.
- Final verification: 11 focused files / 91 tests passed; scoped ESLint and `git diff --check` passed; `npm run build:next` passed.
