# Financial Power of Attorney

**Section ID:** `financial-poa`
**UI:** `DpoaDocumentSection`, `DpoaProvisionsSection`, `DpoaFiduciarySections`
**Visibility:** `document_inclusions.dpoa === true`
**Source files:** `lib/designSheetDpoaProvisions.ts`, `lib/draftPayload/assemble.ts`, `lib/estateGenerator/toGeneratorData.ts`

`decisions.dpoa_provisions` holds **30 keys**; the Durable Power of Attorney section
registers **42** decision fields for import and autofill: 29 of the top-level keys,
plus the 13 `basic_powers.*` sub-keys registered individually in place of the
`basic_powers` record itself.

**Every answer here is shared across the couple.** The generator has one `dpoa` node,
reused by the client and spouse incapacity packages — only `fiduciaries.spouse_agent.*`
differs. There are no `dpoa.client_*` / `dpoa.spouse_*` keys, and the interview
worksheet deliberately prints the same answer under both settlors' POA headings.

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
| `include_notice_page` | Prepend the statutory notice to principal and agent |
| `preserve_existing_bank_powers` | Keep institution-specific forms already on file in force |
| `effective` | `springing` \| `immediate` \| `null` |
| `authority_after_capacity_regained` | `continue` \| `suspend` \| `null` |
| `incapacity_determination` | `default` \| `custom` \| `null` |
| `acceptance_of_appointment` | `include` \| `omit` \| `null` |
| `agent_compensation` | `prevailing_professional`, `reasonable`, `none` |
| `coagent_serving` | `jointly`, `separately`, `silent` |
| `allow_gifts` | boolean |
| `include_trust_powers` + trust modification powers | `agent_may_create_trusts`, `agent_may_create_trusts_for_dependents`, `allow_agent_as_trustee`, `agent_may_create_medicaid_trusts`, `agent_may_modify_sole_settlor_trusts`, `agent_may_modify_joint_trusts` (6, `DPOA_TRUST_POWER_KEYS`) |
| Special powers | `allow_delegation`, `prohibit_arbitration`, `power_529_plans`, `allow_medical_information_access`, `power_digital_assets`, `allow_self_designation_beneficiary` |
| `all_basic_powers` | Grant all statutory categories |
| `basic_powers.*` | **13** MA statutory power categories (`DPOA_BASIC_POWER_KEYS`) |
| `additional_powers`, `specific_businesses`, `additional_limitations` | free text |

The four nullable choice fields (`effective`, `authority_after_capacity_regained`,
`incapacity_determination`, `acceptance_of_appointment`) default to `null`, not to a
value — "not answered yet" is a distinct state from either answer, and the interview
worksheet prints an unanswered one as two empty boxes.

### A footgun when adding a key here

`setDesignSheetDpoaProvisions` rebuilds `{ ...current, ...patch }` from the **getter's
return literal**, never from the stored blob. Unlike `setTrustDetails`, which spreads
`...raw` first, **any key the getter omits is dropped on the next write of any DPOA
field.** Adding a key means a three-point edit — interface, `DEFAULT_DPOA_PROVISIONS`,
and the getter's return literal — and the key must be declared **required**
(`boolean`, `X | null`), never `?:`, so a missed line is a type error rather than a
value that quietly disappears later.

`setDesignSheetHealthcareProvisions` has the same shape.

## Generator mapping

Unlike `trust_details` — whose payload type extends the namespace interface — DPOA
reaches templates through **four explicit literals with no spreads**:
`lib/draftPayload/types.ts`, `assemble.ts`, `defaults.ts`, and the `dpoa:` block in
`toGeneratorData.ts`. Budget four edits per new key, not one.

| Design sheet | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| POA slots | `fiduciaries.dpoa_*` | `fiduciaries.agent.*`, `fiduciaries.spouse_agent.*` |
| `dpoa_coagent_manner` | `dpoa_provisions.coagent_manner` | `dpoa.coagent_manner`, `fiduciaries.agent.co_agents_action` (`joint`/`majority`/`separate`) |
| Section L / reviewers | `dpoa_provisions.include_section_l`, `self_dealing_reviewer*` | `dpoa.include_section_l`, `dpoa.self_dealing_reviewer*` |
| Module toggles | `include_entity_powers`, `include_advanced_trust_gifting`, `include_extended_personal_care` | `dpoa.include_*` |
| Effectiveness | `effective`, `authority_after_capacity_regained`, `incapacity_determination`, `acceptance_of_appointment` | same names under `dpoa.*` |
| Document options | `include_notice_page`, `preserve_existing_bank_powers` | same names under `dpoa.*` |
| Powers | `agent_compensation`, `allow_gifts`, `all_basic_powers`, `basic_powers`, `include_trust_powers`, `trust_powers`, `special_powers` | same names under `dpoa.*` |
| Free text | `additional_powers`, `specific_businesses`, `additional_limitations` | same names under `dpoa.*` |

### What reaches templates today

The full `dpoa` node — every key listed above. `basic_powers` arrives as a
`Record<string, boolean>` keyed by `DPOA_BASIC_POWER_KEYS`; `trust_powers` and
`special_powers` are similar records.

```json
{
  "dpoa": {
    "coagent_manner": "independently",
    "coagent_serving": "silent",
    "effective": "immediate",
    "authority_after_capacity_regained": "continue",
    "incapacity_determination": "default",
    "acceptance_of_appointment": "include",
    "include_notice_page": true,
    "preserve_existing_bank_powers": false,
    "include_section_l": false,
    "include_entity_powers": false,
    "include_advanced_trust_gifting": false,
    "include_extended_personal_care": false,
    "agent_compensation": "reasonable",
    "allow_gifts": true,
    "all_basic_powers": true,
    "basic_powers": { "real_property": true, "banking": true },
    "include_trust_powers": false,
    "trust_powers": { "agent_may_create_trusts": false },
    "special_powers": { "power_digital_assets": true },
    "additional_powers": "",
    "self_dealing_reviewer": { "full_name": "" },
    "self_dealing_reviewer_alt": { "full_name": "" }
  }
}
```

## Template placeholders

```text
{{ fiduciaries.agent.primary.full_name | name }}
{{ fiduciaries.agent.co_primary.full_name | name }}
{{ fiduciaries.agent.successor.full_name | name }}
{{ dpoa.effective }}
{% if dpoa.basic_powers.banking %}...{% endif %}
{% if dpoa.include_notice_page %}...{% endif %}
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

## Known gaps

| Item | Status |
| --- | --- |
| **Coagent serving vs manner** | Both `dpoa.coagent_serving` (namespace) and `dpoa.coagent_manner` (column) reach templates. The column is what `fiduciaries.agent.co_agents_action` derives from and is the authoritative one for co-agent authority; `coagent_serving` is the interview form's own phrasing. |
| **Conservator nomination** | The interview worksheet's "(Alternate) Conservator of the Estate" line is not captured. Free text would make it the only person in the design sheet not backed by a contact; a real fiduciary role means opening the grid, slot plumbing and payload. |
| **Per-settlor answers** | Not supported and not planned — see the note at the top. |
| **Template consumption** | Most of the `dpoa` node reaches templates but few clauses branch on it. New toggles are available to `{% if %}` blocks that do not exist yet. |
