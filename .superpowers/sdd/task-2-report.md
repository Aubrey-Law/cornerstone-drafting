# Task 2 report

## Status: BLOCKED

The guarded POC implementation remains at commit `933666c`. The newly supplied source document was copied to the ignored `.firma-poc/` workspace; the original was not modified. On the disposable copy, `[[CLIENT_1_SIGNATURE]]` replaced the existing first-client signature marker and `[[CLIENT_1_DATE]]` replaced the corresponding first-client date marker.

## Non-live verification completed

- Confirmed both anchors occur exactly once in `word/document.xml`.
- Rendered the anchored DOCX through bundled LibreOffice to a six-page US Letter PDF, then rendered all six pages to PNG at 144 DPI.
- Visually inspected every page. The document remains readable with no clipping, overlap, missing glyphs, or unexpected pagination. The two anchors are visible in the existing first-client signature/date area on page 5. The untouched source also renders as six US Letter pages.
- No Firma API request was attempted because no `FIRMA_*` environment variables are present.

## Exact blockers for live verification

1. `FIRMA_API_KEY` for an explicitly identified non-production Firma workspace.
2. `FIRMA_POC_WORKSPACE` naming that non-production workspace (values `production` and `prod` are refused).
3. `FIRMA_POC_RECIPIENT_EMAIL` for initial unsent creation; an `@example.com` address satisfies the default guard.
4. For send/completion/webhook/download/audit testing, an explicitly authorized disposable deliverable recipient email plus explicit authorization to use it. A non-`@example.com` address also requires `FIRMA_POC_ALLOW_REAL=true`.
5. After the unsent contract is verified, a deliberate script change or separately reviewed operation is required before sending because `FIRMA_POC_SEND=true` is currently refused by design.

Until those inputs and authorizations are supplied, the API version, accepted anchor contract, anchor removal, signer ordering, webhook signature/event fields, completion response, completed-document retrieval, and audit retrieval remain unverified.

## Live continuation

- Created an unsent document-based request after live validation established that Firma requires `anchor_string`, not `anchor`.
- Sent the authorized request, completed signing, and verified finished status, populated signature/date fields, the completed-download endpoint, and 19 audit events.
- Confirmed the converted agreement body is five A4 pages rather than the locally rendered six US Letter pages; the combined completed PDF is six A4 pages with the certificate.
- Confirmed both marker strings remain visible and overlap the completed fields. A second unsent request with explicit `remove_anchor_text: true` also retained both markers.
- Four safety/contract tests pass.

## Updated status: DONE_WITH_CONCERNS

- Two-signer ordering is not yet live-verified.
- A local endpoint did not receive a webhook, so webhook headers and webhook event-ID location remain unverified.
- The current DOCX conversion/anchor layout is not acceptable for production. The next layout POC must use a final-size PDF with invisible searchable anchors, obtain a Firma conversion fix/option, or adopt another verified placement method.

## Review-fix follow-up

- Reconciled the POC guide with the completed one-recipient lifecycle verification and removed stale instructions that described already-completed send/download/audit work as future work.
- Tightened `FIRMA_POC_WORKSPACE` from a two-value production denylist to an explicit non-production allowlist.
- Added executable coverage for both `production` and `prod`, plus `FIRMA_POC_SEND=true` refusal before document access.
- Clarified that current production routes still depend on the legacy solo/joint template IDs; the planned document-based flow has no newly confirmed production secret requirements beyond the already-used API credential.
- Verification: `npx vitest run tests/firma-engagement-poc.test.ts` — 1 file passed, 6 tests passed.

Remaining blockers are unchanged: two-signer ordering, webhook signature headers and webhook event-ID location, and an acceptable production layout/anchor-placement strategy are not verified.
