# Drafting reliability and efficiency

The user approved all recommendations in the drafting review. Keep Design → Generate → Review, the canonical drafting engine, attorney/admin access, immutable document provenance, and existing sharing safeguards.

1. Save barrier: wait for all pending design edits before preflight; retain visible saved/error/conflict status across steps; preflight/generation must agree on a saved source revision. Preserve document selections while navigating to fix fields.
2. Generation: persistent run identity, atomic claims against duplicate execution, actual saved/failed outcomes, recoverable partial failures and retry only outstanding documents. Never imply timed progress is completion. Refreshing or navigating back must recover run status. Do not replay a completed request. No automatic client sends.
3. Review: deliberate review action for the active document version; conversion is not review. Eligibility must reflect actual missing-field safeguards. Show exact states, current documents grouped with history, compare prior versions, next unreviewed, batch selection/conversion and restrained secondary actions. Preserve existing in-app viewer/redlining/assistant.
4. Design: comfortable form width, clause drawer on intermediate widths, next unresolved decision, grouped issues and persistent navigation context. Keep existing recently landed conflict resolution and saved hub views.
5. Generate layout: document selection and actionable checks first, secondary source/override details collapsed, one primary internal-generation action, confirm only unresolved-data generation. Persistent results rather than disappearing toasts.
6. Hub: server-owned search/filter/count/sort/page contract over all matching matters, URL state and saved views. Counts honor practice area. Stable sorting and accurate totals.
7. Verification: behavioral tests for save race, snapshot mismatch, duplicate run, partial persistence/retry, review/version and selected batch actions, responsive layout and hub filter/count contracts. Add operating metrics using existing activity/run data; never send legal content to external telemetry.

Schema additions are additive and service-role-only where internal. Prepare and locally verify migrations; do not change the shared database or publish without a concrete reviewed release. No renderer replacement.
