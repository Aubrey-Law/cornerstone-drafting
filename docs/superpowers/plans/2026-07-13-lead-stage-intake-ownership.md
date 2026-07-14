# Lead-Stage Intake Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move primary intake work to lead detail while retaining matter import/update and adding copy/resend intake-link actions.

**Architecture:** Reuse `AdminIntakeSheet` and the existing matter `ImportIntakeDialog` on the lead page through their existing `leadId`, `matterId`, and `clientIntakeId` interfaces. Add only the lead-page orchestration and a small lead intake status/link card; keep existing server actions and matter/drafting boundaries unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library, existing Supabase server actions.

## Global Constraints

- Cornerstone drafting internals remain untouched.
- Existing intake persistence, conversion, and matter-linking contracts remain the source of truth.
- Resend uses the existing `/api/admin/intake/send` behavior and does not create duplicate intake records.

---

### Task 1: Add lead intake workspace and link actions

**Files:**
- Modify: `app/admin/leads/[id]/page.tsx`
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`
- Create or modify: `app/admin/leads/[id]/LeadIntakeCard.tsx`
- Test: `tests/lead-detail-interactions.test.tsx`

**Interfaces:**
- Consume the existing lead row, `AdminIntakeSheet`, `ImportIntakeDialog`, `useAccessToken`, and `/api/admin/intake/send`.
- Produce lead-page actions for fill/edit/import, intake-link copy, resend, and refresh after intake changes.

- [ ] **Step 1: Add failing tests** for lead-page intake controls, copy action, and resend request; assert the existing matter detail still contains import and update controls.
- [ ] **Step 2: Run the focused tests** with `npm test -- --run tests/lead-detail-interactions.test.tsx tests/create-send-intake.test.ts` and confirm the new assertions fail.
- [ ] **Step 3: Add the lead intake card and wire the existing dialogs/actions** without changing server action contracts.
- [ ] **Step 4: Run the focused tests** and confirm they pass.
- [ ] **Step 5: Run the relevant typecheck/lint checks** for changed files and inspect the diff for drafting changes.
- [ ] **Step 6: Commit** with `git add` and `git commit -m "feat: move intake workflow to lead detail"`.
