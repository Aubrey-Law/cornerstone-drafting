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
| Client Information | [client-information.md](./client-information.md) | Yes — `client`, `spouse`, `marriage` |
| Last Will and Testament | [family-information.md](./family-information.md) | Yes — `will.title`; also documents `children`, `family`, `trust.disinherited`, which are collected elsewhere |
| Contacts & Fiduciaries | [contacts-fiduciaries.md](./contacts-fiduciaries.md) | Partial — contact resolution for slots |
| Fiduciary Role Assignment | [fiduciaries.md](./fiduciaries.md) | Yes — `fiduciaries.*`, `guardians.*` |
| Estate Plan Design | [estate-plan-design.md](./estate-plan-design.md) | Yes — `planning.*`, `execution.*`, package selection |
| Trust Details | [trust-details.md](./trust-details.md) | Yes — `trust.*` |
| Will Details | [will-details.md](./will-details.md) | Yes — `will.*`, `pour_over.*`, `testamentary_trust.*` |
| Financial Power of Attorney | [financial-poa.md](./financial-poa.md) | Yes — `dpoa.*`, `fiduciaries.agent.*` |
| Health Care & Directives | [healthcare-directives.md](./healthcare-directives.md) | Yes — `healthcare.*`, `hipaa.*` |
| Asset Schedules | [asset-schedules.md](./asset-schedules.md) | Yes — `assets.items[]`, `assets.real_property`, `funding_plan.*` |
| Transfers & Assignments | [transfers-assignments.md](./transfers-assignments.md) | Yes — separate real-estate transfer renderer |
| Attorney Notes | [attorney-notes.md](./attorney-notes.md) | Partial — `drafting_notes` only |
| College Preparation Plan | [college-prep-plan.md](./college-prep-plan.md) | Yes — `ferpa.*`; seeds `dpoa_provisions` / `healthcare_provisions`; selects `incapacity-documents` + `ferpa-release` |

**Section names have drifted from file names.** The nav shows *groups*
(`DESIGN_SHEET_GROUP_IDS` in `designSectionCatalog.tsx`), and a group's title is not
always the guide's file name — "Last Will and Testament" is the `family` group, and
`FamilySection.tsx` renders one question. Where a guide's data is collected in a
different section, the guide says so at the top.

Signing and execution mechanics have **no guide of their own** — they live on the
Review step (`SigningMechanicsSection.tsx`) and are documented in
[estate-plan-design.md](./estate-plan-design.md).

The College Preparation Plan is a second plan track rather than another section
of the estate plan: `decisions.plan_track === 'college_prep'` replaces the
section list above with a student-sized one. See its guide for the full mapping.

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

## Decision namespaces

Everything that is not a column lives in one of these, under `design_sheets.decisions`.
Each is registered in `DECISION_ONLY_TOP_LEVEL_KEYS` (`lib/designSheetPersistence.ts`)
so `inflateDesignSheetRow` does not mirror it onto the sheet's top level, where a stale
mirror would overwrite newer writes on save.

| Namespace | Keys | Guide |
| --- | --- | --- |
| `trust_details` | 58 | [trust-details.md](./trust-details.md) |
| `healthcare_provisions` | 50 | [healthcare-directives.md](./healthcare-directives.md) |
| `dpoa_provisions` | 30 | [financial-poa.md](./financial-poa.md) |
| `execution_mechanics` | 14 | [estate-plan-design.md](./estate-plan-design.md) |
| `settlor_facts` | 7 | [client-information.md](./client-information.md) |
| `will_pr_powers` | 3 | [will-details.md](./will-details.md) |
| `will_provisions` | 2 | [will-details.md](./will-details.md) |
| `estate_plan_design` | 13 + 17 ancillary flags | [estate-plan-design.md](./estate-plan-design.md) |

`lib/designSheetImport/decisionFields.ts` registers **173** of these keys for AI
autofill, DOCX import and the printed meeting worksheet. Every key in that registry
must also appear in `listDesignSheetImportFieldNames()` — a test enforces it.

### Adding a field

**To an existing namespace:** interface + `DEFAULT_*` + one reader line in the getter →
a control in the section component → one line in `decisionFields.ts` → one line in the
relevant `compactObject({...})` in `toGeneratorData.ts` → an entry in
`data-dictionary.json` → bind the box in the worksheet template.

**A new namespace** additionally needs registering in `DECISION_ONLY_TOP_LEVEL_KEYS`,
in `DecisionNamespace` / `DECISION_NAMESPACES` and `applyDecisionFieldValues()` (via
`mergeDecisionUpdates`, so it composes with the others), and a
`lib/draftPayload/<name>.ts` reader wired into `DraftPayload` and `assemble.ts`.

**Two setter shapes, and one of them bites.** `setTrustDetails`,
`setExecutionMechanics` and `setSettlorFacts` spread `...raw` first, so an unrecognised
stored key survives. `setDesignSheetDpoaProvisions` and
`setDesignSheetHealthcareProvisions` rebuild from their *getter's* return literal —
**any key the getter omits is dropped on the next write.** Declare new keys in those
two namespaces as required (`boolean`, `X | null`), never `?:`, so a missed default or
getter line is a type error.

**"Undecided" is a real state.** `readBoolean(raw, key, false)` collapses an
unanswered question into `false`. Where the question is a genuine either/or, or a fact
about a person rather than a document opt-in, type the field `T | null` (or
`boolean | null`) with a `null` default and read it through `readAllowedValue`
(`lib/designSheet/decisionReaders.ts`). `compactObject` in `toGeneratorData.ts` keeps
`false` and drops `null`, so all three states reach the template.

**Nothing new blocks drafting.** None of these fields joins
`lib/designSheetReadiness.ts` — they complete the record; they must not stop a matter
generating.

## Interview worksheet coverage

`design-summary-separate` swaps in the firm's reciprocal-trust interview worksheet
(`templates/design-summary-worksheet-separate.docx`) for separate-trust matters. As of
**531 of its check boxes tick from design-sheet data. The 24 still printing blank are
all packaging, letters and presentation** — table of contents, cover page and letter,
invoice, client acknowledgment, consent to dual representation, letter to clinician,
the two "how should this be summarized" option groups, summary of client information,
and summary of fiduciary designations. They describe how a package is assembled, and
the generator produces no such documents.

**Every substantive question on the form binds to design-sheet data.**

Two of them took a widened union to get there, and both were safe because neither
value is ever `switch`ed on exhaustively — only compared with `===`:

| Value | Where it goes | What it did *not* break |
| --- | --- | --- |
| `trust_planning_type: 'not_to_spouse'` | The residuary skips the surviving spouse | Package selection branches only on `disclaimer`, so this falls through to `trust-individual-single` exactly as `outright_to_spouse` does. It changes what the documents say, not which are produced. |
| `AdvanceDirectiveChoice: 'other'` | Custom life-support instructions, with the text in `{party}_advance_directive_other` | The three `hcp_*_advance_*` context flags all go false, which is correct — a template branching on them must fall through to the text. |

Templates still need `{% if %}` branches and clause updates to consume most of the
newer fields. `npm run design:coverage` measures exactly how many: **225 of 544
documented paths reach a document a client signs**, and all 47 `trust.provisions.*`
reach none. See [template-gaps-summary.md § 6](./template-gaps-summary.md) for the
breakdown and why closing it is attorney work rather than a code change.
