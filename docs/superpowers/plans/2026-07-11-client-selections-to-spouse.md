# Client Selections to Spouse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the design-sheet copy action choose the client as every spouse fiduciary primary and copy only the client's backups after it.

**Architecture:** Keep the UI and data model unchanged. Update the pure `buildCopyClientToSpousePatch` helper to construct new spouse slot arrays through one focused slot-transform function, retaining the existing health-care election copy behavior.

**Tech Stack:** TypeScript, Next.js, Vitest

## Global Constraints

- Preserve the existing button and its spouse-document visibility rule.
- Do not modify drafting internals, payload generation, or the data model.
- Preserve backup order and co-fiduciary flags without mutating client slots.

---

### Task 1: Transform Client Fiduciary Lists for the Spouse

**Files:**
- Modify: `tests/design-sheet-fast-entry-workflow.test.ts`
- Modify: `lib/designSheet/fastEntryWorkflow.ts`

**Interfaces:**
- Consumes: `buildCopyClientToSpousePatch(sheet: DesignSheet): Partial<DesignSheet>` and the established synthetic client contact ID `__design_sheet_client__`.
- Produces: spouse fiduciary arrays whose first slot targets `CLIENT_PRIMARY_CONTACT_ID` and whose remaining slots are independent copies of client slots after index zero.

- [x] **Step 1: Write the failing tests**

Replace the existing copy test's slot fixtures and expectations so it asserts that every spouse role begins with `CLIENT_PRIMARY_CONTACT_ID`, omits the client's original primary, retains backups in order with their flags, and leaves source arrays unchanged. Add an empty-list assertion expecting a single client-primary slot.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/design-sheet-fast-entry-workflow.test.ts`

Expected: FAIL because the current helper clones the client primary instead of replacing it with the client.

- [x] **Step 3: Implement the minimal slot transformation**

Define the synthetic client contact ID beside the pure helper. Add a helper that returns a newly created primary slot followed by cloned `slots.slice(1)` backups with normalized order values, and use it for all four spouse slot fields. Leave the existing health-care decisions patch unchanged.

- [x] **Step 4: Run focused verification**

Run: `npx vitest run tests/design-sheet-fast-entry-workflow.test.ts tests/design-sheet-spouse-fiduciaries.test.ts tests/design-sheet-fiduciary-persistence.test.ts`

Expected: all selected tests pass.

- [x] **Step 5: Check formatting and diff scope**

Run: `git diff --check`

Expected: exit code 0 with no output. Review `git diff -- lib/designSheet/fastEntryWorkflow.ts tests/design-sheet-fast-entry-workflow.test.ts` and confirm only the approved helper behavior and tests changed.
