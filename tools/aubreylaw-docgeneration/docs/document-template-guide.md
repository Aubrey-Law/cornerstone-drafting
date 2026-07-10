# Document Template Authoring Guide

This guide explains how to create, extend, and QA Word document templates for the Aubrey Law estate-planning generator. Use it when converting a firm form into a reusable template, adding a new document to a package, or briefing an AI assistant to draft template content.

For a shorter operational checklist, see [procedure.md](./procedure.md). For document-specific field maps, see the other `*-placeholder-map.md` files in this folder.

---

## How the system works

Document generation combines three layers:

1. **Word templates** (`.docx`) in `templates/` — document structure, article headings, and `include_clause` calls.
2. **Clause library** (`clauses/` and `states/<STATE>/clauses/`) — reusable legal paragraphs with placeholders and conditions.
3. **Packages** (`packages/*.json`) — which templates to generate, required fields, and output filenames.

Client data flows from the design sheet → structured JSON → template renderer (`al-generator.py` or the Node estate generator). The renderer fills placeholders, evaluates conditionals, includes clauses, and post-processes fonts.

---

## Directory layout

```text
tools/aubreylaw-docgeneration/
├── templates/              # Word templates (.docx)
├── clauses/                # Base clause JSON files
├── states/
│   └── MA/clauses/         # State-specific clause overrides
├── packages/               # Package definitions
├── schemas/
│   └── data-dictionary.json
├── examples/               # Sample client JSON for QA
├── docs/                   # Placeholder maps and this guide
└── al-generator.py         # Python generator CLI
```

Optional: place source firm forms in `source-forms/` for reference during intake.

---

## Step-by-step: create a new template

### 1. Intake the source form

- Save the current firm form beside the project (e.g. `source-forms/My_Form.docx`).
- Preserve headings, article order, numbering, and signature blocks before replacing text.
- Note jurisdiction (Massachusetts forms often need state-specific execution language).

### 2. Map placeholders

Replace client-specific text with canonical placeholders. **Check `schemas/data-dictionary.json` first** — reuse existing field paths before inventing new ones.

| Legacy bracket style | Preferred template style |
| --- | --- |
| `[CLIENT]` | `{{ client.full_name \| name }}` |
| `[SPOUSE]` | `{{ spouse.full_name \| name }}` |
| `[TRUST NAME]` | `{{ trust.name \| name }}` |
| `[COUNTY]` | `{{ client.county }}` |
| `[DocDate]` | `{{ execution.display_doc_date }}` |

Use the `name` filter for personal and trust names in rendered output. Use dot-path fields consistently across all documents.

Document your mapping in a new or updated `docs/<document>-placeholder-map.md` file (see existing maps for format).

### 3. Identify conditional logic

Mark branches that depend on client facts or design choices:

```text
{% if has_spouse %}
...
{% endif %}

{% if requires_guardian_clause %}
{{ include_clause("will.guardian_nomination") }}
{% endif %}
```

