# Transfers & Assignments

**Section ID:** `transfers-assignments`  
**UI:** `app/admin/drafting/[matterId]/design/sections/TransfersAssignmentsSection.tsx`  
**Visibility:** `document_inclusions.deed === true`  
**Source files:** `lib/designSheetRealEstateTransfer.ts`, `lib/realEstateTransfer/draftIntegration.ts`, `lib/realEstateTransfer/generate.ts`

## Design sheet fields

| Field | Storage | Notes |
| --- | --- | --- |
| `decisions.real_estate_transfer` | jsonb | Primary workflow state |
| `real_property_transfer` | column | Legacy / summary flag |

### `decisions.real_estate_transfer`

| Property | Notes |
| --- | --- |
| `selectedDocs` | `deed`, `trustees_certificate`, `real_estate_trust` |
| Per-doc form state | Grantor, grantee, trustees, property legal description, parcel ID, consideration, execution date, etc. |

Field definitions: `lib/realEstateTransfer/fields.ts`  
Workflow UI: `lib/realEstateTransfer/RealEstateTransferWorkflow.tsx`

Estate Plan Design can opt into asset transfer docs via `setSelectedAssetTransferDocs()` — must align with `document_inclusions.deed` and `selectedDocs`.

## Generator mapping — separate pipeline

Asset transfer documents **do not** use `toEstateGeneratorData()` or standard estate packages.

```text
deriveDocuments() → documents.include_deed | include_trustees_certificate | include_real_estate_trust
  → generateAssetTransferFilesFromDesignSheet()
  → buildFormStateFromDesignSheet() + buildTemplateFields()
  → renderRealEstateTransferDocx()
```

Draft route: `app/api/admin/matters/[id]/draft/route.ts` merges these files alongside estate generator output.

| Doc type | Template | Output |
| --- | --- | --- |
| `deed` | `tools/aubreylaw-docgeneration/templates/deed.docx` | `deed.docx` |
| `trustees_certificate` | `templates/trustees-certificate.docx` | `trustees-certificate.docx` |
| `real_estate_trust` | `templates/real-estate-trust.docx` (Cornerstone nominee realty trust declaration) | `real-estate-trust.docx` |

Package name for preflight: `real-estate-transfer` (`REAL_ESTATE_TRANSFER_PACKAGE`).

## Template fields

Built by `buildTemplateFields()` from form state — flat key/value merge (not dot-path Jinja context). See `lib/realEstateTransfer/formState.ts` for field names.

Typical fields:

- Grantor / grantee names
- Trust name and date (from design sheet trust fields)
- Trustees list
- Property address, legal description, county
- Prior deed book/page
- Parcel ID, consideration
- Execution date, certificate execution county

Trust name/date pull from design sheet trust columns when form state blank.

## Conditional logic (current)

| Condition | Effect |
| --- | --- |
| `documents.include_deed` | Generate deed if `selectedDocs` contains `deed` |
| `documents.include_trustees_certificate` | Trustee's certificate doc |
| `documents.include_real_estate_trust` | Real estate trust doc |
| EP practice area | `isEP` gate in `deriveDocuments()` |

No Nunjucks context flags — renderer uses simple placeholder substitution on each template.

## UI / payload sync

`selectedAssetTransferDocsFromSheet()` reads `getPersistedRealEstateTransfer(sheet).selectedDocs` for preflight.

`generateAssetTransferFilesFromDesignSheet()` prefers payload document flags but falls back to persisted `selectedDocs` if flags empty.

## Recent updates & template gaps

| Gap | Action needed |
| --- | --- |
| **Realty UX fixes** (Jul 2026) | Re-test deed workflow after lite schema persistence changes |
| **Deed inclusion vs selectedDocs** | Attorneys can enable section without completing form — preflight should list missing transfer fields |
| **Multiple properties** | Workflow may be single-property — confirm templates support only one parcel per generation |
| **Node vs flat merge** | Transfer templates use flat merge, not clause library — keep authoring guide separate from pour-over will patterns |
| **Trustees certificate vs certification of trust** | `trustees_certificate` (c. 184 § 35, realty transfer) is still the starter template; revocable-trust `certificate-of-trust` (c. 203E § 1013) is a separate estate package |
| **Nominee trust (no real property)** | Cornerstone template at `templates/nominee-trust.docx` — not wired to `selectedDocs` yet |
| **Trust funding instructions** | `funding-instructions` = static education. `trust-funding-plan` = personalized recommendations (hybrid; see `trust-funding-plan-placeholder-map.md`). Neither is driven from Transfers & Assignments deed workflow. |

### Authoring note

When updating `deed.docx`, edit placeholders to match `buildTemplateFields()` output keys exactly. Run `tests/designSheetRealEstateTransfer.test.ts` after field renames.
