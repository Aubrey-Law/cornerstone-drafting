# Financial Power of Attorney

**Section ID:** `financial-poa`  
**UI:** `DpoaDocumentSection`, `DpoaProvisionsSection`, `DpoaFiduciarySections`  
**Visibility:** `document_inclusions.dpoa === true`  
**Source files:** `lib/designSheetDpoaProvisions.ts`, `lib/draftPayload/assemble.ts`

## Design sheet fields

### Columns

| Field | Notes |
| --- | --- |
| `poa_slots`, `spouse_poa_slots` | Agent nominations |
| `poa_same_as_trustee`, `spouse_poa_same_as_trustee` | Copy shortcuts |
| `dpoa_coagent_manner` | `independently`, `jointly`, `majority` |
| `dpoa_include_section_l` | yes/no → Section L self-dealing |
| `dpoa_self_dealing_reviewer`, `dpoa_self_dealing_reviewer_alt` | Reviewer names |

### `decisions.dpoa_provisions` (jsonb)

| Field | Notes |
| --- | --- |
| `include_entity_powers` | Module A: oil/gas/mineral through partnership/LLC powers |
| `include_advanced_trust_gifting` | Module B: amend trust + gifting subsections (c)–(g) |
| `include_extended_personal_care` | Module C: recreation/religious/companionship + pet care |
| `agent_compensation` | `prevailing_professional`, `reasonable`, `none` |
| `coagent_serving` | `jointly`, `separately`, `silent` |
| `allow_gifts` | boolean |
| Trust modification powers | `agent_may_create_trusts`, medicaid trusts, modify joint/sole trusts, etc. |
| Special powers | `allow_delegation`, `prohibit_arbitration`, `power_529_plans`, digital assets, etc. |
| `all_basic_powers` | Grant all statutory categories |
| `basic_powers.*` | 14 MA statutory power categories (`DPOA_BASIC_POWER_KEYS`) |
| `additional_powers`, `specific_businesses`, `additional_limitations` | free text |

## Generator mapping

| Design sheet | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| POA slots | `fiduciaries.dpoa_*` | `fiduciaries.agent.*`, `fiduciaries.spouse_agent.*` |
| `dpoa_coagent_manner` | `dpoa_provisions.coagent_manner` | `fiduciaries.agent.co_agents_action` (`joint`/`majority`/`separate`) |
| Section L / reviewers | `dpoa_provisions.include_section_l`, `self_dealing_reviewer*` | `dpoa.include_section_l`, `dpoa.self_dealing_reviewer*` |
| Module toggles | `dpoa_provisions.include_entity_powers`, `include_advanced_trust_gifting`, `include_extended_personal_care` | `dpoa.include_*` (booleans; default `false`) |
| Full `dpoa_provisions` object | `payload.dpoa_provisions` | **Only subset in generator JSON** |

### What reaches templates today

```json
{
  "dpoa": {
    "coagent_manner": "independently",
    "include_section_l": false,
    "include_entity_powers": false,
    "include_advanced_trust_gifting": false,
    "include_extended_personal_care": false,
    "self_dealing_reviewer": { "full_name": "" },
    "self_dealing_reviewer_alt": { "full_name": "" }
  },
  "fiduciaries": {
    "agent": {
      "primary": { "full_name": "..." },
      "co_primary": { "full_name": "..." },
      "successor": { "full_name": "..." },
      "co_agents_action": "separate",
      "primary_has_spouse": true
    }
  }
}
```

`agent_compensation`, `basic_powers`, gifting powers, and trust-modification flags are in **DraftPayload only** — not in `toEstateGeneratorData()`.

## Template placeholders

```text
{{ fiduciaries.agent.primary.full_name | name }}
{{ fiduciaries.agent.co_primary.full_name | name }}
{{ fiduciaries.agent.successor.full_name | name }}
{{ include_clause("poa.agent_appointment") }}
```

## Conditional logic (current)

| Flag | Trigger | Effect |
| --- | --- | --- |
| `has_co_poa` | co-agent name present | Co-agent appointment language |
| `has_solo_poa` | no co-agent | Single-agent language |
| `co_poa_joint` | manner jointly | Joint action required |
| `co_poa_majority` | manner majority | Majority action |
| `co_poa_separate` | default / independently | Separate action |
| `aif_has_spouse` | agent primary has spouse | Self-dealing limitation variant |
| `has_dpoa_self_dealing_reviewer` | reviewer name set | Section L reviewer paragraph |
| `has_dpoa_self_dealing_reviewer_alt` | alt reviewer set | Alternate reviewer |
| `dpoa.include_entity_powers` | design sheet toggle | Module A: entity/business powers (§3.J–§3.L) |
| `dpoa.include_advanced_trust_gifting` | design sheet toggle | Module B: amend trust + gifting (c)–(g) |
| `dpoa.include_extended_personal_care` | design sheet toggle | Module C: personal care §4.D–§4.F + pet care §5.I |

## Package

`incapacity-documents` (combined with HCP, HIPAA, AHD) — see `tools/aubreylaw-docgeneration/docs/incapacity-placeholder-map.md`.

## Recent updates & template gaps

| Item | Payload / generator status | Template action |
| --- | --- | --- |
| **Basic power toggles** | Wired: `dpoa.basic_powers.*`, `dpoa.all_basic_powers` | Add per-power `{% if dpoa.basic_powers.banking %}` blocks or clause includes |
| **Agent compensation / gifting** | Wired: `dpoa.agent_compensation`, `dpoa.allow_gifts`, `dpoa.trust_powers` | Update POA template statutory grant sections |
| **Coagent serving** | Both `dpoa.coagent_serving` and `dpoa.coagent_manner` in payload | Document which field is authoritative in template authoring |
