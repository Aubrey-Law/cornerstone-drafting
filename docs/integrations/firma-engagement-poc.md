# Firma engagement document POC

## Status: lifecycle verified; layout acceptance failed

An attorney-supplied trust engagement agreement was copied to the ignored `.firma-poc/` directory, given one signature anchor and one date anchor, submitted to Firma, sent to an authorized test recipient, and completed. Firma created both fields and returned a completed PDF plus audit events. The final layout is not acceptable: anchor markers remain visible beneath the filled fields, and Firma changed the locally rendered Letter pagination to A4. Tasks 6 and 7 may rely on the API lifecycle facts below but must not adopt the current anchor/layout strategy unchanged.

## Safe preflight

The guarded script creates only an **unsent** document-based request. It requires an explicitly named non-production workspace and refuses real recipient domains unless separately authorized. Sending remains disabled until explicitly authorized and implemented as a separate verification step.

Required local-only inputs:

- `FIRMA_API_KEY`: credential for a non-production Firma workspace.
- `FIRMA_POC_WORKSPACE`: an explicit environment sentinel: `sandbox`, `test`, `testing`, `staging`, `development`, `dev`, or `non-production`. Every other value, including `production` and `prod`, is refused.
- `FIRMA_POC_DOCX`: path to a disposable DOCX containing `[[CLIENT_1_SIGNATURE]]` and `[[CLIENT_1_DATE]]`.
- `FIRMA_POC_RECIPIENT_EMAIL`: use an `@example.com` address for request creation. A deliverable address additionally requires `FIRMA_POC_ALLOW_REAL=true` and explicit authorization.

Run `node scripts/firma-engagement-poc.mjs`. Do not set `FIRMA_POC_SEND=true`; the script deliberately refuses it pending verification.

Store disposable inputs under `.firma-poc/` and redacted webhook captures under `firma-webhook-captures/`. Both paths are ignored by Git. Never record API keys, tokens, client data, signing links, or unredacted payloads here.

## Live verification record

The following records exact, redacted observations from the authorized test workspace:

| Contract | Verified result |
|---|---|
| Tested Firma API version | Document-based `POST /signing-requests` as documented in the v01.17.00 reference; response status was `draft`. |
| Accepted `anchor_tags` object shape | Verified required property `anchor_string`; `anchor` was rejected with `VALIDATION_ERROR`. Signature and date entries using `recipient_id: temp_1`, percentage `width`, and percentage `height` created two fields. |
| DOCX conversion | Verified. Firma converted the locally rendered six-page US Letter DOCX into a five-page A4 PDF (595.28 x 841.89 points). This pagination/page-size difference must be addressed or accepted during master-template validation. |
| Anchor field placement | Verified one `signature` and one `date` field, both assigned to the real recipient UUID on page 5. |
| Anchors removed from rendered PDF | Failed: both the draft and completed PDFs visibly retained the marker strings. A second draft with `remove_anchor_text: true` also retained them. |
| Two-signer ordering | **UNVERIFIED**; this POC used one recipient. |
| Webhook signature headers | **UNVERIFIED**; this local POC did not receive a webhook. |
| Event ID location | Verified for audit events from `GET /signing-requests/{id}/audit`; webhook event ID remains unverified. |
| Completion response | Verified `status.finished: true`, `timestamps.finished_on`, and populated signature/date values from `GET /signing-requests/{id}/fields`. |
| Completed-document field/endpoint | Verified `GET /signing-requests/{id}/download` returns `status: finished`, `is_partial: false`, and a download URL. |
| Audit field/endpoint | Verified `GET /signing-requests/{id}/audit` returns `results`; the completed test returned 19 signer/audit events. |

## Layout acceptance findings

- The locally rendered disposable DOCX was six US Letter pages.
- Firma's converted agreement body was five A4 pages.
- The completed combined PDF was six A4 pages because Firma appended its audit certificate.
- Firma created the signature and date fields on page 5 and stored both values.
- The completed PDF visibly retained `[[CLIENT_1_SIGNATURE]]` and `[[CLIENT_1_DATE]]` beneath the rendered signature/date. The fields overlap the markers and surrounding table content.
- A second unsent draft explicitly set `remove_anchor_text: true` on both anchor definitions. Its converted draft PDF still visibly retained both marker strings. Explicit removal therefore does not fix this DOCX conversion path.
- The source agreement also still contained its previous Firma-template placeholders for a second signer and signed-date autofill; future POC sources must remove all legacy template placeholders before layout evaluation.

Do not proceed with production anchor placement until a second layout POC proves one of these options:

1. Cornerstone supplies a PDF that already has the required final page size and invisible/searchable anchor markers; or
2. Firma confirms a DOCX conversion option that preserves US Letter page dimensions and removes anchors; or
3. Firma fixes or documents the observed DOCX anchor-removal behavior.

The one-recipient send, completion, completed-document download, and audit retrieval were verified. Remaining work is limited to the explicit blockers above: acceptable layout/anchor behavior, two-signer ordering, and webhook headers/event-ID location. Do not infer any of those contracts from this POC.
