# Health Care & Directives

**Section ID:** `healthcare-directives`  
**UI:** `HealthCareDocumentSection`, `HealthCareDesignSection`, `HealthCareFiduciarySections`  
**Visibility:** `document_inclusions.healthcare === true`  
**Source files:** `lib/designSheetHealthcareProvisions.ts`, `lib/draftPayload/assemble.ts`, `lib/designSheetReadiness.ts`

## Design sheet fields

### Columns (legacy + partial)

| Field | Notes |
| --- | --- |
| `hcp_slots`, `spouse_hcp_slots` | Health care agent slots |
| `hcp_anatomical_gift` | Legacy: `all`, `none`, `specified`, `defer` |
| `hcp_anatomical_specified` | Restrictions when legacy `specified` |
| `hipaa_psychotherapy_notes` | `authorize` \| `deny` \| null |

### `decisions.healthcare_provisions` (jsonb) — **preferred source**

| Field | Values |
| --- | --- |
| `client_anatomical_gift` | `yes`, `defer`, `no` |
| `spouse_anatomical_gift` | `yes`, `defer`, `no` |
| `spouse_anatomical_restrictions` | free text |
| `client_advance_directive` | `prolong_life`, `do_not_resuscitate`, `do_not_prolong_life` |
| `spouse_advance_directive` | same enum |
| `hipaa_include_poa` | boolean |
| `hipaa_include_trustees` | boolean |
| `hipaa_list_fiduciaries_by_name` | `by_name` \| `general_language` |
| `client_hipaa_additional_agent_contact_ids` | contact ID array |
| `spouse_hipaa_additional_agent_contact_ids` | contact ID array |

Legacy migration: `anatomicalGiftFromLegacy()` maps column → `client_anatomical_gift`.

## Generator mapping

| Design sheet | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| HCP slots | `fiduciaries.hcp_*` | `healthcare.agent.*`, `healthcare.spouse_agent.*` |
| `hcp_anatomical_gift` (column) | `hcp_provisions.anatomical_gift` | `healthcare.anatomical_gift` |
| `hcp_anatomical_specified` | `hcp_provisions.anatomical_specified` | `healthcare.anatomical_specified` |
| `hipaa_psychotherapy_notes` | `hipaa_provisions.psychotherapy_notes` | `hipaa.psychotherapy_notes` |
| **`healthcare_provisions.*`** | **Not in DraftPayload** | **Not in generator JSON** |

### HCP agent object shape

```json
{
  "healthcare": {
    "agent": {
      "primary": {
        "full_name": "...",
        "relationship": "...",
        "address": "...",
        "phone": ""
      },
      "alternate": { ... }
    },
    "anatomical_gift": "all",
    "anatomical_specified": ""
  }
}
```

## Template placeholders

```text
{{ healthcare.agent.primary.full_name | name }}
{{ healthcare.agent.primary.relationship }}
{{ healthcare.anatomical_gift }}
{{ healthcare.anatomical_specified }}
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

Document flags from estate plan design:

- `planning.include_hcp`, `include_hipaa`, `include_ahd` — all tied to `healthcare` inclusion toggle.

## Package

`incapacity-documents` — `tools/aubreylaw-docgeneration/docs/incapacity-placeholder-map.md`

Clauses: `healthcare.agent_appointment.json`, `hipaa.authorization.json`

## Recent updates & template gaps

| Item | Payload / generator status | Template action |
| --- | --- | --- |
| **Per-party provisions** | Wired: `healthcare.client_*`, `healthcare.spouse_*`, `hipaa.*` | Add clause branches for `hcp_client_advance_*` context flags |
| **Legacy column** | `hcp_anatomical_gift` still populated from `client_anatomical_gift` for backward compat | Existing `hcp_anatomical_all` flags work; prefer new fields for spouse-specific docs |
