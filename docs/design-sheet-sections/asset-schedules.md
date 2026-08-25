# Asset Schedules

**Section ID:** `asset-schedules`
**UI:** `app/admin/drafting/[matterId]/design/sections/AssetsSection.tsx`
**Visibility:** `document_inclusions.trust === true`
**Source files:** `lib/assets/syncAssetIntakeToDesignSheet.ts`, `lib/draftPayload/assets.ts`, `lib/draftPayload/fundingPlan.ts`, `lib/estateGenerator/toGeneratorData.ts`

Section blocks: **Asset Inventory**, **Schedule A Options**, **Trust Funding Roadmap**.

## Design sheet fields

| Field | Storage | Shape |
| --- | --- | --- |
| `assets[]` | column | `AssetItem` per row |
| `trust_details.asset_schedule_*` | `decisions` | How each settlor's schedule is drafted (see below) |
| `decisions.funding_plan` | `decisions` | Narrative + prioritized checklist for the funding-plan document |

### AssetItem

| Property | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable row id |
| `category` | enum | `real_property`, `financial`, `retirement`, `life_insurance`, `business`, `other` |
| `description` | string | Primary label |
| `institution` | string | Bank/custodian |
| `estimated_value` | number \| null | Optional |
| `notes` | string | Attorney notes |
| `current_owner` | string? | Who owns it today |
| `target_owner` | string? | Who should own it after funding |
| `beneficiary_designation` | string? | For accounts that pass by designation |
| `from_intake` | boolean? | Synced from intake/matter assets; replaced on each sync |

Intake sync: `syncAssetIntakeToDesignSheet`, matter assets tab import.

### Schedule A options (`decisions.trust_details`)

| Field | Values |
| --- | --- |
| `asset_schedule_format` | `table` \| `paragraph` |
| `asset_schedule_signature_block` | boolean — include a signature block on the schedule |
| `asset_schedule_catchall` | boolean — include catch-all "and all other property" language |
| `asset_schedule_non_trust` | boolean — include a schedule of assets deliberately left out of the trust |

These reach templates under `trust.provisions.*` like every other `trust_details` key.

## Generator mapping

`draftPayloadAssets()` → `payload.assets[]` → `EstateGeneratorData.assets`:

```json
{
  "assets": {
    "real_property": true,
    "total_gross_value": "$1,250,000",
    "total_net_value": "$1,250,000",
    "items": [
      {
        "category": "real_property",
        "category_label": "Real Property",
        "description": "12 Oak Street",
        "institution": "",
        "owner": "Joint",
        "target_owner": "Trust",
        "beneficiary_designation": "",
        "estimated_value": "$650,000",
        "gross_value": "$650,000",
        "net_value": "$650,000",
        "notes": "",
        "from_intake": true
      }
    ]
  }
}
```

`assets.real_property` is derived by `draftPayloadHasRealProperty()`, so the
`owns_real_property` context flag reflects the sheet. `has_assets` follows the item
count.

`decisions.funding_plan` → `payload.funding_plan` → `funding_plan.narrative` and
`funding_plan.checklist_items[]`.

## Template placeholders

```text
{% for asset in assets.items %}
  {{ asset.category_label }}: {{ asset.description }} — {{ asset.gross_value }}
  {{ asset.owner | optional }} → {{ asset.target_owner | optional }}
{% endfor %}

{{ assets.total_gross_value }}
{% if owns_real_property %}...{% endif %}
{% if trust.provisions.asset_schedule_catchall %}...{% endif %}

{{ funding_plan.narrative | optional }}
{% for item in funding_plan.checklist_items %}{{ item }}{% endfor %}
```

## Trust funding plan (hybrid)

The firm's **Trust Funding Recommendations** (`trust-funding-plan.docx`) is distinct
from **Funding Instructions** (`funding-instructions_cv1.docx`):

| Document | Generator package | Content |
| --- | --- | --- |
| Funding Instructions | `funding-instructions` | Static education + generic asset-type checklist |
| Trust Funding Plan | `trust-funding-plan` | Client-specific inventory + attorney narrative + prioritized checklist |

Asset inventory rows merge from `assets.items[]`; narrative and checklist merge from
`decisions.funding_plan` (typically AI-assisted, attorney-reviewed). See
`tools/aubreylaw-docgeneration/docs/trust-funding-plan-placeholder-map.md`.

## Related sections

- **Transfers & Assignments** — real property deeds use `decisions.real_estate_transfer`, not `assets[]` directly
- **Estate Plan Design** — `include_asset_spreadsheet` ancillary toggle (`planning.include_asset_spreadsheet`)
- **Trust Details** — the `asset_schedule_*` options above live in `decisions.trust_details`

## Known gaps

| Item | Status |
| --- | --- |
| **Gross vs net value** | `AssetItem` carries one `estimated_value`; `gross_value` and `net_value` are both derived from it, so they are always equal. A real split needs new fields on `AssetItem`. |
| **Schedule A article** | The options are captured and reach templates, but no trust template branches on `asset_schedule_format` yet. |
| **Bulk assets entry** | The matter assets tab can outpace the design sheet — confirm the sync ran before generating. |
