# Attorney Notes

**Section ID:** `attorney-notes`  
**UI:** `app/admin/drafting/[matterId]/design/sections/GoalsSection.tsx`  
**Source files:** `lib/draftPayload/assemble.ts`, `lib/estateGenerator/toGeneratorData.ts`

## Design sheet fields

| Field | Storage | Notes |
| --- | --- | --- |
| `concerns` | column | Client concerns (from intake, editable) |
| `goals_notes` | column | Client goals (from intake, editable) |
| `drafting_notes` | column | Attorney drafting notes; importable |
| Attorney notes textarea | UI only in some builds | May not persist — use `drafting_notes` |

Related matter-level fields (not on design sheet):

| Field | Table | Notes |
| --- | --- | --- |
| `ep_special_provisions` | `matter_details` | Special provisions text |
| `internal_notes` | `matter_details` | Staff internal notes |

## Generator mapping

| Source | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| `ep_special_provisions` | `special_provisions` | — |
| `internal_notes` | `notes` | — |
| First non-empty of above | — | `drafting_notes` |

```typescript
drafting_notes: firstText(payload.special_provisions, payload.notes)
```

`goals_notes` and `concerns` are **not** in `DraftPayload` or generator JSON.

## Template placeholders

Estate plan summary package may reference planning notes — see `tools/aubreylaw-docgeneration/docs/design-summary-placeholder-map.md`.

No standard clause includes client goals/concerns in executed wills or trusts.

```text
{{ drafting_notes }}   {# if exposed in summary template #}
```

## Conditional logic (current)

None. Notes do not drive `{% if %}` branches in core estate documents.

## Packages

- `estate-plan-summary` — may display internal planning context for attorney review
- Client-facing documents — goals/concerns typically excluded

## Recent updates & template gaps

| Gap | Action needed |
| --- | --- |
| **`goals_notes` / `concerns` not in generator** | Add to `estate-plan-summary` data if client-facing summary should quote goals |
| **UI-only attorney notes** | Consolidate on `drafting_notes` column for persistence |
| **Import** | `DESIGN_SHEET_IMPORT_FIELDS` includes `drafting_notes` — verify import → generator path for summary doc |
| **AI chat context** | Admin chat reads goals/concerns for Q&A — separate from document generation |

### If templates need client goals

```typescript
planning: {
  client_goals: payload.goals_notes,
  client_concerns: payload.concerns,
}
```

Use only in non-executed summary or cover letter templates, not in recorded instruments.
