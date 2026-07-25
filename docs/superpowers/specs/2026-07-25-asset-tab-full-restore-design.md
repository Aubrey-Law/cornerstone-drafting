# Assets Tab Full Restore Design

## Goal

Restore the complete Assets tab presentation shown in the July 24 screenshot. Use the repository implementation immediately before commit `ca006e7` as the authoritative source instead of recreating the layout from the image.

## Scope

Restore the prior Assets tab UI:

- Three-column portfolio summary.
- Asset Allocation and Ownership Split donut charts.
- Total estimated value, net portfolio value, federal estate tax, Massachusetts estate tax, and document-record figures.
- Asset table columns for Asset, Description, Type, Owner, Value, Debt, Net Value, and Files.
- Direct row-level edit and delete buttons.
- The prior primary styling for Add new asset.

Remove UI artifacts introduced only by the newer Assets redesign:

- Exact-value horizontal allocation bars.
- Separate Owned assets and Death benefit summary tiles.
- Inventory provenance line and conservative-estimate notice.
- Conditional Debt and Files columns.
- Row-action kebab menu.

## Preserved Behavior

This is a presentation-only restore. Preserve:

- Asset loading, creation, editing, deletion, and bulk deletion.
- Bulk asset entry.
- Category filtering and selection state.
- Asset-report export.
- Massachusetts estate-tax assistant action.
- Design-sheet synchronization.
- Existing intake linkage and authorization.
- The current full-width matter-page frame and count cleanup.
- All People, Documents, Activity, drafting, and persistence changes from later commits.

No database migration is required.

## Implementation Source

Restore these files to their state at `ca006e7^`:

- `app/admin/matters/[id]/tabs/assets.tsx`
- `components/assets/AssetTable.tsx`

Delete `components/assets/AssetValueBars.tsx` if it has no remaining consumers after the restore.

Replace the current redesign source-contract test with restore coverage that proves:

- `AssetPortfolioSummary` and `AssetDonutChart` are rendered.
- Life insurance remains part of the allocation segments as in the prior implementation.
- The original table columns are present.
- Direct edit and delete actions are present.
- `AssetValueBars`, conditional columns, and the row-action kebab are absent.
- Bulk deletion and the existing asset dialogs remain reachable.

## Verification

Run the focused Assets tests, changed-file ESLint, TypeScript checking, `git diff --check`, and the production build. Compare repository-wide failures against the existing baseline and do not modify unrelated failing tests.
