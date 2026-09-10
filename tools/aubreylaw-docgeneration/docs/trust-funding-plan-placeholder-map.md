# Trust Funding Plan Placeholder Map

Source form (firm sample with client-specific narrative):

- `source-forms/transfers/cornerstone/trust-funding-plan_cv1.docx`

Convert:

```bash
cd tools/aubreylaw-docgeneration
.venv/bin/python tools/convert_cornerstone_trust_funding_plan.py
```

Generated template:

- `templates/trust-funding-plan.docx`

Package:

- `packages/trust-funding-plan.json`

## Document siblings

| Document | Purpose | Personalization |
| --- | --- | --- |
| **Funding Instructions** (`funding-instructions`) | Static client education — titling format, asset-type checklist, RMD chart, FAQ | Names + trust titling line only |
| **Trust Funding Plan** (`trust-funding-plan`) | Attorney-specific funding recommendations for this client's balance sheet | Asset inventory + narrative + prioritized checklist |

Do not conflate the two. Funding Instructions ships with every trust plan; Trust Funding Plan is optional (`funding_recommendation` ancillary toggle) and requires attorney review.

## Hybrid template design

| Section | Source | Mechanism |
| --- | --- | --- |
| Title | Design sheet client/spouse names | Jinja `{% if spouse.full_name %}` |
| Disclaimer + caveats | Template boilerplate | Static |
| Asset inventory table | `assets[]` on design sheet | `{%tr for asset in assets['items'] %}` row loop (bracket syntax avoids Jinja dict `.items` collision) |
| TOTAL row | Sum of `estimated_value` | `assets.total_gross_value`, `assets.total_net_value` |
| Recommended Funding Plan narrative | Attorney-reviewed text | `{{ funding_plan.narrative \| safe }}` — typically AI-drafted, stored in `decisions.funding_plan.narrative` |
| Action checklist | Attorney-reviewed rows | `{%tr for item in funding_plan.checklist_items %}` |
| Life-insurance footnote | Template | Static |

## Key placeholders

| Field | Generator path | Notes |
| --- | --- | --- |
| Client/spouse title | `client.full_name`, `spouse.full_name` | Married vs single |
| Asset category label | `asset.category_label` | Mapped from `category` enum |
| Asset description | `asset.description`, `asset.institution` | Institution appended when present |
| Owner | `asset.owner` | **Not on design sheet today** — defaults to `—` until `owner` column added |
| Values | `asset.gross_value`, `asset.net_value` | Both default to `estimated_value` until net/gross split added |
| Narrative block | `funding_plan.narrative` | Plain text with paragraph breaks |
| Checklist | `funding_plan.checklist_items[]` | `{ number, action, trust, priority }` |

## Design sheet mapping

| Design sheet | Generator path |
| --- | --- |
| `assets[]` | `assets.items[]`, `assets.real_property`, totals |
| `estate_plan_design.ancillary_documents.funding_recommendation` | `documents.include_funding_recommendation` → `trust-funding-plan` package |
| `decisions.funding_plan.narrative` (planned) | `funding_plan.narrative` |
| `decisions.funding_plan.checklist_items` (planned) | `funding_plan.checklist_items` |
| `decisions.real_estate_transfer` | Input to AI prompt (not direct merge) |
| `trust.*`, `tax.sensitive_estate` | AI prompt context |

## Generate (manual test)

```bash
python3 al-generator.py generate \
  --data examples/client-ma-trust-funding-plan.json \
  --package trust-funding-plan \
  --state MA \
  --out output/ma-trust-funding-plan
```

## AI prompt stub

`lib/fundingPlan/prompt.ts` — system prompt for Phase 2 matter-assistant or dedicated route. Output persisted to `decisions.funding_plan` before generation.

## Known gaps

| Gap | Notes |
| --- | --- |
| No design-sheet UI for `decisions.funding_plan` | Narrative/checklist empty unless seeded manually or via future AI route |
| Missing `owner`, `gross_value`, `net_value` on `AssetItem` | Inventory table incomplete vs firm spreadsheet |
| Interspousal equalization amounts | Judgment call — belongs in AI narrative, not Jinja |
| Separate trusts subtitle | May need both `trust.display_name` and `trust.spouse_display_name` in checklist trust column |
| Preflight | Should warn when `funding_recommendation` enabled but `funding_plan.narrative` empty |


## Unimplemented narrative proposal

The following prompt was previously stored as an unused runtime stub. It is a proposal only; it does not control the active document generator.

```typescript
/**
 * Prompt stub for AI-assisted trust funding plan narrative (Phase 2).
 *
 * Intended flow: matter assistant or dedicated funding-plan route reads design sheet
 * assets + trust structure, calls completeLlmText with this system prompt, attorney
 * reviews/edits output, persists to `decisions.funding_plan` before generation.
 */

export const TRUST_FUNDING_PLAN_SYSTEM_PROMPT = `You are an estate-planning paralegal drafting a client-facing Trust Funding Recommendations document for a Massachusetts revocable trust plan.

You will receive structured JSON with:
- client and spouse names, trust names, spousal funding type (disclaimer, clayton, outright, etc.)
- assets[] from the design sheet (category, description, institution, estimated_value, notes)
- real_estate_transfer decisions when present
- MA estate tax sensitivity flags

Write narrative sections ONLY (plain text with paragraph breaks, no markdown headers):
1. Real estate — per property: current title posture, recommended deed/retitling, which trust, registry county
2. Brokerage/investment — retitle vs beneficiary designation; flag interspousal equalization when appropriate
3. Bank accounts — joint vs individual CDs/checking; maturity timing for CDs
4. Retirement — NEVER retitle; beneficiary designation guidance (spouse primary, trust contingent with see-through caveat)
5. Life insurance — ownership and beneficiary updates

Rules:
- Use cautious firm language: "we suggest", "consult your CPA/financial advisor", "attorney assistance recommended"
- Do NOT invent account numbers, exact dollar transfer amounts, or basis calculations unless provided in input
- Reference Massachusetts estate tax only when tax.sensitive_estate is true
- Separate trusts: attribute actions to the correct grantor trust by name
- If data is missing, say what the client should confirm rather than guessing

Also return a JSON array checklist_items with fields: number, action, trust, priority (HIGH|MEDIUM|ONGOING).
Output format:
---NARRATIVE---
(narrative text)
---CHECKLIST---
(JSON array only)`

export interface FundingPlanLlmInput {
  client: { full_name: string }
  spouse?: { full_name: string | null } | null
  trust: {
    display_name: string
    spouse_display_name?: string | null
    spousal_funding?: string | null
  }
  assets: {
    items: Array<{
      category: string
      description: string
      institution?: string | null
      estimated_value?: string | null
      notes?: string | null
    }>
  }
  tax?: { sensitive_estate?: boolean }
  real_estate_transfer?: unknown
}

```
