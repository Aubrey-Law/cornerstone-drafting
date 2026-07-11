# Guided Design Sheet UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Section-by-Section the same acceleration and readiness visibility as Fast Entry while preserving stable legal ordering, and make Contact Picker results fully scrollable and keyboard accessible.

**Architecture:** Keep both modes on the shared section catalog, readiness result, and parent-owned autosave state. Extract reusable acceleration/final-review UI from Fast Entry, add pure Guided navigation helpers, and let `DesignSheetShell` compose those pieces without changing drafting persistence or generators. Fix Contact Picker locally by separating its scrollable listbox from its pinned add action.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Radix UI, Vitest.

## Global Constraints

- Keep the Section-by-Section overview in stable legal/catalog order.
- Keep Fast Entry as the dynamically prioritized completion workspace.
- Both modes must expose the same design choices and consume the same shared state/readiness data.
- Do not modify database schema, drafting payloads, clauses, estate generators, or legal defaults.
- Presets remain limited to the existing versioned allowlist; client elections are never preset.
- Preserve the approved unrelated full-suite baseline failures; use focused tests, TypeScript, lint, and production build as the acceptance gate.

---

### Task 1: Guided Navigation Helpers

**Files:**
- Create: `lib/designSheet/guidedNavigation.ts`
- Create: `tests/design-sheet-guided-navigation.test.ts`

**Interfaces:**
- Consumes: `DesignSectionDef`, `DesignSectionSummary`, and `DesignReadinessBlocker`.
- Produces: `groupGuidedSections(sections, summaries)` and `findNextUnresolvedBlocker(blockers, activeSectionId)`.

- [ ] **Step 1: Write failing grouping and navigation tests**

```ts
import { describe, expect, it } from 'vitest'
import { findNextUnresolvedBlocker, groupGuidedSections } from '@/lib/designSheet/guidedNavigation'

it('keeps catalog order inside guided status groups', () => {
  const sections = [{ id: 'client' }, { id: 'family' }, { id: 'plan' }, { id: 'trust' }]
  const summaries = {
    client: { status: 'complete', detail: null },
    family: { status: 'none', detail: null },
    plan: { status: 'attention', detail: null },
    trust: { status: 'attention', detail: null },
  } as const
  expect(groupGuidedSections(sections, summaries)).toEqual({
    attention: [sections[2], sections[3]],
    remaining: [sections[1]],
    complete: [sections[0]],
  })
})

it('returns the next blocker after the active section and wraps', () => {
  const blockers = [
    { id: 'client:name', sectionId: 'client' },
    { id: 'trust:name', sectionId: 'trust' },
  ] as any
  expect(findNextUnresolvedBlocker(blockers, 'client')?.id).toBe('trust:name')
  expect(findNextUnresolvedBlocker(blockers, 'trust')?.id).toBe('client:name')
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/design-sheet-guided-navigation.test.ts`

Expected: FAIL because `guidedNavigation` does not exist.

- [ ] **Step 3: Implement stable grouping and wrapping navigation**

```ts
import type { DesignReadinessBlocker, DesignSectionSummary } from '@/lib/designSheetReadiness'

export function groupGuidedSections<T extends { id: string }>(
  sections: T[],
  summaries: Record<string, DesignSectionSummary>,
) {
  return sections.reduce((groups, section) => {
    const status = summaries[section.id]?.status ?? 'none'
    if (status === 'attention') groups.attention.push(section)
    else if (status === 'complete') groups.complete.push(section)
    else groups.remaining.push(section)
    return groups
  }, { attention: [] as T[], remaining: [] as T[], complete: [] as T[] })
}

export function findNextUnresolvedBlocker(
  blockers: DesignReadinessBlocker[],
  activeSectionId?: string | null,
) {
  if (blockers.length === 0) return null
  if (!activeSectionId) return blockers[0]
  const activeIndex = blockers.findIndex(item => item.sectionId === activeSectionId)
  return blockers[(activeIndex + 1) % blockers.length]
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/design-sheet-guided-navigation.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/designSheet/guidedNavigation.ts tests/design-sheet-guided-navigation.test.ts
git commit -m "Add guided design sheet navigation helpers"
```

---

### Task 2: Shared Acceleration and Final Review Components

**Files:**
- Create: `components/design-sheet/DesignAccelerationBar.tsx`
- Create: `components/design-sheet/DesignFinalReview.tsx`
- Modify: `app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx`
- Test: `tests/design-sheet-mode-parity.test.ts`

**Interfaces:**
- Consumes: the existing `AttorneyDesignPreset`, preset helpers, copy-forward helpers, `DesignSheetOnChange`, blockers, overrides, pending fiduciaries, and document inclusions.
- Produces: reusable `DesignAccelerationBar` and `DesignFinalReview` components used by both design modes.

- [ ] **Step 1: Write a failing parity/source test**

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

