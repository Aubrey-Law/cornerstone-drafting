# Health Care & Directives

**Section ID:** `healthcare-directives`
**UI:** `HealthCareDocumentSection`, `HealthCareDesignSection`, `HealthCareFiduciarySections`
**Visibility:** `document_inclusions.healthcare === true`
**Source files:** `lib/designSheetHealthcareProvisions.ts`, `lib/draftPayload/healthcare.ts`, `lib/estateGenerator/toGeneratorData.ts`, `lib/designSheetReadiness.ts`

`decisions.healthcare_provisions` holds **50 keys**; the Health Care Documents section
registers **47** decision fields for import and autofill (the three contact-ID arrays
are resolved from contacts, not imported as values).

**Most of these are per settlor.** `HealthCareDesignSection` renders a
`HealthCareWishesBlock` per party, gated on `spouseDocs`, and the keys follow the
`client_*` / `spouse_*` convention. These are the questions where spouses genuinely
diverge, so a block wired to the wrong party is a real bug — the package test reads
the two halves of the rendered interview worksheet separately to catch it.

## Design sheet fields

### Columns (legacy + partial)

| Field | Notes |
| --- | --- |
| `hcp_slots`, `spouse_hcp_slots` | Health care agent slots |
| `hcp_anatomical_gift` | Legacy: `all`, `none`, `specified`, `defer` |
| `hcp_anatomical_specified` | Restrictions when legacy `specified` |
| `hipaa_psychotherapy_notes` | `authorize` \| `do_not_authorize` \| null. Its control lives in `HealthCareDesignSection`; it previously sat in an unreachable `WillProvisionsSection` scope and could not be answered at all |

### `decisions.healthcare_provisions` (jsonb) — **preferred source**

**Document-level**

| Field | Values |
| --- | --- |
| `include_hcp_notice_page` | boolean |
| `hipaa_include_poa`, `hipaa_include_trustees` | boolean |
| `hipaa_list_fiduciaries_by_name` | `by_name` \| `general_language` |
| `client_hipaa_additional_agent_contact_ids`, `spouse_hipaa_additional_agent_contact_ids`, `hipaa_additional_agent_contact_ids` | contact ID arrays |

**Per settlor** — each exists as `client_*` and `spouse_*`

| Field | Values |
| --- | --- |
| `{party}_anatomical_gift` | `yes`, `defer`, `no` |
| `spouse_anatomical_restrictions` | free text (client uses the legacy column) |
| `{party}_advance_directive` | `prolong_life`, `do_not_resuscitate`, `do_not_prolong_life`, `other` |
| `{party}_advance_directive_other` | free text — the instructions for `other`, meaningless otherwise. **Required whenever the direction is `other`**; see the readiness note below |
| `{party}_leave_instructions_blank` | boolean |
| `{party}_receive_comfort_care` | boolean |
| `{party}_wish_to_die_at_home` | boolean |
| `{party}_decline_autopsy` | boolean |
| `{party}_other_healthcare_wishes` | free text |
| `{party}_agent_effective_immediately` | boolean (otherwise springing) |
| `{party}_include_post_death_authority` | boolean |
| `{party}_agent_limits_while_living` | free text |
| `{party}_agent_limits_after_death` | free text |
| `{party}_coagent_disagreement_resolution` | `omit` \| `majority` \| `unanimous` \| `first_named` \| `null` |
| `{party}_disposition_of_remains` | 6 options, nullable |
| `{party}_funeral_instructions` | free text |
| `{party}_preneed_arrangements` | free text |
| `{party}_other_disposition_instructions` | free text |
| `{party}_preference_for_donations` | boolean |
| `{party}_prohibit_ai_replicas` | boolean |
| `{party}_disposition_agents_same_as_healthcare` | boolean |
| `{party}_include_disposition_agent_acceptance` | boolean |

Legacy migration: `anatomicalGiftFromLegacy()` maps the column → `client_anatomical_gift`,
and `anatomicalGiftToLegacy()` keeps the column populated for backward compatibility.

### A footgun when adding a key here

`setDesignSheetHealthcareProvisions` rebuilds `{ ...current, ...patch }` from the
**getter's return literal**, never from the stored blob — the same shape as
`setDesignSheetDpoaProvisions`. **Any key the getter omits is dropped on the next
write of any health care field.** Declare new keys **required** (not `?:`) so a missed
default or getter line is a type error. All 48 keys are verified to survive a write.

## Generator mapping

