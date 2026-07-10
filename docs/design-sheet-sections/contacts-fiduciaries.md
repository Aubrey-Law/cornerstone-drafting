# Contacts & Fiduciaries

**Section ID:** `contacts-fiduciaries`  
**UI:** `app/admin/drafting/[matterId]/design/sections/ContactsFiduciariesSection.tsx`  
**Source files:** `lib/designSheet/fiduciaryDocumentInclusions.ts`, `lib/kinship/relationshipLabels.ts`

## Design sheet fields

| Field | Storage | Notes |
| --- | --- | --- |
| `decisions.fiduciary_document_inclusions` | jsonb | `show_phone`, `show_address`, `show_email`, `show_dob`, `show_relationship` |
| `decisions.contact_profiles[contactId]` | jsonb | Per-contact metadata |
| `contacts` table | matter-scoped | Names, phone, email, address, DOB, relationship |

### Contact profile shape

```typescript
{
  is_fiduciary?: boolean
  is_beneficiary?: boolean
  fiduciary_type?: 'individual' | 'independent_professional' | 'bank_institutional' | 'other_entity'
  beneficiary_type?: 'individual' | 'charity' | 'group'
  relationship_to?: 'client' | 'spouse' | 'joint' | 'other'
  relationship_kind?: RelationshipKind   // NEW: structured kinship
  relationship_custom?: string
  date_of_birth?: string
}
```

## Generator mapping

Contacts are **not** exported as a list to `EstateGeneratorData`. They resolve `contact_id` values in fiduciary slot arrays during `buildFiduciariesFromDesignSheet()` (`lib/draftPayload/helpers.ts`).

Resolved contact fields used today:

| Contact column | Used for |
| --- | --- |
| `first_name`, `middle_name`, `last_name` | Fiduciary `full_name` in slots |
| `address_line1` | HCP agent address (when slot selected) |
| `relationship_label` / `relationship_type` | HCP `relationship` on healthcare agents |

Special slot contact IDs:

- `__design_sheet_client__` → client full name
- `__design_sheet_spouse__` → spouse full name

## Template placeholders

Fiduciary names appear under structured paths, not raw contacts:

```text
{{ fiduciaries.executor.primary.full_name | name }}
{{ fiduciaries.trustee.successor.full_name | name }}
{{ healthcare.agent.primary.relationship }}
```

## Conditional logic (current)

No direct template conditionals on `contact_profiles` or `fiduciary_document_inclusions`. Entity type (`fiduciary_type`) does not branch templates today.

## Recent updates & template gaps

| Item | Payload / generator status | Template action |
| --- | --- | --- |
| **Structured kinship** | Wired via `fiduciary_details.*.relationship` and slot resolution | Use `{{ fiduciaries.*.relationship }}` when `fiduciary_display.show_relationship` |
| **Fiduciary display toggles** | `fiduciary_display.*` + conditional fields on `fiduciaries.*` | Wrap optional lines in `{% if fiduciary_display.show_phone %}` etc. |
| **Fiduciary entity type** | `contact_profiles.fiduciary_type` not yet in generator JSON | Add if institutional appointment language needed |