it('uses shared acceleration and final review in Fast Entry', () => {
  const express = readFileSync('app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx', 'utf8')
  for (const component of ['DesignAccelerationBar', 'DesignFinalReview']) {
    expect(express).toContain(`<${component}`)
  }
})
```

- [ ] **Step 2: Run parity test and verify RED**

Run: `npm test -- tests/design-sheet-mode-parity.test.ts`

Expected: FAIL because the shared components do not exist.

- [ ] **Step 3: Extract `DesignAccelerationBar` from Fast Entry**

The component must own preference loading, preset preview dialog, save/apply toasts, and render these props:

```ts
interface DesignAccelerationBarProps {
  sheet: DesignSheet
  updateField: DesignSheetOnChange
  documentInclusions: DesignDocumentInclusions
  nextRequired: DesignReadinessBlocker | null
  onNextRequired: (blocker: DesignReadinessBlocker) => void
  showLayoutControls?: boolean
  showCompleted?: boolean
  expandAll?: boolean
  onShowCompletedChange?: (value: boolean) => void
  onExpandAllChange?: (value: boolean) => void
}
```

Reuse `buildAttorneyPreset`, `previewAttorneyPreset`, `applyAttorneyPreset`, `buildCopyClientToSpousePatch`, and `buildTrusteesToPrimaryRolesPatch`. Apply patches only through `updateField`.

- [ ] **Step 4: Extract `DesignFinalReview` from Fast Entry**

```ts
interface DesignFinalReviewProps {
  sheet: DesignSheet
  selectedDocKeys: DesignDocumentKey[]
  blockerDetails: Array<{ id: string; label: string; blockers: DesignReadinessBlocker[] }>
  pendingFiduciaries: string[]
  readinessComplete: boolean
  onBlockerClick: (blocker: DesignReadinessBlocker) => void
  onGenerate?: () => void
}
```

It must show selected documents, intake overrides, applied preset matches, pending-client choices, blocker pills, and a readiness-gated Generate button.

- [ ] **Step 5: Replace Fast Entry inline implementations**

Render `DesignAccelerationBar` with layout controls enabled and `DesignFinalReview` after section cards. Remove duplicate preference/dialog logic from `ExpressDesignSheet`.

- [ ] **Step 6: Run parity and existing workflow tests**

Run: `npm test -- tests/design-sheet-mode-parity.test.ts tests/design-sheet-fast-entry-workflow.test.ts tests/user-preferences.test.ts`

Expected: all tests pass; Guided parity is added in Task 3.

- [ ] **Step 7: Commit**

```bash
git add components/design-sheet/DesignAccelerationBar.tsx components/design-sheet/DesignFinalReview.tsx 'app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx' tests/design-sheet-mode-parity.test.ts
git commit -m "Share design sheet acceleration and review UI"
```

---

### Task 3: Section-by-Section Navigation and Parity

**Files:**
- Modify: `app/admin/drafting/[matterId]/design/DesignSheetShell.tsx`
- Modify: `app/admin/drafting/[matterId]/design/DesignSectionOverview.tsx`
- Modify: `app/admin/drafting/[matterId]/design/DesignSectionPageView.tsx`
- Test: `tests/design-sheet-guided-navigation.test.ts`
- Test: `tests/design-sheet-mode-parity.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers and Task 2 shared components.
- Produces: stable grouped overview, persistent Next required, primary Next unresolved, and full acceleration/final-review parity.

- [ ] **Step 1: Extend tests for missing counts and completed grouping**

