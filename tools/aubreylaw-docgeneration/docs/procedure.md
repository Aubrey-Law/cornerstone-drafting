# Procedure for Building Estate Planning Templates

## 1. Intake Existing Firm Forms

Place current firm forms beside the project, then convert each document into a
template in `templates/`. Preserve the document structure first. Replace
client-specific text with placeholders only after the form has been reviewed.

Use the shared data dictionary in `schemas/data-dictionary.json` before creating
new placeholder names. Add new fields there when the firm forms require data not
yet represented.

## 2. Identify Placeholders

Mark repeated client and planning data with canonical placeholders:

```text
{{ client.full_name }}
{{ spouse.full_name }}
{{ fiduciaries.executor.primary.full_name }}
```

Prefer one reusable placeholder across all documents instead of creating
document-specific synonyms.

For document output, format personal and trust names with the `name` filter:

```text
{{ client.full_name | name }}
{{ trust.name | name }}
```

## 3. Identify Conditional Logic

Use named conditions for planning branches:

```text
{% if has_spouse %}
...
{% endif %}
```

For clauses, prefer metadata conditions over embedding large conditional blocks
directly inside document templates.

## 4. Move Reusable Drafting Into Clauses

Store reusable text in `clauses/` or `states/<STATE>/clauses/`. A clause should
define its ID, document type, jurisdiction, condition, required fields, review
status, and text.

Base clauses live in `clauses/`. State-specific overrides live in
`states/<STATE>/clauses/` and automatically take priority when the IDs match.

## 5. Review and Approve

Each clause has a `review_status`:

- `draft`
- `reviewed`
- `approved`

The generator blocks draft and reviewed clauses unless `--allow-draft` is used.
Use draft mode only for internal template development.

## 6. Generate and QA

Run:

```bash
python3 al-generator.py report --data examples/client.json --package core-estate --state MA
python3 al-generator.py generate --data examples/client.json --package core-estate --state MA --out output
```

Review `output/generation-report.json` to confirm:

- Required fields were present.
- Expected clauses were included.
- Non-applicable clauses were skipped.
- No unresolved placeholders remain.
- State-specific clauses came from the correct state folder.

Generated documents should use Garamond 12 pt for body text and Garamond 10 pt
for footer text. This is enforced by `al-generator.py` after rendering.
