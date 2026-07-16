# Massachusetts Estate Clause Library Design

**Date:** July 15, 2026

**Status:** Approved design

**Scope:** Cornerstone estate-planning DOCX generation for Massachusetts matters

## Summary

Cornerstone will replace the estate generator's file-only clause source with a versioned, database-backed clause library that attorneys can maintain through an admin workflow. Attorneys may draft revisions, but a different authorized reviewer must approve and publish a revision before document generation can use it.

Templates will continue to reference stable clause keys through the existing `include_clause(...)` interface. Clause text will use a restricted template syntax, while DOCX templates remain responsible for paragraph styles, numbering, indentation, tables, and other Word formatting. Each generated document will record the exact immutable clause revisions used so that its contents remain reproducible after the library changes.

## Goals

- Let attorneys create and revise Massachusetts estate-planning clauses without editing repository files.
- Require independent human approval before revised language becomes available to document generation.
- Preserve immutable revision history and a complete publication audit trail.
- Keep clause selection deterministic while permitting explicit, audited matter-specific overrides.
- Preserve correct Word formatting by keeping formatting responsibility in the DOCX template.
- Make every generated document reproducible from an exact clause manifest.
- Introduce the library behind the generator's existing clause interface rather than redesigning unrelated drafting behavior.

## Non-goals

The first release will not include:

- Jurisdictions other than Massachusetts.
- Arbitrary DOCX or Word-fragment editing inside individual clauses.
- AI authority to approve or publish legal language.
- Attorney-editable clause-selection rules.
- Automatic modification of documents that have already been generated.
- Automatic publication of imported or AI-assisted text.

AI may assist an attorney in drafting or comparing text, but AI output remains an unpublished working draft until it completes the same independent review process as human-authored text.

## Design Principles

### Separate content from selection logic

Attorneys own clause language through the library. Tested application rules continue to determine when a template requests a stable clause key. A content revision therefore cannot silently change which matters receive the clause.

### Publish immutable revisions

Working drafts may be edited until submission. Submission freezes the proposed text and metadata into an immutable revision. Review decisions and publication changes are append-only events. Published revision content is never edited in place.

### Fail closed

Document generation must not use an unpublished revision, silently fall back to draft text, or substitute a different clause when resolution fails. It must report the problem and stop before producing a final document.

### Preserve existing drafting boundaries

The new repository will sit behind the estate generator's existing `include_clause(...)` contract. Template structure, design-sheet behavior, payload assembly, and unrelated drafting workflows remain outside this feature unless a narrowly required compatibility change is documented in the implementation plan.

## Data Model

The names below describe responsibilities. The implementation plan may adjust physical table names to match repository conventions without combining distinct responsibilities.

### `estate_clauses`

Provides stable identity and searchable metadata:

- `id`: UUID primary key.
- `clause_key`: unique stable key such as `trust.spendthrift`.
- `title`: attorney-facing name.
- `jurisdiction`: constrained to `MA` in the first release.
- `document_types`: constrained list of compatible document types.
- `is_active`: controls whether the clause may be used for new selections without deleting its history.
- Creation metadata.

A stable key cannot be renamed after it has been used by a publication or generated-document manifest. Replacement requires a new clause and an explicit template-rule change.

### `estate_clause_working_drafts`

Holds the attorney's editable workspace before submission:

- Clause identity and base published revision.
- Structured clause text.
- Allowed placeholder references.
- Required context fields.
- Optional nested clause references.
- Change summary.
- Author and update timestamps.

Only one active working draft per clause and author is required for the first release. Saving a working draft never changes generation behavior.

### `estate_clause_revisions`

Stores immutable submitted snapshots:

- Clause identity and monotonically increasing revision number.
- Complete structured text and declared dependencies.
- SHA-256 content hash.
- Author, submission timestamp, and change summary.
- Reference to the published revision from which the work began.

Revision content is append-only. Review state is derived from review and publication events rather than by mutating the revision text.

### `estate_clause_review_events`

Records append-only workflow decisions:

- Revision identity.
- Event type: `submitted`, `changes_requested`, `approved`, `published`, `retired`, or `publication_reverted`.
- Actor and timestamp.
- Required reviewer comment for changes requested, retirement, or reversion.
- Validation report and publication metadata where applicable.

### `estate_clause_publications`

Maintains the current published revision for each clause:

- One row per clause.
- Current revision ID.
- Publisher and publication timestamp.
- Optimistic-concurrency value or expected prior revision.

The current pointer is an operational index over immutable history, not the history itself.

