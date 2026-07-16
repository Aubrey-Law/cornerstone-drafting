# Solo-Attorney Estate-Clause Publication Design

**Date:** 2026-07-16
**Status:** Approved for implementation planning

## Context

Cornerstone's Massachusetts estate-clause library currently requires a revision author and publisher to be different users. Aubrey Law is a solo-attorney practice, so that rule prevents the attorney who authors a clause from completing the publication workflow. The application must support the same authorized attorney or administrator authoring, reviewing, publishing, reverting, and retiring estate-clause language.

This change removes only the different-user restriction. It does not reduce the validation, preview, confirmation, concurrency, provenance, or audit requirements that make publication deliberate and reproducible.

## Decision

An authenticated user with the existing `attorney` or `admin` authority may publish or revert a revision they authored. The same user may also request changes to their submitted revision. This policy applies to the imported baseline and every future clause revision.

Submission and publication remain separate actions. Publication is never automatic.

## Publication Workflow

1. An attorney saves and submits a working draft.
2. Cornerstone freezes the submitted revision and runs the existing deterministic validation.
3. Before publication, the attorney must generate fresh representative preview evidence for that exact revision.
4. The publication screen continues to show the proposed text, current published text, diff, validation report, preview evidence, and change summary.
5. The attorney must type the stable clause key and explicitly confirm publication.
6. The publication transaction verifies authorization, validation, preview freshness, content integrity, and the expected current publication before moving the publication pointer.
7. Cornerstone appends the existing publication audit event with the acting user's identity and timestamp.

Reversion follows the same authorization and audit model. Retirement remains a separate explicit action with a required reason.

## Database and Server Changes

The already-applied estate-clause migration remains immutable. A new forward migration will replace the affected RPC definitions without changing their names or parameters:

- `request_estate_clause_changes`
- `publish_estate_clause_revision`
- `revert_estate_clause_publication`

The replacement functions will remove only comparisons that reject `actor_id = author_id`. Existing role checks, `SECURITY DEFINER` configuration, fixed `search_path`, row locking, validation checks, preview-evidence checks, content-hash checks, publication freshness checks, and append-only event writes remain intact.

The server repository will remove its matching early self-review and self-publication rejections. Routes will preserve the existing authorization and conflict handling but will no longer classify same-author actions as forbidden.

No firm-level toggle or new schema setting will be introduced. Aubrey Law's supported policy is solo-attorney publication.

## User Interface

The review panel will no longer disable publication or display a message requiring a different attorney when the current user authored the revision. All existing validation, preview, typed-key confirmation, and stale-publication controls remain visible and enforced.

Copy in the Clause Library and operations runbook will describe deliberate attorney review rather than independent second-attorney review.

## Audit and Authority Boundaries

- AI may draft or revise proposed language but may not submit, approve, publish, revert, or retire it.
- Imported language remains unpublished until the attorney explicitly reviews and publishes it.
- Every submission, requested change, publication, retirement, and reversion remains append-only and attributed to an authenticated actor.
- Published revisions remain immutable.
- Existing generated documents and manifests are never changed by a later publication.
- Automatic changes to existing drafts remain out of scope.

## Failure Handling

Publication continues to fail closed when validation or preview evidence is missing, content integrity fails, the expected current publication changed, the revision is not in a publishable state, or the actor lacks the required role. Concurrent publication conflicts require refresh and comparison; they are not resolved with last-write-wins behavior.

## Testing

Tests will prove that:

- an authorized revision author can request changes, publish, and revert;
- unauthorized roles remain rejected;
- publication still requires valid revision state, fresh preview evidence, typed-key confirmation, and the expected current publication;
- audit events retain the acting user's identity;
- the review UI enables the author to publish when all other gates pass;
- AI and import paths cannot publish;
- the new migration changes only the different-user restriction;
- the focused estate-clause workflow, admin UI, schema, parity, and production build checks remain green subject to documented baseline gates.

## Rollout

Apply the new forward migration to the hosted Supabase project, verify the affected RPC definitions and privileges, deploy the application, and use the solo attorney account to preview and publish the reviewed baseline revisions. Keep `ESTATE_CLAUSE_SOURCE=file` until the publication snapshot, parity gate, and representative preview-generation checks pass. Production database cutover remains a separate deliberate step.

## Out of Scope

- Automatic publication on submission
- AI publication authority
- Scheduled publication
- Multi-user approval modes or a firm-level two-person toggle
- Free-form Word fragment editing
- Attorney-editable selection logic
- Automatic updates to existing generated documents or drafts
