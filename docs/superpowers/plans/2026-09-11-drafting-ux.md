# Drafting UX Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** Implement every approved drafting recommendation while preserving legal drafting contracts.
**Architecture:** Extend the existing workspace with a save barrier and revision-bound generation runs; refactor UI in focused components, retaining the existing renderer and review viewer. Move hub results behind a bounded server contract.
**Tech Stack:** Next.js, React, TypeScript, Supabase/Postgres, Vitest.
**Spec:** docs/superpowers/specs/2026-09-11-drafting-ux-design.md

## Global Constraints
- Keep Design → Generate → Review, canonical drafting engine, attorney/admin access, immutable document provenance, and existing sharing safeguards.
- No production migration, deployment, or client communication during implementation.
- All work is in /private/tmp/cornerstone-drafting-ux. Preserve other agents' edits. No nested subagents.

## Task 1: Review and version workflow
Own ReviewStep.tsx, review helper/components/tests, DocxViewerPanel.tsx, document review PATCH, convert-pdf route, document version review metadata where needed. Implement deliberate active-version review (conversion does not review), server missing-field eligibility aligned UI, selected batch conversion, next-unreviewed, document sidebar beside viewer, optional assistant, secondary action menu, current/history grouping and authenticated comparison. Test review/version races, batch failures and grouping. Do not alter GenerateStep or design files. Deliver a scoped diff/report.

## Task 2: Save and generation reliability
Own DraftingWorkspace.tsx, useDesignSheetState.ts, GenerateStep.tsx, preflight and draft routes, run persistence helper/migration/tests. Implement async flush-and-save barrier, snapshot verification, persisted idempotent run claims, actual per-file status and partial retries with no duplicate saves. Recover status on remount. Test dirty/in-flight/failure saves and run concurrency/partial persistence. Keep download-only mode explicit.

## Task 3: Design and Generate layout
Own DesignSheetPage.tsx and focused components; complete GenerateStep layout following Task 2. Add container-width-driven clause drawer, next unresolved decision and person/document issue grouping, collapse technical source sections, preserve selections across fix round-trips and durable result summary. Test keyboard navigation and narrow/desktop layouts.

## Task 4: Hub server contract
Own drafting/page.tsx, DraftingHubClient.tsx, lib/queries/drafting.ts hub-list reads, hub helpers and tests, additive migration if warranted. Preserve recent saved-view work. Bound browser response, search/filter/sort/page server-side with globally accurate counts and practice-area counts, stable ties and URL state. Test multiple pages, empty page recovery and saved views.

## Task 5: Integration, metrics and release verification
Integrate components, add metrics derived from generation runs and review events with no private content, verify focused tests then lint/typecheck/full suite, inspect rendered synthetic fixtures. Review complete diff independently, correct findings, record required migration/release steps and limitations. Do not deploy.

## Progress
- [x] Task 1
- [x] Task 2
- [x] Task 3
- [x] Task 4
- [x] Task 5

Ruling: approval in the conversation covers the full design; do not repeat permission gates. Existing unrelated changes are protected by an isolated worktree. Separate implementer ownership permits parent integration work alongside one dispatched implementation task.

Delivery evidence: `docs/superpowers/2026-09-11-drafting-ux-verification.md`. Full suite: 5,356 passed / 2 skipped; typecheck passed; lint zero errors. Local PostgreSQL and rendered synthetic UI checks passed.
