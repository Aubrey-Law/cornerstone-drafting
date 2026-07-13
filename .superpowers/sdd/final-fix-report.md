# Final Fix Report — Editable Lead Detail

## Changes

- Added the accessible top-row Lead/Hired/Lost selector. Hired reuses the validated PATCH/conversion path; Lost remains a lead.
- Added Draft/Resume engagement labeling from the active agreement queried by the page.
- Added one activity reload callback shared by detail/status, ordinary note create/update/delete, manual meeting notes, and Granola import. It replaces activity state without resetting edit form state.
- Passed the authenticated route user to `update_lead_details`; the service-role branch validates the actor exists in `public.users` with attorney/admin role before audit attribution.
- Added structured route field errors and accessible field-level messages while retaining the summary alert and entered values.
- Left drafting internals and `LeadDetailClient 2.tsx` untouched.

## Verification

- Focused lead/matter suite: 10 files, 90 tests passed.
- Lint: baseline failure, 8 errors and 57 warnings, all errors in pre-existing drafting files outside this change.
- Production build command: passed (`TypeScript OK (incremental cache fresh)`).
- `git diff --check`: passed.
