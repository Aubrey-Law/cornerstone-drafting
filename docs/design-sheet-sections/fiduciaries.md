# Fiduciary Role Assignment

**Section ID:** `fiduciaries`  
**UI:** `app/admin/drafting/[matterId]/design/sections/FiduciariesSection.tsx` with `FiduciaryGrid.tsx`
**Source files:** `lib/draftPayload/helpers.ts` (`buildFiduciariesFromDesignSheet`, `overlayDesignSheetFiduciarySlots`)

## Design sheet fields

### Slot arrays (primary source)

| Role | Client slots | Spouse slots |
| --- | --- | --- |
| Trustee | `trustee_slots` | `spouse_trustee_slots` |
| Executor / PR | `executor_slots` | `spouse_executor_slots` |
| POA | `poa_slots` | `spouse_poa_slots` |
| HCP | `hcp_slots` | `spouse_hcp_slots` |
| Guardian | `guardian_slots` | — |
| Temporary guardian | `temporary_guardian_slots` | — |

Each `FiduciarySlot`: `{ id, contact_id, is_co, order }`. `is_co` marks a co-fiduciary
serving alongside the principal at the same rank.

**`order` is a persisted sort key, not a rank.** Do not read `order === 1` as
"primary". Line of succession is derived by
`principalOrderByPriority(slots, priority)` in
`lib/designSheet/fiduciarySlotOrdering.ts`, where `priority` is a **0-based index into
the named, non-co principals sorted by `order`** — 0 = primary, 1 = successor,
2 = second successor. Empty placeholder slots are skipped: every new sheet seeds an
unnamed principal at order 0, and counting raw `order` made the first real appointee
render as "2nd".

### Shortcut flags

| Field | Effect |
| --- | --- |
| `executor_same_as_trustee` | Copy trustee → executor slots |
| `poa_same_as_trustee` | Copy trustee → POA slots |
| `spouse_executor_same_as_trustee` | Spouse variant |
| `spouse_poa_same_as_trustee` | Spouse variant |

### Legacy text columns (fallback)

`executor_primary`, `executor_co`, `executor_alt1`, `poa_primary`, `hcp_primary`, `guardian_primary`, etc. — used when slot arrays empty (`applyLegacyDesignSheetFiduciaries`).

### Contact detail and display toggles

`buildFiduciaryRoleDetailsFromDesignSheet()` resolves each slot's `contact_id` to a
`DraftPayloadContactDetail` (name, relationship, address, phone, email, DOB), and
`decisions.fiduciary_document_inclusions` decides which of those print.
`fiduciaryPerson()` in `toGeneratorData.ts` merges the two, so every
`fiduciaries.*` / `healthcare.*` / `guardians.*` person object carries the fields the
matching `fiduciary_display.show_*` toggle enables.

| Toggle | Generator |
| --- | --- |
| `show_phone`, `show_address`, `show_email`, `show_dob`, `show_relationship` | `fiduciary_display.*`, and the matching key on each person object |

## Generator mapping

`buildFiduciariesFromDesignSheet()` → `payload.fiduciaries` → `EstateGeneratorData.fiduciaries`:

| Payload key | Generator path |
| --- | --- |
| `pr_primary` | `fiduciaries.executor.primary` |
| `pr_co_primary` | `fiduciaries.executor.co_primary` |
| `pr_successor` | `fiduciaries.executor.successor` |
| `pr_co_successor` | `fiduciaries.executor.co_successor` |
| `pr_second_successor` | `fiduciaries.executor.second_successor` |
| `trustee_initial` | `fiduciaries.trustee.primary` (defaults to client if blank) |
| `trustee_co` | `fiduciaries.trustee.co_primary` |
| `trustee_successor` | `fiduciaries.trustee.successor` |
| `dpoa_primary` / `dpoa_co_agent` | `fiduciaries.agent.primary` / `co_primary` |
| `hcp_primary` / `hcp_successor` | `healthcare.agent.primary` / `alternate` |
| `guardian_*` | `guardians.primary`, `successor`, `second_successor` |
| `temp_guardian_*` | `guardians.temporary`, `temporary_successor`, etc. |
| Spouse variants | `fiduciaries.spouse_executor.*`, `spouse_agent.*`, `healthcare.spouse_agent.*` |

Spouse packages swap client/spouse data via `dataForNodeEstatePackage()` in the Node generator.

## Template placeholders

```text
{{ fiduciaries.executor.primary.full_name | name }}
{{ fiduciaries.executor.co_primary.full_name | name }}
{{ fiduciaries.executor.successor.full_name | name }}
{{ fiduciaries.trustee.primary.full_name | name }}
{{ fiduciaries.trustee.co_trustees_action }}   {# joint | independent | ... #}
{{ fiduciaries.agent.co_agents_action }}       {# joint | majority | separate #}
{{ guardians.primary.full_name | name }}

{# Contact detail, gated on the display toggles #}
{% if fiduciary_display.show_relationship %}{{ fiduciaries.trustee.primary.relationship }}{% endif %}
{% if fiduciary_display.show_phone %}{{ fiduciaries.trustee.primary.phone }}{% endif %}
```

## Conditional logic (current)

| Flag / field | Trigger | Template / clause |
| --- | --- | --- |
| `will.pr_structure == "co_pr"` | design sheet `pr_structure` | `will.executor_appointment.json` branches |
| `will.pr_structure == "spouse_first" and has_spouse` | married + structure | Executor appointment clause |
| Successor PR present | `fiduciaries.executor.successor.full_name` | Vacancy language in template |
| `has_co_poa` | co-agent name set | `poa.agent_appointment.json` |
| `co_poa_joint` / `co_poa_majority` / `co_poa_separate` | `dpoa.coagent_manner` | Co-agent authority |
| `requires_guardian_clause` | minor children | Guardian article |
| `has_excluded_guardians` | excluded list non-empty | Guardian exclusion |
| `trustee_structure == "co_trustees"` | will/trust structure | Testamentary co-trustee |

`conditionalMissingFieldsForPackage()` adds required fields when `pr_structure == 'co_pr'`, guardian clause active, etc.

## Known gaps

| Item | Status |
| --- | --- |
| Slots may live in `decisions.*_slots` on lite schema | `getDesignSlots()` reads both column and decisions — templates unaffected |
| **Structured kinship** | Wired — `relationship_kind` reaches `fiduciary_details.*.relationship` and the HCP agent relationship |
| **Fiduciary display toggles** | Wired — `fiduciary_display.*` plus optional phone/address/email/DOB/relationship on every person object |
| Temporary guardian | Slots supported (primary + co + alternates); `temporary-delegation-parental-powers` uses `guardians.temporary` / `temporary_co` |
| **Conservator** | The interview worksheet's "(Alternate) Conservator of the Estate" line has no slot and no role. Adding one means the grid, slot plumbing and payload — revisit when the grid is next opened. |
| LP practice area | The unified section receives `lpData`; the standard EP generator path remains separate. |