| Design sheet | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| HCP slots | `fiduciaries.hcp_*` | `healthcare.agent.*`, `healthcare.spouse_agent.*` |
| `hcp_anatomical_gift` (column) | `hcp_provisions.anatomical_gift` | `healthcare.anatomical_gift` |
| `hcp_anatomical_specified` | `hcp_provisions.anatomical_specified` | `healthcare.anatomical_specified` |
| `hipaa_psychotherapy_notes` | `hipaa_provisions.psychotherapy_notes` | `hipaa.psychotherapy_notes` |
| HIPAA scope + agents | `hipaa_provisions.include_poa`, `include_trustees`, `list_fiduciaries_by_name`, `client_additional_agents[]`, `spouse_additional_agents[]` | `hipaa.*` |
| **`healthcare_provisions.*`** | `payload.healthcare_provisions` | **`healthcare.*` — every per-settlor key above, by the same name** |

`draftPayloadHealthcare()` (`lib/draftPayload/healthcare.ts`) returns the three
records — `healthcare_provisions`, `hcp_provisions`, `hipaa_provisions` — in one call.
Booleans reach the generator as `false` when unset, free text as `''`, and the two
nullable enums as `undefined` (so `compactObject`-style absence, not a fabricated
default).

### Agent object shape

Health care agents go through `fiduciaryPerson()`, so phone / address / email / DOB /
relationship appear when the matching `fiduciary_display.show_*` toggle is on.

```json
{
  "healthcare": {
    "agent": {
      "primary": { "full_name": "...", "relationship": "...", "address": "...", "phone": "" },
      "co_primary": { ... },
      "alternate": { ... },
      "co_alternate": { ... },
      "second_alternate": { ... }
    },
    "spouse_agent": { ... },
    "anatomical_gift": "all",
    "client_advance_directive": "do_not_prolong_life",
    "client_receive_comfort_care": true,
    "client_disposition_of_remains": "cremation",
    "spouse_advance_directive": "prolong_life"
  }
}
```

## Template placeholders

```text
{{ healthcare.agent.primary.full_name | name }}
{{ healthcare.agent.primary.relationship }}
{{ healthcare.anatomical_gift }}
{% if healthcare.client_receive_comfort_care %}...{% endif %}
{{ healthcare.client_funeral_instructions | optional }}
{{ include_clause("healthcare.agent_appointment") }}
{{ include_clause("hipaa.authorization") }}
```

## Conditional logic (current)

| Flag | Trigger | Effect |
| --- | --- | --- |
| `hcp_anatomical_all` | `anatomical_gift === 'all'` | Full anatomical gift language |
| `hcp_anatomical_specified` | `specified` + restrictions text | Limited gift language |
| `hcp_anatomical_none` | `anatomical_gift === 'none'` | No gift language |
| `hipaa_psychotherapy_authorized` | `psychotherapy_notes === 'authorize'` | Psychotherapy notes authorization |
| `hcp_client_advance_*` / `hcp_spouse_advance_*` | per-party advance directive | Life-support branches |
| `hcp_{party}_advance_other` | directive is `other` | The other three flags are all false; the drafted language comes from `healthcare.{party}_advance_directive_other` |

Document flags from estate plan design: `planning.include_hcp`, `include_hipaa`,
`include_ahd` — all tied to the `healthcare` inclusion toggle. The health care
directive's *title* is a separate answer, `planning.healthcare_directive_title`
(6 options, default `state_default`) — see the Estate Plan Design guide.

## Readiness

`healthcare_provisions.{party}_advance_directive` is a drafting blocker, resolved by
a truthiness check. `other` is truthy, so it clears that blocker on its own — and on
its own it says nothing: the three `hcp_{party}_advance_*` flags are all false for it,
and the custom text renders through `| optional`, so an empty one drafts no life-support
language and leaves no `[[ MISSING ]]` marker to catch it.

That makes it the one shape on the sheet where answering a question leaves the document
*less* complete than leaving it blank. `advanceDirectiveMissingCustomText()` in
`lib/designSheetReadiness.ts` therefore blocks on the **text** — not the direction,
which is answered — whenever the direction is `other`. Pinned by
`tests/design-sheet-readiness.test.ts`.

## Package

`incapacity-documents` — `tools/aubreylaw-docgeneration/docs/incapacity-placeholder-map.md`

Clauses: `healthcare.agent_appointment.json`, `hipaa.authorization.json`

## Known gaps

| Item | Status |
| --- | --- |
| **Template consumption** | The whole per-settlor set reaches templates; most of it has no clause branch yet. The interview worksheet prints all of it, the drafted documents consume a subset. |
| **Post-death choices** | Captured in full (disposition of remains, funeral, pre-need, donations preference, AI replicas, disposition-agent acceptance). No template drafts a final-disposition document — `planning.include_final_disposition` is record-only. |
| **`other` directive has no template** | The value and its text reach `healthcare.*`, and `hcp_{party}_advance_other` is available, but no clause branches on it yet — a directive set to `other` drafts none of the three standard directions and no substitute. Readiness now holds drafting until the text is filled in (below), so the answer is at least never silently empty. |
| **Client anatomical restrictions** | Only the spouse has a `spouse_anatomical_restrictions` key; the client's restrictions still come from the `hcp_anatomical_specified` column. |