Prefer named context flags (e.g. `has_spouse`, `has_co_poa`) over inline data checks when available. See [Common context flags](#common-context-flags) below.

**Authoring tip:** Put standalone `{% if %}`, `{% endif %}`, and `{% for %}` tags in their own Word paragraphs. The renderer strips control-only paragraphs to avoid blank lines when a section is omitted.

### 4. Extract reusable text into clauses

Move repeated or complex paragraphs into clause JSON files instead of embedding them in the template.

**Base clause** — `clauses/<id>.json`:

```json
{
  "id": "will.family_declaration",
  "title": "Family Declaration",
  "document_type": "will",
  "jurisdiction": "base",
  "condition": null,
  "required_fields": ["client.full_name"],
  "review_status": "draft",
  "version_date": "2026-07-06",
  "text": "I, {{ client.full_name | name }}, make this declaration..."
}
```

**State override** — `states/MA/clauses/<id>.json` with the same `id` replaces the base clause when generating for that state.

Reference clauses from the template:

```text
{{ include_clause("will.family_declaration") }}
{{ include_clause("execution.self_proving_affidavit", state.code) }}
```

Each clause has a `review_status`:

| Status | Meaning |
| --- | --- |
| `draft` | Internal development only |
| `reviewed` | Attorney review in progress |
| `approved` | OK for production generation |

Draft and reviewed clauses are blocked unless `--allow-draft` is passed.

### 5. Create or update the Word template

Two common approaches:

**A. Edit in Word** — Open or create `.docx` in `templates/`, type placeholders and clause includes directly, save.

**B. Generate programmatically** — Use a script under `scripts/` (see `scripts/generate-simple-will-template.ts`) to produce a deterministic `.docx` with the `docx` npm package.

Either way, the finished file lives at:

```text
tools/aubreylaw-docgeneration/templates/<slug>.docx
```

### 6. Register in a package

Add the document to an existing package or create a new file in `packages/`:

```json
{
  "name": "my-package",
  "description": "Short description of when this package is used.",
  "required_fields": [
    "client.full_name",
    "client.state",
    "client.county"
  ],
  "documents": [
    {
      "id": "my-document",
      "title": "Human-Readable Document Title",
      "template": "templates/my-document.docx",
      "output": "01-my-document.docx"
    }
  ]
}
```

If the package is used by the web app, also register it in `lib/estateGenerator/node/types.ts` (`NodeEstatePackageName`).

### 7. Add example data and QA

Create or extend an example JSON file in `examples/` with realistic test data, then run:

```bash
# Validate a single template
python3 al-generator.py validate --data examples/client.json --template templates/my-document.docx

# Preview generation report (no files written)
python3 al-generator.py report --data examples/client.json --package my-package --state MA

# Generate documents
python3 al-generator.py generate --data examples/client.json --package my-package --state MA --out output/my-package
```

Review `output/my-package/generation-report.json` for:

- Missing required fields
- Clauses skipped or included unexpectedly
- Unresolved `{{ }}` or `{% %}` markers
- Draft clauses used without `--allow-draft`

### 8. Formatting standards

Generated documents are post-processed to use:

- **Garamond 12 pt** — body text
- **Garamond 10 pt** — footer text

Do not rely on theme defaults (Aptos, Times New Roman headings, etc.) — the generator normalizes fonts after rendering.

---

## Template syntax reference

### Placeholders

```text
{{ client.full_name }}
{{ client.full_name | name }}
{{ fiduciaries.executor.primary.full_name | name }}
{{ trust.name | name }}
{{ execution.display_doc_date }}
```

### Conditionals

```text
{% if has_spouse %}
Spouse: {{ spouse.full_name | name }}
{% endif %}

{% if will.no_contest_clause == "include" %}
{{ include_clause("will.no_contest") }}
{% endif %}
```

### Loops

```text
{% for child in children %}
{{ child.full_name | name }}{% if not loop.last %}; {% endif %}
{% endfor %}
```

### Clause includes

```text
{{ include_clause("will.guardian_nomination") }}
{{ include_clause("execution.self_proving_affidavit", state.code) }}
```

---

## Common context flags

These boolean flags are computed from client data and available in templates and clauses:

| Flag | Typical use |
| --- | --- |
| `has_spouse` | Married-client language, spouse companion docs |
| `has_children` | Child/descendant declarations |
| `has_minor_children` | Minor-child references |
| `requires_guardian_clause` | Guardian nomination article |
| `has_specific_gifts` | Specific gifts clause |
| `has_pet_care` | Pet care clause |
| `has_simultaneous_death` | Simultaneous death clause |
| `has_excluded_guardians` | Guardian exclusion paragraph |
| `uses_revocable_trust` | Pour-over / trust incorporation |
| `has_co_poa` / `has_solo_poa` | POA appointment variants |
| `co_poa_joint` / `co_poa_separate` | Co-agent authority language |
| `aif_has_spouse` | Agent self-dealing limitation |
| `hcp_anatomical_all` / `_specified` / `_none` | Anatomical gift elections |
| `hipaa_psychotherapy_authorized` | HIPAA psychotherapy notes |
| `state_requires_self_proving_affidavit` | Self-proving affidavit block |
| `signing_scheduled` | Render actual dates vs. blank signing lines |

---

## Data dictionary

All canonical field paths live in `schemas/data-dictionary.json`. When a firm form needs data not yet represented:

1. Add the field to the data dictionary with type, required status, and description.
2. Wire the field through the design sheet / draft payload if the web app must collect it.
3. Use the new path in templates and clauses.

---

## Legal review note

Templates and clauses in this repository are implementation artifacts. All legal text must be reviewed and approved by a qualified attorney before client use. Keep `review_status` accurate and do not mark clauses `approved` until review is complete.

---

## AI template prompt

Copy the prompt below into an AI assistant when converting a firm form or drafting a new template. Attach or paste the source document text, then fill in the bracketed sections.

---

```markdown
# Prompt: Create an Aubrey Law document template

You are helping build a Word document template for the Aubrey Law estate-planning generator. Follow the project's conventions exactly.

## Task

Convert the attached source form into:

1. A **placeholder map** (markdown table)
2. A **Word template outline** (article structure with placeholders and clause includes)
3. **Clause JSON drafts** for any reusable paragraphs
4. A **package JSON snippet** if this is a new document

## Document details

- **Document name:** [e.g. Pour-Over Will]
- **Template slug:** [e.g. pourover-will]
- **Jurisdiction:** [e.g. Massachusetts / MA]
- **Package:** [existing package name or "new"]
- **Source form:** [filename or pasted text]

## Conventions (required)

### Placeholders
- Use dot-path fields from the shared data dictionary: `{{ client.full_name }}`, `{{ spouse.full_name }}`, `{{ trust.name }}`, etc.
- Apply the `name` filter for personal and trust names in output: `{{ client.full_name | name }}`
- Do NOT invent new field paths without listing them as proposed additions to the data dictionary.
- Map legacy brackets to canonical fields:
  - `[CLIENT]` → `{{ client.full_name | name }}`
  - `[SPOUSE]` → `{{ spouse.full_name | name }}`
  - `[TRUST NAME]` → `{{ trust.name | name }}`

### Conditionals
- Use named context flags when applicable: `has_spouse`, `has_children`, `requires_guardian_clause`, `uses_revocable_trust`, `has_co_poa`, `signing_scheduled`, etc.
- Put standalone `{% if %}`, `{% endif %}`, and `{% for %}` on their own lines/paragraphs.
- Prefer clause-level conditions over large conditional blocks in the template shell.

### Clauses
- Extract reusable paragraphs into clause JSON with this shape:
  - `id` (dot notation, e.g. `will.guardian_nomination`)
  - `title`, `document_type`, `jurisdiction` (`base` or state code)
  - `condition` (null or a context flag name)
  - `required_fields` (array of dot paths)
  - `review_status`: always start as `"draft"`
  - `version_date`: today's date
  - `text`: single string with inline Jinja-style placeholders
- Reference clauses from the template: `{{ include_clause("clause.id") }}`
- State-specific overrides use the same `id` under `states/MA/clauses/`.

### Template shell
- Preserve the source document's article structure and headings.
- Keep the template thin: headings + `include_clause` calls + minimal conditionals.
- Output filename: `templates/[slug].docx`
- Body font target: Garamond 12 pt (applied by generator post-processing).

## Deliverables

### 1. Placeholder map
Markdown table with columns: Source text | Template field | Notes

### 2. Conditional logic map
Markdown table with columns: Condition | Trigger | Affected language

### 3. Template outline
List each article/section in order. For each section show:
- Heading text (with conditionals if optional)
- Placeholders or `include_clause(...)` calls
- Whether the section is conditional

Example:
```
Article I. Family
{{ include_clause("will.family_declaration") }}

{% if requires_guardian_clause %}Article III. Guardian{% endif %}
{% if requires_guardian_clause %}{{ include_clause("will.guardian_nomination") }}{% endif %}
```

### 4. Clause JSON files
Provide full JSON for each new clause. Flag any clause that needs Massachusetts-specific attorney review.

### 5. Package entry (if new document)
```json
{
  "id": "...",
  "title": "...",
  "template": "templates/....docx",
  "output": "NN-slug.docx"
}
```

### 6. Proposed data dictionary additions
List any new field paths with type, required status, and description.

### 7. QA checklist
- Example client scenarios to test (married/unmarried, with/without children, with/without trust, etc.)
- `al-generator.py` commands to run
- What to verify in `generation-report.json`

## Constraints

- Preserve legal meaning from the source form; do not rewrite substantive law without flagging changes.
- Mark all new clause text as `"review_status": "draft"`.
- Do not use document-specific placeholder synonyms when a shared field already exists.
- Call out `[TO BE DETERMINED]` or blank fields in the source — make them conditional or use execution display fields (`execution.display_doc_date`, etc.).

## Source document

[Paste or attach the source form text here]
```

---

## Related files

| Resource | Purpose |
| --- | --- |
| [procedure.md](./procedure.md) | Short build procedure |
| [README.md](../README.md) | Generator CLI quick start |
| [Design sheet section guides](../../../docs/design-sheet-sections/README.md) | Per-section field maps, conditionals, and generator gaps |
| `schemas/data-dictionary.json` | Canonical field paths |
| `docs/*-placeholder-map.md` | Per-document field and logic maps |
| `scripts/generate-*-template.ts` | Programmatic template builders |
| `examples/*.json` | Sample client data for QA |
