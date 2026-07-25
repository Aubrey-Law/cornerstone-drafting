# Matter Layout and Count Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the full available matter-detail content width and remove all Overview/tab navigation counts.

**Architecture:** Keep the change within `MatterDetailClient` and its source-contract tests. Remove the fixed frame cap and count-strip rendering while leaving collection loading and each collection workspace intact.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest, ESLint.

## Global Constraints

- Preserve existing admin-content padding and shared left/right frame edges.
- Remove the complete Overview count strip: People, Assets, Documents, and Tasks.
- Render People, Assets, and Documents as plain tab labels.
- Preserve operational counts inside collection workspaces.
- Do not modify persistence, authorization, drafting navigation, document-sharing behavior, or unrelated lead/softphone code.

---

### Task 1: Matter frame and navigation cleanup

**Files:**
- Modify: `tests/matter-overview-frame.test.ts`
- Modify: `tests/matter-overview-hierarchy.test.ts`
- Modify: `app/admin/matters/[id]/MatterDetailClient.tsx`
- Delete if unused: `app/admin/matters/[id]/MatterOverviewSummaryCards.tsx`

**Interfaces:**
- Consumes: `MatterDetailClient`’s existing `contacts`, `documents`, `initialEstateSnapshot`, and tab routing.
- Produces: the same matter-detail behavior with a full-width frame, plain collection-tab labels, and no Overview count-strip render.

- [ ] **Step 1: Write failing source-contract tests**

Update the frame test to require the absence of `max-w-[1280px]` and require the shared frame to retain `w-full`.

Update the hierarchy test so it asserts:

```ts
expect(client).toContain('<TabsTrigger value="people">People</TabsTrigger>')
expect(client).toContain('<TabsTrigger value="assets">Assets</TabsTrigger>')
expect(client).toContain('<TabsTrigger value="documents">Documents</TabsTrigger>')
expect(client).not.toContain('<MatterOverviewSummaryCards')
expect(client).not.toContain('peopleCount={contacts.length}')
```

Keep assertions proving `MatterPeopleTab`, `MatterAssetsTabContent`, and `MatterDocumentsTab` remain mounted.

- [ ] **Step 2: Run tests and verify the intended failure**

Run:

```bash
npx vitest run tests/matter-overview-frame.test.ts tests/matter-overview-hierarchy.test.ts
```

Expected: FAIL because the 1280px cap, numbered tab labels, and Overview count strip are still present.

- [ ] **Step 3: Implement the minimal presentation change**

In `MatterDetailClient.tsx`:

```tsx
<div className="w-full">
```

Use that full-width frame consistently where the header, timeline, and tabs currently use `max-w-[1280px]`.

Replace the collection triggers with:

```tsx
<TabsTrigger value="people">People</TabsTrigger>
<TabsTrigger value="assets">Assets</TabsTrigger>
<TabsTrigger value="documents">Documents</TabsTrigger>
```

Remove the `MatterOverviewSummaryCards` import and render block. Delete its component file only after confirming no remaining imports with:

```bash
rg -n "MatterOverviewSummaryCards" app components tests
```

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
npx vitest run tests/matter-overview-frame.test.ts tests/matter-overview-hierarchy.test.ts tests/matter-documents-tab.test.ts tests/matter-people-redesign.test.ts tests/matter-assets-redesign.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run scoped static verification**

Run:

```bash
npx eslint 'app/admin/matters/[id]/MatterDetailClient.tsx' tests/matter-overview-frame.test.ts tests/matter-overview-hierarchy.test.ts
npx tsc --noEmit --pretty false
git diff --check
npm run build:next
```

Expected: changed-file lint and production build pass; TypeScript may report only documented baseline test-fixture failures.

- [ ] **Step 6: Commit**

```bash
git add 'app/admin/matters/[id]/MatterDetailClient.tsx' \
  tests/matter-overview-frame.test.ts \
  tests/matter-overview-hierarchy.test.ts \
  app/admin/matters/[id]/MatterOverviewSummaryCards.tsx
git commit -m "fix: use full-width matter workspace"
```
