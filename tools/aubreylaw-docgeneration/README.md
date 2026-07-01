# Estate Planning Template Generator

This workspace contains a starter implementation of `al-generator.py`, a Python
tool for generating editable Word estate-planning documents from structured
client data, Word templates, reusable clauses, and state-specific overrides.

## Quick Start

```bash
python3 al-generator.py validate --data examples/client.json --template templates/will.docx
python3 al-generator.py report --data examples/client.json --package core-estate --state MA
python3 al-generator.py generate --data examples/client.json --package core-estate --state MA --out output
python3 al-generator.py generate --data examples/client-ma-incapacity.json --package incapacity-documents --state MA --out output/ma-incapacity
python3 al-generator.py generate --data examples/client-ma-trust-individual-single.json --package trust-individual-single --state MA --out output/ma-trust-individual-single
python3 al-generator.py generate --data examples/client-ma-joint-trust.json --package joint-trust --state MA --out output/ma-joint-trust
python3 al-generator.py generate --data examples/client-ma-joint-trust-simplified.json --package joint-trust-simplified --state MA --out output/ma-joint-trust-simplified
python3 al-generator.py generate --data examples/client-ma-incapacity-unscheduled.json --package incapacity-documents --state MA --out output/ma-incapacity-unscheduled
```

Generated files are written to `output/`, along with `generation-report.json`.

Generated documents are post-processed to use Garamond 12 pt body text and
Garamond 10 pt footer text.

## Template Syntax

Placeholders:

```text
{{ client.full_name }}
{{ fiduciaries.executor.primary.full_name }}
```

Conditionals:

```text
{% if has_spouse %}
Spouse: {{ spouse.full_name }}
{% endif %}
```

Loops:

```text
{% for child in children %}
{{ child.full_name }}
{% endfor %}
```

Clause includes:

```text
{{ include_clause("will.guardian_nomination") }}
{{ include_clause("execution.self_proving_affidavit", state.code) }}
```

## Important Legal Review Note

The included clauses are implementation samples, not legal advice and not
production-ready legal drafting. State-specific clauses and final document text
must be reviewed and approved by a qualified attorney before client use.
