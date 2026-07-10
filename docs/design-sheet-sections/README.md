# Design Sheet → Document Generator Section Guides

These guides document how each design sheet section feeds the estate document generator. Use them when authoring or updating Word templates, clause JSON, and package definitions in `tools/aubreylaw-docgeneration/`.

## Pipeline

```text
design_sheets (Postgres)
  → buildDraftPayload()          lib/draftPayload/assemble.ts
  → DraftPayload                 lib/draftPayload/types.ts
  → toEstateGeneratorData()      lib/estateGenerator/toGeneratorData.ts
  → EstateGeneratorData JSON
  → deriveEstateGeneratorPackages()
  → Node / Python Nunjucks render  tools/aubreylaw-docgeneration/
```

Asset transfer docs (deed, trustee's certificate, real estate trust) use a **separate** path via `generateAssetTransferFilesFromDesignSheet()` and do not go through the main estate generator packages.

## Section index

| Section | Guide | Feeds generator? |
| --- | --- | --- |
| Intake Review | [intake-review.md](./intake-review.md) | No (read-only snapshot; seeds design sheet) |
| Client Information | [client-information.md](./client-information.md) | Yes — `client`, `spouse`, `execution` |
| Family Information | [family-information.md](./family-information.md) | Yes — `children`, `family`, `trust.disinherited` |
| Contacts & Fiduciaries | [contacts-fiduciaries.md](./contacts-fiduciaries.md) | Partial — contact resolution for slots |
| Fiduciary Role Assignment | [fiduciaries.md](./fiduciaries.md) | Yes — `fiduciaries.*`, `guardians.*` |
| Estate Plan Design | [estate-plan-design.md](./estate-plan-design.md) | Yes — `planning.*`, package selection |
| Trust Details | [trust-details.md](./trust-details.md) | Yes — `trust.*` |
| Will Details | [will-details.md](./will-details.md) | Yes — `will.*`, `pour_over.*`, `testamentary_trust.*` |
| Financial Power of Attorney | [financial-poa.md](./financial-poa.md) | Yes — `dpoa.*`, `fiduciaries.agent.*` |
| Health Care & Directives | [healthcare-directives.md](./healthcare-directives.md) | Yes — `healthcare.*`, `hipaa.*` |
| Asset Schedules | [asset-schedules.md](./asset-schedules.md) | Partial — `assets.real_property` flag only |
| Transfers & Assignments | [transfers-assignments.md](./transfers-assignments.md) | Yes — separate real-estate transfer renderer |
| Attorney Notes | [attorney-notes.md](./attorney-notes.md) | Partial — `drafting_notes` only |

## Template authoring conventions

See also:

- [template-gaps-summary.md](./template-gaps-summary.md) — consolidated gaps across all Cornerstone and legacy templates
- [document-template-guide.md](../../tools/aubreylaw-docgeneration/docs/document-template-guide.md)
- [data-dictionary.json](../../tools/aubreylaw-docgeneration/schemas/data-dictionary.json)
- Per-document placeholder maps in `tools/aubreylaw-docgeneration/docs/*-placeholder-map.md`

### Syntax

```text
{{ client.full_name | name }}
{% if has_spouse %}...{% endif %}
{{ include_clause("will.guardian_nomination") }}
```

### Context flags

Boolean flags are computed in `lib/estateGenerator/node/context.ts` (`buildNodeEstateContext`) and mirrored in Python's `compute_conditions()`. Prefer these named flags over inline data checks in templates.

## Recent cross-cutting updates (Jul 2026)

These design sheet features are now wired through `buildDraftPayload()` and `toEstateGeneratorData()`:

| Feature | Generator paths |
| --- | --- |
| Structured kinship (`relationship_kind`) | `fiduciary_details.*.relationship`, HCP agent relationship |
| Fiduciary document inclusions | `fiduciary_display.*`; optional phone/address/email/DOB/relationship on `fiduciaries.*` |
| Per-party healthcare provisions | `healthcare.client_*`, `healthcare.spouse_*`, context flags `hcp_client_advance_*` |
| HIPAA agent listing | `hipaa.include_poa`, `hipaa.client_additional_agents[]`, etc. |
| Multi excluded guardians | `guardians.excluded[]` with `reason` |
| Asset schedules | `assets.items[]`, `assets.real_property`, `owns_real_property` / `has_assets` flags |
| DPOA provisions matrix | `dpoa.basic_powers`, `dpoa.allow_gifts`, `dpoa.trust_powers`, etc. |
| Attorney goals/concerns | `planning.client_goals`, `planning.client_concerns` |
| Certification / assignment ancillary docs | `certificate-of-trust`, `assignment-of-personal-property` packages from `estate_plan_design.ancillary_documents` |
| Cornerstone realty trust template | `real-estate-trust.docx` via real-estate transfer pipeline (not main packages) |

Templates still need `{% if %}` branches and clause updates to consume the new fields — see each section guide.
