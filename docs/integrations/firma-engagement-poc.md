# Firma engagement document POC

## Status: blocked before live execution

This repository does not currently contain a disposable engagement DOCX, and the local environment does not contain Firma POC credentials. No Firma request has been created, no agreement has been sent, and none of the contracts below are verified. Tasks 6 and 7 must not treat this document as API-contract evidence until the live checklist is completed with redacted results.

## Safe preflight

The guarded script creates only an **unsent** document-based request. It requires an explicitly named non-production workspace and refuses real recipient domains unless separately authorized. Sending is disabled until Firma's send endpoint is verified.

Required local-only inputs:

- `FIRMA_API_KEY`: credential for a non-production Firma workspace.
- `FIRMA_POC_WORKSPACE`: a descriptive non-production workspace name; `production` and `prod` are refused.
- `FIRMA_POC_DOCX`: path to a disposable DOCX containing `[[CLIENT_1_SIGNATURE]]` and `[[CLIENT_1_DATE]]`.
- `FIRMA_POC_RECIPIENT_EMAIL`: use an `@example.com` address for request creation. A deliverable address additionally requires `FIRMA_POC_ALLOW_REAL=true` and explicit authorization.

Run `node scripts/firma-engagement-poc.mjs`. Do not set `FIRMA_POC_SEND=true`; the script deliberately refuses it pending verification.

Store disposable inputs under `.firma-poc/` and redacted webhook captures under `firma-webhook-captures/`. Both paths are ignored by Git. Never record API keys, tokens, client data, signing links, or unredacted payloads here.

## Live verification record (not yet completed)

The following must be replaced with exact, redacted observations from the authorized test workspace:

| Contract | Verified result |
|---|---|
| Tested Firma API version | **UNVERIFIED** |
| Accepted `anchor_tags` object shape | **UNVERIFIED** (the script currently uses the proposed shape from the implementation plan) |
| Anchors removed from rendered PDF | **UNVERIFIED** |
| Two-signer ordering | **UNVERIFIED** |
| Webhook signature headers | **UNVERIFIED** |
| Event ID location | **UNVERIFIED** |
| Completion response | **UNVERIFIED** |
| Completed-document field/endpoint | **UNVERIFIED** |
| Audit field/endpoint | **UNVERIFIED** |

After the unsent request succeeds, obtain explicit authorization for a disposable deliverable recipient, verify the documented send operation, complete signing, and capture redacted webhook headers/body plus completed-document and audit retrieval behavior. Only then update this record and add confirmed server secrets to `VERCEL_ENV_CHECKLIST.md`.