### `generated_document_clause_revisions`

This normalized child table is the generated-document clause manifest. Each generated document version records one row per included clause:

- Generated document or document-version identity.
- Clause ID and stable clause key.
- Exact revision ID and content hash.
- Inclusion position.
- Selection reason or rule identifier.
- Whether the clause was selected by a default rule or explicit attorney override.
- Actor and timestamp for an override.

The table has a uniqueness constraint over document version and inclusion position, foreign keys to the immutable document version and clause revision, and an index on clause revision. A denormalized JSON snapshot may accompany the document for convenient display, but it is not the provenance source of truth.

## Authoring and Review Workflow

### Library browsing

Authorized staff can search by title, stable key, document type, and status. The list distinguishes published, working-draft, in-review, retired, and unavailable states. Users with the existing `attorney` or `admin` role can author, review, and publish, but the database transaction requires the publisher to be a different user from the revision author.

### Drafting

An attorney creates a working draft from the current published revision or creates a new clause. The editor provides:

- Structured text editing.
- An allowlist of supported placeholders.
- Required-field declarations.
- Nested clause references.
- A mandatory change summary.
- Optional AI drafting and comparison assistance that cannot change workflow state.

The editor does not accept arbitrary Word XML, pasted DOCX fragments, styles, numbering definitions, section breaks, relationships, or embedded objects.

### Preview and validation

Before submission, the author generates previews using representative test matters for every declared compatible document type. Validation checks:

- Template syntax parses successfully.
- Every placeholder and nested clause reference is allowed and resolvable.
- Required fields are declared consistently.
- Nested inclusion has no cycles.
- No unresolved marker remains in rendered output.
- Representative DOCX output preserves expected styles, numbering, and spacing.

Submission is blocked until machine validation passes.

### Independent review

The reviewer sees the published and proposed text side by side, a semantic or textual diff, the change summary, validation results, and representative rendered previews. The author cannot approve or publish their own revision. A reviewer may request changes or approve and publish.

Approval and publication occur together in the first release. A later release may separate approval from scheduled publication if a concrete operational need appears.

### Publication

Publication runs in one database transaction that:

1. Locks or serializes publication for the clause.
2. Confirms the revision remains immutable and validation is current.
3. Confirms the publisher is authorized and is not the author.
4. Confirms the expected current publication has not changed.
5. Updates the current publication pointer.
6. Appends the approval and publication audit event.

If the current publication changed after review began, publication fails and the reviewer must refresh and compare again.

Published revisions cannot be deleted. Retirement prevents new use but preserves reproduction of documents that used the revision. Reversion republishes a prior approved revision through a new audited publication event; it does not erase intervening history.

## Clause Selection and Overrides

Templates and generator rules continue to request stable clause keys. The design sheet and generator context determine deterministic defaults. Attorneys do not edit these rules through the clause-library UI in the first release.

For an exceptional matter, an authorized attorney may explicitly override a default selection before generation by:

- Adding an otherwise compatible published clause.
- Removing an optional default clause.

An override must include a reason, actor, and timestamp. Overrides can use only each clause's current active publication; they cannot select historical publications, working drafts, rejected revisions, incompatible document types, or inactive clauses.

## Generation Data Flow

1. The drafting workflow produces the existing validated generator context.
2. Template rules resolve the ordered set of stable clause keys and selection reasons.
3. Explicit matter overrides are validated and applied.
4. At generation start, the repository resolves every key to one exact published revision and freezes the complete resolution set in memory.
5. The renderer calls the existing clause-inclusion interface against that frozen set.
6. The DOCX template supplies paragraph styles, numbering, indentation, tables, headers, footers, and section formatting around the rendered clause text.
7. The system validates the generated output for missing values and unresolved markers.
8. The generated document version and its complete clause manifest are persisted atomically, or neither is persisted as complete.

A publication that occurs after step 4 affects the next generation only. It cannot change the revision set within an active generation.

## Existing Document Behavior

A new publication never mutates an existing generated document or its manifest. When a matter has an older generated document, Cornerstone may indicate that newer clause publications exist. Applying them requires an explicit attorney action.

Regeneration creates a new document version and a new manifest. The prior document version, prior manifest, actor, and reason remain available. The first release will not attempt clause-level patching of an existing DOCX because patching would weaken formatting reliability and reproducibility.

## Error Handling

Generation stops with an actionable error when:

