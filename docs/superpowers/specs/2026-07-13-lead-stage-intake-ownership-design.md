# Lead-Stage Intake Ownership

## Goal

Make the lead page the primary place for intake work before conversion, while preserving matter-page access to import and update intake after conversion.

## Design

- The lead detail page will render the existing admin intake sheet and import dialog using the lead's `client_intake` row.
- The lead intake card will show intake status and the generated client intake URL when available, with copy and resend actions. Resend will reuse the existing `/api/admin/intake/send` action with `intakeId`.
- The matter page will keep its existing import/update controls and intake synchronization/status card for post-conversion corrections. No drafting internals or intake persistence contracts will be changed.
- Lead intake saves will continue using the existing `saveAdminIntakeDraft` and `submitAdminIntake` server actions with `leadId`; conversion and matter linking remain unchanged.

## Success Criteria

- A lead user can fill, edit, import, submit, copy, and resend intake from the lead detail page.
- A converted matter still supports importing intake and updating the linked intake.
- Existing lead conversion and matter intake synchronization behavior remains intact.
- Focused tests cover lead intake controls/link actions and the preserved matter import/update surface.
