# Assets Tab Full Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the complete pre-`ca006e7` Assets tab presentation shown in the supplied screenshot without reverting asset behavior or other matter-page redesign work.

**Architecture:** Treat `ca006e7^` as the authoritative UI source for the Assets summary and table only. Restore the two presentation components, remove the now-unused horizontal-bar component, and replace the redesign contract test with a restore contract that protects both the old visual structure and current operational handlers.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest, ESLint.

## Global Constraints

- Preserve asset loading, creation, editing, deletion, bulk deletion, export, tax analysis, and design-sheet synchronization.
- Preserve intake linkage, authorization, and persistence.
- Preserve the current full-width matter frame and count cleanup.
- Do not modify People, Documents, Activity, drafting, or database code.
- No database migration is required.

---

### Task 1: Restore the prior Assets presentation

**Files:**
- Modify: `app/admin/matters/[id]/tabs/assets.tsx`
- Modify: `components/assets/AssetTable.tsx`
- Delete: `components/assets/AssetValueBars.tsx`
- Delete: `tests/matter-assets-redesign.test.ts`
- Create: `tests/matter-assets-restore.test.ts`

**Interfaces:**
- Consumes: the existing `useMatterAssets`, `AssetPortfolioSummary`, `AssetDonutChart`, `AssetTable`, `AssetFormDialog`, and `BulkAssetsDialog` interfaces.
- Produces: the same `MatterAssetsTab` export and `AssetTable` props with the prior screenshot presentation.

- [ ] **Step 1: Write the failing restore contract**

Create `tests/matter-assets-restore.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('matter assets prior design restore', () => {
  it('renders the portfolio summary and donut charts from the prior design', () => {
    const assets = read('app/admin/matters/[id]/tabs/assets.tsx')
    expect(assets).toContain('AssetPortfolioSummary')
    expect(assets).toContain('AssetDonutChart')
    expect(assets).not.toContain('AssetValueBars')
    expect(assets).not.toContain("filter(cat => cat.key !== 'life_insurance')")
  })

  it('restores the complete table and direct row actions', () => {
    const table = read('components/assets/AssetTable.tsx')
    expect(table).toContain('<th className="px-4 py-3">Type</th>')
    expect(table).toContain('>Debt</th>')
    expect(table).toContain('>Files</th>')
    expect(table).toContain('aria-label="Edit asset"')
    expect(table).toContain('aria-label="Delete asset"')
    expect(table).not.toContain('MoreHorizontal')
  })

  it('preserves bulk operations, editing, export, and design-sheet sync', () => {
    const assets = read('app/admin/matters/[id]/tabs/assets.tsx')
    expect(assets).toContain('deleteAssets')
    expect(assets).toContain('BulkAssetsDialog')
    expect(assets).toContain('AssetFormDialog')
    expect(assets).toContain('exportReport')
    expect(assets).toContain('handleSyncDesignSheet')
  })
})
```

Delete `tests/matter-assets-redesign.test.ts` so contradictory redesign expectations no longer remain.

- [ ] **Step 2: Run the restore contract and verify RED**

Run:

```bash
npx vitest run tests/matter-assets-restore.test.ts
```

Expected: the first two tests fail because the current source still uses `AssetValueBars`, conditional columns, and a row-action kebab. The behavior-preservation test passes.

- [ ] **Step 3: Restore the two UI components**

Restore `app/admin/matters/[id]/tabs/assets.tsx` and `components/assets/AssetTable.tsx` to their exact `ca006e7^` contents. This restores:

```tsx
<div className="grid gap-6 rounded-lg border border-border bg-card p-4 md:grid-cols-3 md:p-6">
  <AssetPortfolioSummary aggregates={aggregates} married={marriedForTax} />
  <AssetDonutChart title="Asset allocation" segments={allocationSegments} />
  <AssetDonutChart title="Ownership split" segments={ownershipSegments} />
</div>
```

and the original table header:

```tsx
<th className="px-4 py-3">Asset</th>
<th className="px-4 py-3">Description</th>
<th className="px-4 py-3">Type</th>
<th className="px-4 py-3">Owner</th>
<th className="px-4 py-3 text-right">Value</th>
<th className="px-4 py-3 text-right">Debt</th>
<th className="px-4 py-3 text-right">Net Value</th>
<th className="px-4 py-3 text-center">Files</th>
```

Delete `components/assets/AssetValueBars.tsx` after confirming it has no remaining consumers:

```bash
rg -n "AssetValueBars" app components tests
```

- [ ] **Step 4: Verify GREEN and focused regressions**

Run:

```bash
npx vitest run tests/matter-assets-restore.test.ts tests/bulk-asset-delete.test.ts tests/matter-overview-frame.test.ts tests/matter-overview-hierarchy.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run static and production verification**

Run:

```bash
npx eslint 'app/admin/matters/[id]/tabs/assets.tsx' components/assets/AssetTable.tsx tests/matter-assets-restore.test.ts
npm run typecheck
git diff --check
npm run build:next
```

Expected: changed-file lint and webpack compilation pass. Report repository-wide TypeScript or test failures only when they are unrelated baseline failures.

- [ ] **Step 6: Commit and push**

```bash
git add 'app/admin/matters/[id]/tabs/assets.tsx' \
  components/assets/AssetTable.tsx \
  components/assets/AssetValueBars.tsx \
  tests/matter-assets-redesign.test.ts \
  tests/matter-assets-restore.test.ts \
  docs/superpowers/plans/2026-07-25-asset-tab-full-restore.md
git commit -m "fix: restore prior matter assets design"
git push
```
