# Matter Layout and Count Cleanup

## Goal

Remove the unused space on the right side of the matter-detail workspace and remove the navigation-level collection counts that make the Overview and tab bar unnecessarily busy.

## Approved Scope

- Let the matter header and tab workspace use the full width available inside the existing admin content boundary.
- Keep their left and right edges aligned.
- Remove the Overview collection-count strip in full:
  - People
  - Assets
  - Documents
  - Tasks
- Render the main collection tabs as plain labels:
  - People
  - Assets
  - Documents
- Remove the count-strip component wiring and any props or imports that become unused.
- Preserve operational counts inside the collection workspaces when they communicate actionable state, including selected-row counts, document-folder contents, issue counts, and grouped asset quantities.

## Implementation Boundary

The change belongs in the existing matter-detail presentation layer. It does not change database queries, persistence, document-sharing controls, drafting navigation, authorization, or collection-loading behavior.

The `max-w-[1280px]` constraints on the shared matter-detail frame will be removed rather than replaced with a larger fixed cap. Existing admin padding remains the page boundary.

## Verification

- Add or update source-contract tests proving:
  - the matter-detail frame no longer uses the 1280px cap;
  - People, Assets, and Documents tab labels have no counts;
  - the Overview count strip is not rendered;
  - collection functionality remains mounted.
- Run the focused matter Overview/frame tests.
- Run changed-file ESLint, TypeScript checking, `git diff --check`, and the production Next.js build.
- Browser-check the protected matter page if an authenticated local or preview session is available.

## Non-Goals

- Do not remove operational counts within People, Assets, or Documents.
- Do not redesign the contents of those tabs.
- Do not modify the unrelated lead-detail or softphone implementation.
