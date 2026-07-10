# Client Information

**Section ID:** `client-information`  
**UI:** `app/admin/drafting/[matterId]/design/sections/PersonalSection.tsx`  
**Source files:** `lib/draftPayload/assemble.ts`, `lib/estateGenerator/toGeneratorData.ts`

## Design sheet fields

| Field | Storage | Notes |
| --- | --- | --- |
| `client_name` | column | Required for generation |
| `client_pronouns` | column | → pronoun_subject/object/possessive |
| `client_dob` | column | Long-form date in generator |
| `client_aka` | column | Attorney-only |
| `client_phone`, `client_email` | column | Formatted phone |
| `marital_status` | column | Drives `spouse` block and `has_spouse` |
| `former_spouse_name`, `deceased_spouse_name` | column | Divorced/widowed UI only |
| `street`, `city`, `state`, `zip`, `county` | column | Address block |
| `client_citizenship`, `client_domicile` | column | Defaults applied on load |
| `spouse_name`, `spouse_pronouns`, `spouse_dob`, etc. | column | When married |
| `marriage_date`, `spouse_aka`, `spouse_citizenship` | column | When married |
| `overrides` | column | Intake override tracking (not in generator) |

## Generator mapping

| Design sheet | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| `client_name` | `client.full_name` | `client.full_name` |
| `client_aka` | `client.aka` | `client.aka` |
| `client_pronouns` | `client.preferred_pronoun` | `client.pronoun_*` |
| `client_dob` | `client.dob` | `client.date_of_birth` (long form) |
| Address fields | `client.address`, `city`, `state`, `zip`, `county` | `client.street_address`, `city`, `state`, `county` |
| `spouse_name` + married | `spouse.full_name`, etc. | `spouse.exists`, `spouse.full_name`, pronouns |
| `excluded_guardian_*` | `client.excluded_guardian` | `guardians.excluded[]` (see Will Details) |

County fallback: `client.county` uses `signing_county` when county blank (`assemble.ts`).

## Template placeholders

```text
{{ client.full_name | name }}
{{ client.aka }}
{{ client.city }}
{{ client.county }}
{{ client.state }}
{{ client.pronoun_subject }}
{{ client.date_of_birth }}
{{ spouse.full_name | name }}   {# when has_spouse #}
```

## Conditional logic (current)

| Condition | Trigger | Used in |
| --- | --- | --- |
| `has_spouse` | `spouse.exists` or spouse name | Will family declaration, pour-over alternate, outright residuary default |
| `signing_scheduled` | execution date/county/notary set | `execution.display_*` blank vs filled |

From `lib/estateGenerator/node/context.ts`:

```text
has_spouse = spouse.exists OR client spouse name present
```

## Packages requiring client fields

Nearly all packages require `client.full_name`, `client.city`, `client.county`, `client.state`. See `tools/aubreylaw-docgeneration/packages/*.json` `required_fields`.

## Recent updates & template gaps

| Gap | Action needed |
| --- | --- |
| `client_citizenship` / `client_domicile` | Not in `EstateGeneratorData` today — add to data dictionary + `toGeneratorData` if templates need them |
| Pronoun parsing | Only he/she/ze/they buckets — custom pronouns fall back to they/them |
| Spouse address | Not collected on design sheet; HCP agent address falls back to client address |
