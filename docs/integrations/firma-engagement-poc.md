# Firma engagement document POC

## Status: unsent creation verified; send lifecycle pending

An attorney-supplied trust engagement agreement was copied to the ignored `.firma-poc/` directory, given one signature anchor and one date anchor, and submitted to Firma using the configured POC credentials. Firma created an unsent draft with one recipient and two fields. No agreement has been sent yet. Tasks 6 and 7 may rely on the verified creation facts below, but not on the still-unverified send, signing, webhook, download, or audit contracts.

## Safe preflight

The guarded script creates only an **unsent** document-based request. It requires an explicitly named non-production workspace and refuses real recipient domains unless separately authorized. Sending remains disabled until explicitly authorized and implemented as a separate verification step.

Required local-only inputs:

- `FIRMA_API_KEY`: credential for a non-production Firma workspace.
- `FIRMA_POC_WORKSPACE`: a descriptive non-production workspace name; `production` and `prod` are refused.
- `FIRMA_POC_DOCX`: path to a disposable DOCX containing `[[CLIENT_1_SIGNATURE]]` and `[[CLIENT_1_DATE]]`.
- `FIRMA_POC_RECIPIENT_EMAIL`: use an `@example.com` address for request creation. A deliverable address additionally requires `FIRMA_POC_ALLOW_REAL=true` and explicit authorization.

Run `node scripts/firma-engagement-poc.mjs`. Do not set `FIRMA_POC_SEND=true`; the script deliberately refuses it pending verification.

Store disposable inputs under `.firma-poc/` and redacted webhook captures under `firma-webhook-captures/`. Both paths are ignored by Git. Never record API keys, tokens, client data, signing links, or unredacted payloads here.

## Live verification record

The following must be replaced with exact, redacted observations from the authorized test workspace:

| Contract | Verified result |
|---|---|
| Tested Firma API version | Document-based `POST /signing-requests` as documented in the v01.17.00 reference; response status was `draft`. |
| Accepted `anchor_tags` object shape | Verified required property `anchor_string`; `anchor` was rejected with `VALIDATION_ERROR`. Signature and date entries using `recipient_id: temp_1`, percentage `width`, and percentage `height` created two fields. |
| DOCX conversion | Verified. Firma converted the locally rendered six-page US Letter DOCX into a five-page A4 PDF (595.28 x 841.89 points). This pagination/page-size difference must be addressed or accepted during master-template validation. |
| Anchor field placement | Verified one `signature` and one `date` field, both assigned to the real recipient UUID on page 5. |
| Anchors removed from rendered PDF | Not verified as removed: the unsent draft PDF download visibly retained both marker strings even though Firma created the fields. Verify the actual signing view before relying on marker removal. |
| Two-signer ordering | **UNVERIFIED** |
| Webhook signature headers | **UNVERIFIED** |
| Event ID location | **UNVERIFIED** |
| Completion response | **UNVERIFIED** |
| Completed-document field/endpoint | **UNVERIFIED** |
| Audit field/endpoint | **UNVERIFIED** |

After the unsent request succeeds, obtain explicit authorization for a disposable deliverable recipient, verify the documented send operation, complete signing, and capture redacted webhook headers/body plus completed-document and audit retrieval behavior. Only then update this record and add confirmed server secrets to `VERCEL_ENV_CHECKLIST.md`.
