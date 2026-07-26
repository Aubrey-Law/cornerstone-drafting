# Matter Activity Event Icons

**Date:** 2026-07-25

## Scope

Restore event-specific icons in the matter-detail Activity timeline at
`/admin/matters/[id]`. This change affects only the timeline marker rendered by
`MatterActivityTab`.

## Design

Replace the actor-initial marker introduced by the matter-collections redesign
with the prior event-specific icon and color treatment:

- Stage changed: Activity icon with accent treatment.
- Intake sent: Send icon with accent treatment.
- Intake completed: Check icon with success treatment.
- Email sent: Send icon with muted treatment.
- Draft generated: Document icon with accent treatment.
- Draft promoted to review: Check icon with success treatment.
- Matter created: Info icon with muted treatment.
- Unmapped event types: Info icon with muted treatment.

The timeline marker remains circular and connected by the current vertical
line. Its accessible label describes the event marker rather than presenting it
as the actor's avatar.

## Preserved Behavior

The current Activity timeline improvements remain unchanged:

- Events stay grouped by day.
- Draft-generation summaries and document links remain available.
- Lead-origin badges remain visible.
- Full detail text remains readable.
- Timestamp and actor name remain in the event metadata line.
- Loading and empty states remain unchanged.

The `actorInitials` helper is removed because initials are no longer rendered.

## Testing

Use a focused component test with representative activity events to verify:

- The expected event icon is rendered for mapped event types.
- An unmapped event uses the Info fallback.
- Actor initials are not rendered in timeline markers.
- Actor names remain visible in the timestamp metadata.
- Existing linked-lead activity rendering and matter-activity redesign tests
  continue to pass.

Run the focused tests, changed-file ESLint, and `git diff --check`. No schema,
API, query, or drafting-workflow changes are required.
