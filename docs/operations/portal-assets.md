# Assets in the portal

The funding tracker (`asset_funding`, `lib/funding/`) records how each asset joins the plan
and whether it has: method (deed, retitle, beneficiary designation, assignment, nothing
required) and status (not started, in progress, awaiting confirmation, confirmed, not
applicable). One rule in it is load-bearing: *awaiting confirmation is not funded*. Paperwork
sent is the state everyone mistakes for done, and only the institution's confirmation, read by
the firm and dated, makes an asset confirmed.

The portal now gives the client their side of that tracker.

## What the client sees

- **Your assets** (`/assets`). Every asset on the matter with what it needs, in the client's
  terms: *needs your action* (retitle, beneficiary designation), *confirmation received, we are
  checking it*, *we are handling this* (deed, assignment, nothing required), *to be decided*, or
  *done*. Each line carries one sentence of instruction, and a retirement account's says it is
  never retitled. The client's own work sorts first.
- **Send confirmation.** On an asset that is theirs to do, the client uploads the institution's
  confirmation. The document is filed to the matter like any client upload, the asset moves to
  awaiting confirmation with the document linked, and the firm is asked to check it. A client
  who has done the step but has no paper yet can say so; the asset still moves to awaiting
  confirmation, with "no confirmation attached yet" on the firm's side.
- **Add an asset.** A short form for an account, property or policy the firm does not know
  about: kind, whose it is, a description, the institution and an approximate value, all but the
  first three optional. It lands on the matter marked as client-entered and is copied to the
  design sheet the way a staff-entered asset is.
- **Dashboard.** Once the plan is signed (signing complete, post-execution, funding), a card
  shows how many assets are in the plan and which still need the client. "What's next" sends the
  client to their assets ahead of messages when accounts only they can retitle remain.

## How it is held together

- `lib/funding/portal.ts` (pure) translates method and status into the five client states,
  the instruction per state, who may report, and what a client may file
  (`parseClientAssetInput`). `lib/funding/portalServer.ts` reads the client's assets through
  the existing `loadFundingRows`, adds an asset (`createClientAsset`), and records a report
  (`recordClientRetitling`). The record never writes `confirmed`: it writes
  `awaiting_confirmation`, `confirmation_document_id`, `client_reported_at` and the note, and
  refuses an asset already done or one the firm handles itself.
- `lib/funding/delegateReview.ts` proposes a `task.create` through the delegation dial for
  each report ("Review the client's retitling of …"), keyed to the asset and the document, so
  the firm's position for creating tasks decides whether it waits on Today or is simply there.
- Routes: `GET`/`POST /api/portal/assets`, `POST /api/portal/assets/[assetId]/done`, and an
  `assetId` field on the shared `POST /api/documents/upload`. Each resolves the signed-in client
  to their hired matter and acts only on it.
- Schema (`20270114090000_portal_asset_funding.sql`): `asset_intake.source`
  (staff, client, import); `asset_funding.confirmation_document_id`, `client_reported_at`,
  `client_note`; a client SELECT policy on `asset_funding` scoped to their own matter. Writes
  stay with the service role. `loadFundingRows` reads the new columns and falls back to the
  old list until the migration has run.
- Staff see the client's report on the matter's Funding view: "Client reported this done on …",
  a link to the confirmation, the note, and "added by the client" on client-entered assets. The
  badge stays on awaiting confirmation until staff record the date.

## Not in this slice

A client cannot edit or remove an asset once added; that is the firm's to tidy on the matter.
The assets the client typed into the intake questionnaire (`client_intake.financial_details`)
are still not converted into tracker rows automatically; staff enter them as before. A reminder
to the client about accounts still to retitle is a separate dial action, not yet written.
