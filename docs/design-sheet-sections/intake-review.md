# Intake Review

**Section ID:** `intake-review`  
**UI:** `app/admin/drafting/[matterId]/design/sections/IntakeSection.tsx`  
**Visibility:** Only when an intake snapshot exists on the matter.

## Purpose

Read-only mirror of the client questionnaire. Does **not** feed the document generator directly. Attorney edits in downstream design sheet sections are the generation source of truth.

## Data source

- `IntakeSnapshot` from `lib/queries.ts` (matter-linked `client_intake` row)
- Resync: `POST /api/admin/matters/[id]/design-sheet/resync-intake` and `ensureDesignSheetSeededFromIntake`

## Seeding into design sheet

On first open or resync, intake values populate design sheet columns via `lib/designSheet/seedFromIntake.ts` and `packages/estate-fields/src/core/registry.ts` (`SHARED_FIELD_REGISTRY`).

| Intake area | Seeded design sheet fields |
| --- | --- |
| Personal | `client_name`, `client_dob`, `client_phone`, `client_email`, address, `marital_status`, spouse fields |
| Children | `children[]` |
| Goals | `goals_notes`, `concerns` |
| Fiduciaries | Slot arrays (`executor_slots`, `hcp_slots`, etc.) and legacy text columns |
| Assets | `assets[]` (with `from_intake: true`) |
| Excluded guardian | `excluded_guardian_flag`, `excluded_guardian_name` |

## Generator impact

None at render time. If intake is resynced after attorney edits, `overrides` on the design sheet track which seeded fields the attorney changed.

## Template gaps

- No template placeholders — this section is informational only.
- After **intake ↔ design sheet alignment** (PR #55, Jul 2026), verify seed mappings when adding new intake questions; register keys in `estate-fields` before expecting generator coverage.