Add assertions that attention items expose blocker counts, completed items remain in original order, and no blocker returns `null`. Extend `tests/design-sheet-mode-parity.test.ts` to require `DesignAccelerationBar` and `DesignFinalReview` in both `ExpressDesignSheet.tsx` and `DesignSheetShell.tsx`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/design-sheet-guided-navigation.test.ts tests/design-sheet-mode-parity.test.ts`

Expected: Guided parity test fails and new helper expectations fail until implemented.

- [ ] **Step 3: Group overview cards without changing catalog order**

Pass grouped arrays from `DesignSheetShell` to `DesignSectionOverview`. Render headings `Needs attention`, `Not started or optional`, and a collapsed `Completed` disclosure. Show `summary.blockers?.length` on attention cards.

- [ ] **Step 4: Add persistent Next required and shared acceleration**

Flatten `blockerDetails` once. Render `DesignAccelerationBar` above both overview and active section content with layout controls disabled. Its navigation callback must call existing `navigateToSection(blocker.sectionId, blocker)`.

- [ ] **Step 5: Make Next unresolved primary on section pages**

Extend `DesignSectionPageViewProps`:

```ts
nextUnresolvedLabel?: string
onNextUnresolved?: () => void
```

When supplied, render `Next unresolved: <label>` as the primary footer button. Keep Previous section, Next section, and All sections as outline/ghost secondary actions.

- [ ] **Step 6: Add Guided final review and compact autosave**

Render `DesignFinalReview` on the overview below grouped cards. Pass `showSave={saveStatus !== 'saved'}` to `DesignToolbarActions`. Keep generation gated by `readinessComplete`.

- [ ] **Step 7: Run Guided, parity, autosave, and readiness tests**

Run: `npm test -- tests/design-sheet-guided-navigation.test.ts tests/design-sheet-mode-parity.test.ts tests/design-sheet-server-props-sync.test.ts tests/design-sheet-draft.test.ts tests/design-sheet-readiness.test.ts`

Expected: all focused tests pass.

- [ ] **Step 8: Commit**

```bash
git add 'app/admin/drafting/[matterId]/design/DesignSheetShell.tsx' 'app/admin/drafting/[matterId]/design/DesignSectionOverview.tsx' 'app/admin/drafting/[matterId]/design/DesignSectionPageView.tsx' tests/design-sheet-guided-navigation.test.ts tests/design-sheet-mode-parity.test.ts
git commit -m "Improve guided design sheet navigation flow"
```

---

### Task 4: Scrollable and Keyboard-Accessible Contact Picker

**Files:**
- Modify: `app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx`
- Create: `tests/contact-picker-source.test.ts`

**Interfaces:**
- Consumes: existing `contacts`, query filtering, selection, add-contact, and outside-click behavior.
- Produces: unlimited filtered results, scrollable listbox, pinned Add action, and keyboard navigation.

- [ ] **Step 1: Write a failing structural regression test**

```ts
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('renders all filtered contacts in a scrollable accessible listbox', () => {
  const source = readFileSync('app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx', 'utf8')
  expect(source).not.toContain('.slice(0, 5)')
  expect(source).toContain('role="listbox"')
  expect(source).toContain('overflow-y-auto')
  expect(source).toContain('max-h-64')
  expect(source).toContain("event.key === 'ArrowDown'")
  expect(source).toContain("event.key === 'Escape'")
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `npm test -- tests/contact-picker-source.test.ts`

Expected: FAIL because the result slice and non-scrollable dropdown remain.

- [ ] **Step 3: Remove truncation and separate results from Add action**

Keep deduplication and query matching, but remove `.slice(0, 5)`. Wrap mapped results in:

```tsx
<div role="listbox" className="max-h-64 overflow-y-auto overscroll-contain py-1">
  {filtered.map(/* option buttons */)}
</div>
```

Keep Add new contact as a sibling after the listbox, outside the scrolling container.

- [ ] **Step 4: Add keyboard state and behavior**

Add `activeIndex` state, reset it when query/results change, and handle input keydown:

```ts
if (event.key === 'ArrowDown') setActiveIndex(index => Math.min(index + 1, filtered.length - 1))
if (event.key === 'ArrowUp') setActiveIndex(index => Math.max(index - 1, 0))
if (event.key === 'Enter' && filtered[activeIndex]) selectContact(filtered[activeIndex])
if (event.key === 'Escape') setShowDropdown(false)
```

Give each option `role="option"`, `aria-selected`, an id, and active styling. Use `scrollIntoView({ block: 'nearest' })` on the active option ref.

- [ ] **Step 5: Run Contact Picker test and focused design tests**

Run: `npm test -- tests/contact-picker-source.test.ts tests/design-sheet-guided-navigation.test.ts tests/design-sheet-mode-parity.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add 'app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx' tests/contact-picker-source.test.ts
git commit -m "Make design contact picker fully scrollable"
```

---

### Task 5: Final Verification and Publish Readiness

**Files:**
- Verify all changed files; no new production behavior.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: review-ready branch with evidence.

- [ ] **Step 1: Run the complete focused suite**

```bash
npm test -- \
  tests/design-sheet-guided-navigation.test.ts \
  tests/design-sheet-mode-parity.test.ts \
  tests/contact-picker-source.test.ts \
  tests/design-sheet-fast-entry-workflow.test.ts \
  tests/user-preferences.test.ts \
  tests/design-sheet-server-props-sync.test.ts \
  tests/design-sheet-draft.test.ts \
  tests/design-sheet-readiness.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run static validation**

```bash
npm run typecheck
npx eslint \
  'app/admin/drafting/[matterId]/design/DesignSheetShell.tsx' \
  'app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx' \
  'app/admin/drafting/[matterId]/design/DesignSectionOverview.tsx' \
  'app/admin/drafting/[matterId]/design/DesignSectionPageView.tsx' \
  'app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx' \
  components/design-sheet/DesignAccelerationBar.tsx \
  components/design-sheet/DesignFinalReview.tsx \
  lib/designSheet/guidedNavigation.ts
git diff --check
```

Expected: exit code 0 with no errors.

- [ ] **Step 3: Run production build**

Run: `npm run build:next`

Expected: webpack compilation, TypeScript, page generation, and trace collection complete successfully.

- [ ] **Step 4: Review drafting boundaries and final diff**

Run: `git diff --name-only origin/main...HEAD` and confirm no schema, payload, clause, or generator files are present.

- [ ] **Step 5: Commit any verification-only corrections**

```bash
git add <only-corrected-files>
git commit -m "Polish guided design sheet UX"
```

Skip this commit when the working tree is already clean.
