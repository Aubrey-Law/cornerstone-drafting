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
| `children[]`, `disinherited_children[]` | column | Collected here; documented in the Family Information guide |

### `decisions.settlor_facts` (jsonb)

Facts the interview form asks that no column captures.

| Field | Type |
| --- | --- |
| `street_address_2` | string \| null — apartment, unit or suite |
| `client_gender`, `spouse_gender` | `male` \| `female` \| `nonbinary` \| `other` \| null |
| `place_of_marriage` | string \| null |
| `survivor_designation` | `settlor_1` \| `settlor_2` \| `both` \| null |
| `settlors_live_together` | **boolean \| null** |
| `disabled_veteran` | **boolean \| null** |

The last two are three-state on purpose. "Is the client a disabled veteran?" is a
question about a person, not a document opt-in — a `false` default would print a
ticked "No" on the interview worksheet for every matter nobody has asked yet. Their
controls are three-state selects (blank = not asked), and `compactObject` in
`toGeneratorData.ts` keeps `false` while dropping `null`, so all three states survive
to the template. The worksheet's `tri_yes_no` helper compares against `true` and
`false` explicitly rather than testing truthiness.

`setSettlorFacts` spreads `...raw` first, so a stored key this interface has not heard
of survives a write.

### Marital status vocabulary

`marital_status` is a **shared intake field** — its option list lives in
`packages/estate-fields/src/core/options.ts` (`MARITAL_STATUS_OPTIONS`), which this
repository owns per `packages/estate-fields/SYNC.md`. Values: `single`,
`married`, `divorced`, `widowed`, `separated`, `domestic_partner`, `civil_union`,
`unmarried_partnership`. Two in-repo mirrors of that list must stay in step —
`VALID_CLIENT_INTAKE_MARITAL_STATUSES` in `lib/lawmatics.ts` and the extraction schema
in `lib/intakeImport/leadIntakeImport.ts`.

## Generator mapping

| Design sheet | DraftPayload | EstateGeneratorData |
| --- | --- | --- |
| `client_name` | `client.full_name` | `client.full_name` |
| `client_aka` | `client.aka` | `client.aka` |
| `client_pronouns` | `client.preferred_pronoun` | `client.pronoun_*` |
| `client_dob` | `client.dob` | `client.date_of_birth` (long form) |
| Address fields | `client.address`, `city`, `state`, `zip`, `county` | `client.street_address`, `city`, `state`, `county` |
| `spouse_name` + married | `spouse.full_name`, etc. | `spouse.exists`, `spouse.full_name`, pronouns |
| `client_citizenship`, `spouse_citizenship` | `client.citizenship`, `spouse.citizenship` | same |
| `client_domicile` | `client.domicile` | `client.domicile` |
| `marital_status` | `client.marital_status` | `client.marital_status` |
| `marriage_date` | `marriage.date` | `marriage.date` (long form) |
| `settlor_facts.street_address_2` | `settlor_facts.*` | `client.street_address_2` |
| `settlor_facts.client_gender` / `spouse_gender` | `settlor_facts.*` | `client.gender` / `spouse.gender` |
| `settlor_facts.disabled_veteran` | `settlor_facts.*` | `client.disabled_veteran` |
| `settlor_facts.place_of_marriage` | `settlor_facts.*` | `marriage.place` |
| `settlor_facts.survivor_designation` | `settlor_facts.*` | `marriage.survivor_designation` |
| `settlor_facts.settlors_live_together` | `settlor_facts.*` | `marriage.settlors_live_together` |
| `excluded_guardian_*` | `client.excluded_guardian` | `guardians.excluded[]` (see Will Details) |

The settlor facts are deliberately scattered onto `client`, `spouse` and `marriage` —
roots templates already know — rather than given a root of their own.

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
{{ client.street_address_2 | optional }}
{{ client.marital_status }}
{{ marriage.place | optional }}
{% if client.disabled_veteran == true %}...{% elif client.disabled_veteran == false %}...{% endif %}
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

## Known gaps

| Item | Status |
| --- | --- |
| `client_citizenship` / `client_domicile` | Wired to `client.citizenship` / `client.domicile` |
| Pronoun parsing | Only he/she/ze/they buckets — custom pronouns fall back to they/them |
| Spouse address | Not collected on the design sheet; HCP agent address falls back to the client address |
| Spouse street address line 2 | Only the client has one; the worksheet asks for the address once |
| `packages/estate-fields` sync | This repo owns the package. Option-list changes land here and propagate outward as a version bump — see `SYNC.md`. |
