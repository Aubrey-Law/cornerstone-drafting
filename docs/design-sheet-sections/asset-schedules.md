# Asset Schedules

**Section ID:** `asset-schedules`  
**UI:** `app/admin/drafting/[matterId]/design/sections/AssetsSection.tsx`  
**Visibility:** `document_inclusions.trust === true`  
**Source files:** `lib/assets/syncAssetIntakeToDesignSheet.ts`, `lib/estateGenerator/toGeneratorData.ts`

## Design sheet fields

| Field | Storage | Shape |
| --- | --- | --- |
| `assets[]` | column | `AssetItem` per row |

### AssetItem

| Property | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable row id |
| `category` | enum | `real_property`, `financial`, `retirement`, `life_insurance`, `business`, `other` |
| `description` | string | Primary label |
| `institution` | string | Bank/custodian |
| `estimated_value` | number | Optional |
| `notes` | string | Attorney notes |
| `from_intake` | boolean | Synced from intake/matter assets |

Intake sync: `syncAssetIntakeToDesignSheet`, matter assets tab import.

## Generator mapping

**Minimal today.** `buildDraftPayload()` does not include the full `assets[]` array in `DraftPayload`.

`toEstateGeneratorData()` sets:

```typescript
assets: {
  real_property: false,  // hardcoded — not derived from sheet
}
```

Context flag `owns_real_property` in `buildNodeEstateContext()` reads `assets.real_property` — always false unless payload extended.

| Intended use | Current status |
| --- | --- |
| Schedule A / asset schedule attachment | No generator package |
| `owns_real_property` conditional | Not wired to design sheet |
| Estate plan summary asset list | May use separate summary template script |
| Asset spreadsheet ancillary doc | `estate_plan_design.ancillary_documents.include_asset_spreadsheet` — not generator-backed |

## Template placeholders

No canonical placeholders in `data-dictionary.json` for per-asset rows. Legacy Supabase flat merge (`lib/drafting/projectDesignSheet.ts`) may map some asset fields for older templates.

If adding asset schedules to Node generator:

```text
{% for asset in assets.items %}
  {{ asset.category }}: {{ asset.description }} — {{ asset.estimated_value }}
{% endfor %}
```

## Conditional logic (current)

| Flag | Intended trigger | Actual |
| --- | --- | --- |
| `owns_real_property` | any `category === 'real_property'` | Always false |

## Trust funding plan (hybrid)

The firm's **Trust Funding Recommendations** (`trust-funding-plan.docx`) is distinct from **Funding Instructions** (`funding-instructions_cv1.docx`):

| Document | Generator package | Content |
| --- | --- | --- |
| Funding Instructions | `funding-instructions` | Static education + generic asset-type checklist |
| Trust Funding Plan | `trust-funding-plan` | Client-specific inventory + attorney narrative + prioritized checklist |

**Recommended approach:** hybrid template (Phase 1 scaffold in repo). Asset inventory rows merge from `assets[]`; narrative and checklist merge from `decisions.funding_plan` (typically AI-assisted, attorney-reviewed). See `tools/aubreylaw-docgeneration/docs/trust-funding-plan-placeholder-map.md`.

### Data model gaps for full fidelity

| Field on firm spreadsheet | Design sheet today |
| --- | --- |
| Current owner (Joint / Primary / Spouse) | Missing — add to `AssetItem` or derive from intake |
| Gross vs net value | Only `estimated_value` |
| Per-asset funding recommendation | Belongs in `decisions.funding_plan`, not static template |

### Phased rollout

1. **Now:** inventory table + empty narrative/checklist slots; `funding_recommendation` ancillary toggle wires package
2. **Next:** matter-assistant tool or funding-plan route using `lib/fundingPlan/prompt.ts`; persist to `decisions.funding_plan`
3. **Later:** extend `AssetItem` with `owner`, `gross_value`, `net_value`; preflight when narrative missing

## Related sections

- **Transfers & Assignments** — real property deeds use `decisions.real_estate_transfer`, not `assets[]` directly
- **Estate Plan Design** — `include_asset_spreadsheet` ancillary toggle

## Recent updates & template gaps

| Item | Payload / generator status | Template action |
| --- | --- | --- |
| **Full assets array** | Wired: `assets.items[]`, `assets.real_property`, `has_assets` flag | Trust Funding Plan inventory table (`trust-funding-plan` package); Schedule A article still TBD |
| **Bulk assets entry** | Matter assets tab may outpace design sheet | Confirm sync before generation |