- A requested clause has no current approved publication.
- A publication points to missing or hash-mismatched content.
- A placeholder or required context field cannot be resolved.
- Nested clause inclusion is circular.
- A selected clause is incompatible with the template's document type.
- An override references an unavailable or unauthorized revision.
- Generated output contains unresolved markers.
- The document and clause manifest cannot be persisted together.

The error identifies the clause key and failure category without exposing confidential matter data in application logs. Failed generations do not create a document marked complete.

Authoring and publication errors preserve the working draft. Authorization failures return a generic denial. Concurrent-publication conflicts require refresh rather than last-write-wins behavior.

## Security and Auditability

- Staff may read published clauses as required by drafting.
- Only authorized attorneys and administrators may author working drafts.
- Only users with the existing `attorney` or `admin` role may publish, and the publisher must be a different user from the revision author.
- Database policy and publication logic both enforce that the publisher differs from the revision author.
- Browser clients do not receive service-role credentials or unrestricted table access.
- Review events, publications, retirements, reversions, overrides, generations, and regenerations are append-only audit events.
- Audit metadata records actor, timestamp, affected revision, expected previous publication, and stated reason where required.
- Clause text is treated as trusted legal content only after publication; AI-generated and imported text receive no implicit trust status.

## Migration Strategy

Migration will be incremental and reversible:

1. Add the database schema, policies, validation layer, and admin workflow without changing production generation.
2. Import each existing Massachusetts JSON clause as a stable clause and initial submitted revision. Preserve its current key, title, document type, required fields, review status, version date, and jurisdiction metadata.
3. Require an authorized reviewer to confirm the imported baseline before it becomes the database publication. Import itself does not constitute legal approval.
4. Add a database-backed repository implementing the existing clause-store interface.
5. Run both repositories against the same representative matter fixtures and compare included keys, rendered text, missing-field reports, warnings, and generated DOCX structure.
6. Switch generation to the database repository only after the approved baseline clauses achieve output parity or every intentional difference is documented and approved.
7. Retain a time-limited operational rollback to the read-only file-backed repository during rollout. New clause edits remain database-only and are never back-written to repository JSON.
8. Remove the runtime fallback only after production verification and a separately approved cleanup change.

## Verification Strategy

### Data and authorization tests

- Stable-key uniqueness and immutability after use.
- Working-draft ownership and permissions.
- Immutable submitted and published revision content.
- Author/reviewer separation at both API and database layers.
- Authorized publication, retirement, and reversion.
- Concurrent publication conflict handling.
- Append-only review and publication history.

### Validation and rendering tests

- Supported and unsupported placeholders.
- Required-field reporting.
- Nested clause inclusion and cycle rejection.
- Incompatible document-type rejection.
- Missing-publication and hash-mismatch failure.
- Correct rendering of line breaks and template-controlled styles.
- No unresolved markers in approved representative output.

### Selection and provenance tests

- Deterministic rule selection for representative design sheets.
- Explicit override validation and audit metadata.
- Frozen revision resolution during concurrent publication.
- Exact clause revision and content hash in every manifest entry.
- Atomic document-version and manifest persistence.
- Regeneration produces a new version without altering prior artifacts.

### Migration and regression tests

- Every existing Massachusetts JSON key maps to one imported clause.
- Imported metadata and required fields are preserved.
- File-backed and database-backed repositories produce equivalent clause reports and rendered content for representative fixtures.
- Representative Will, Trust, Power of Attorney, Health Care, and HIPAA DOCX documents preserve expected numbering, spacing, and styles.
- Rollback returns generation to the unchanged file-backed baseline during the rollout window.

## Acceptance Criteria

The first release is complete when:

- An attorney can draft a new clause or revision without editing repository files.
- A different authorized reviewer can compare, validate, and publish it.
- Published content is immutable and prior publications remain reproducible.
- Templates resolve deterministic Massachusetts clause defaults through stable keys.
- An authorized attorney can make a reasoned, audited matter-specific override using approved content.
- Every completed generated document version records the exact clauses and revisions it used.
- Existing documents remain unchanged after publication updates.
- Representative generated DOCX files are correctly formatted by their templates.
- The database repository passes output-parity checks against the current Massachusetts JSON library before cutover.
- Failures involving approval, resolution, validation, or persistence stop generation visibly without silently using alternate language.

## Deferred Enhancements

Future designs may consider controlled rich-text features, a tested rule-builder with simulation and independent approval, scheduled publication, multi-jurisdiction inheritance, or explicit clause-level update assistance for existing drafts. Each requires a separate design because it changes either formatting reliability, selection risk, or document reproducibility.
