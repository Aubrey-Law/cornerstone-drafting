# Field Architecture Consistency Design

## Objective

Make the fields that control estate-plan participants, citizenship, pronouns,
marital status, and matter lifecycle consistent across Postgres, Supabase query
types, API validation, UI controls, design-sheet seeding, and document drafting.
Unknown legal facts must remain unknown, and every drafting decision must come
from an explicit owning field rather than an inferred demographic fact.

## Safety boundaries

- Drafting remains the product center; this change extends its inputs and
  preflight protection without importing code from another repository.
- Existing hosted data is never reset or silently rewritten.
- Migrations are additive in this phase. Legacy status columns are deprecated
  in application code but are not dropped until a separate reconciliation has
  confirmed that no consumer or unique value remains.
- Existing boolean citizenship answers remain readable during migration, but a
  false boolean is represented as `non_us_unspecified`, never fabricated as a
  permanent-resident or nonresident-alien answer.
- All draft-payload assembly requires an explicit matter type. Design editing
  may continue while it is unresolved, but no generated artifact may infer
  participant count from marital status.
- Missing pronouns stay missing and flow into the existing missing-field
  preflight instead of receiving gendered defaults.

## Architecture

### Matter participation

`matters.matter_type` is the owner of whether the engagement is for one person
or two. Its allowed stored values are `individual` and `couple`; it is nullable
for pre-existing matters pending attorney confirmation. The matter page edits
this column through a dedicated authenticated admin route. Draft payload
assembly reads it from `matters` and combines it with design-sheet plan
composition:

- `individual` -> `DraftPayload.matter.type = individual`
- `couple` plus `is_joint = true` -> `married_joint` (legacy generator token)
- `couple` plus `is_joint != true` -> `married_individual` (legacy generator token)

The legacy generator tokens remain unchanged in this phase to avoid rewriting
templates. They describe document composition, not marital status. Marital
status never determines whether spouse/partner documents exist.

### Citizenship

Introduce a shared `CitizenshipStatus` vocabulary:

- `unknown`
- `us_citizen`
- `permanent_resident`
- `nonresident_alien`
- `non_us_unspecified`
- `other`

Add nullable `citizenship_status` columns to `client_intake` and `contacts`.
Backfill `true` to `us_citizen` and `false` to `non_us_unspecified`. Retain
`is_us_citizen` temporarily for compatibility. New UI and seed logic prefer the
status column; compatibility writers keep the boolean synchronized only where
the status has an unambiguous boolean meaning.

Design-sheet text remains compatible with existing templates, but canonical
conversion functions own the mapping. Blank/unknown inputs remain null and are
never defaulted to US citizen.

### Pronouns and legal-fact preflight

Remove `he/him` and `she/her` fallbacks from both design-sheet and draft-payload
projection. The existing template-variable missing-field system will surface
the unresolved pronoun when a selected document requires it. No guessed value
is written to storage or document variables.

### Field definitions and database typing

The estate-fields package owns canonical option vocabularies and normalization.
Application forms import those options instead of maintaining local arrays.
Field definitions gain explicit entity/storage metadata where a field is shared
between intake, contacts, design sheets, and drafting.

Check in generated Supabase schema types and add repeatable scripts for
generation and drift verification. Adopt the generated type directly in new
field-owner routes. Existing query code remains behind a clearly named
compatibility adapter during this phase because making the entire historical
query surface strict exposed a separate, repo-wide type migration backlog.
The adapter is transitional rather than an alternate schema authority. Because
the new column migration is not applied to the hosted database as part of code
review, the checked-in generated artifact contains the reviewed pending columns;
remote deployment remains a separate explicit operation.

### Lifecycle fields and legacy paths

Use explicit domain names in new code: `intake_status`,
`relationship_status`, `opportunity_stage`, `matter_stage`, and
`record_status`. Stop reading `matter_details.matter_status` and
`matter_details.client_status` where canonical `matters` fields are available.
Do not drop them in this phase.

Remove or redirect dormant helpers that target the nonexistent `leads` table.
Estate-value conversion must use the canonical estate-fields helper.

## Data reconciliation

Add a read-only reconciliation script that reports unresolved matter-type
confirmations and, by matter and field, source value, design-sheet value, and
override provenance for citizenship, names, and address. It prints identifiers
only with `--details` and never updates rows. Any production correction remains
a human-reviewed follow-up.

## Verification

- Regression tests prove matter type overrides marital status in draft payloads.
- Tests prove false citizenship becomes `non_us_unspecified`, permanent
  residency round-trips, and unknown stays unknown.
- Tests prove missing pronouns remain missing in projected document variables.
- Migration replay/drift tests cover constraints and absence of duplicate
  versions.
- Typecheck, lint, focused suites, and the full test suite run before handoff.
- Local schema replay and generated-type drift run when Docker/Supabase are
  available; any environment limitation is reported separately.
