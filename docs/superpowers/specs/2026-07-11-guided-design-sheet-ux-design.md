# Guided Design Sheet UX Design

## Goal

Make Section-by-Section faster and easier for a solo attorney while preserving its stable legal sequence. Keep Fast Entry as the dynamically prioritized completion workspace. Both modes must expose the same choices, acceleration actions, readiness state, and final review information through the existing shared design-sheet state and section catalog.

## Current-State Findings

- Both modes already render the same section definitions, field components, document-dependent visibility, readiness calculation, and autosave state.
- Fast Entry adds unresolved-first ordering, completed-section collapse, Next required, attorney presets, copy-forward actions, compact autosave, and final exception review.
- Section-by-Section retains fixed previous/next navigation, duplicates blocker navigation in the summary rail, always shows manual Save, and lacks the newer acceleration and review controls.
- Contact Picker filters valid contacts and then truncates the result to five with `.slice(0, 5)`. Its dropdown also uses `overflow-hidden` without a scroll region, so additional matches cannot be reached.

## Interaction Design

### Stable overview and unresolved navigation

- Keep overview cards in the existing legal/catalog order; do not dynamically reorder them.
- Add missing-item counts to each attention card and visually mute completed cards.
- Group the overview into `Needs attention`, `Not started or optional`, and a collapsed `Completed` group while retaining catalog order inside each group.
- Add one persistent `Next required: <field>` action above the content on the overview and section pages.
- On a section page, make the primary footer action `Next unresolved` while blockers remain. It targets the next blocker after the active section, wrapping to the first blocker when necessary.
- Retain `Previous section`, `Next section`, and `All sections` as secondary review navigation.
- A blocker navigation action must route to the correct section and focus/highlight its target field using the existing deep-link mechanism.

### Fast Entry parity

- Reuse the existing attorney-preset preview/apply/save behavior and allowlist; do not create a second preset implementation.
- Reuse the explicit `Client selections -> spouse` and `Trustees -> primary roles` copy-forward patches.
- Show those acceleration actions in a compact Section-by-Section action bar on the overview and section pages when applicable.
- Hide the manual Save action while autosave is healthy, matching Fast Entry.
- Add the same compact final review to the Section-by-Section overview: unresolved blockers, intake overrides, applied standards, pending-client decisions, and selected documents.
- Generation remains available only when the shared readiness result is complete.

### Contact Picker

- Remove the five-result truncation.
- Render all filtered contacts inside a results list with a maximum height and vertical scrolling.
- Keep the `Add new contact` action outside and below the scrolling list so it remains visible.
- Preserve search, deduplication, selected-contact editing, add-contact prefilling, and outside-click dismissal.
- Add keyboard behavior: Arrow Up/Down changes the active result, Enter selects it, and Escape closes the dropdown. The active option must remain visible while navigating.
- Expose listbox/option roles and active-state styling for accessibility.

## Architecture

- Extract shared acceleration and final-review UI from Fast Entry into focused components consumed by both shells.
- Add pure navigation helpers for overview grouping and next-blocker resolution; test them independently.
- Keep `DesignSheetShell`, `ExpressDesignSheet`, `useDesignSheetState`, readiness, persistence, and section catalog as the integration boundaries.
- Do not change database schema, drafting payloads, clauses, estate generators, or legal defaults.

## Failure Handling

- Preset load/save failures continue to use the existing preference fallback and toast behavior.
- Copy-forward remains an explicit attorney action and uses the existing autosave path.
- If a blocker has no target field, navigation opens its section and focuses the section container.
- Empty contact searches show the current empty/no-match state while keeping Add new contact available.

## Testing and Acceptance

- Pure tests cover overview grouping, stable order, next-blocker wrapping, and completed-section handling.
- Contact Picker tests cover more than five results, scrolling container structure, keyboard selection, Escape, and pinned Add action.
- Integration/source tests confirm both modes consume the shared acceleration and final-review components.
- Existing autosave, server-prop sync, preset, copy-forward, readiness, and design-draft tests remain green.
- TypeScript, scoped ESLint, `git diff --check`, and `npm run build:next` pass.
- The previously approved unrelated full-suite baseline failures remain outside scope.
