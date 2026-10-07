# Probate intake: the standard document list

Probate Phase 3, slice 2 (roadmap: client-facing probate intake). Every estate
starts with the same asks of the personal representative: the death
certificate, the will, who the heirs are, what the decedent owned and what they
owed. They now go out as one list of document requests and are tracked in the
portal like any other request.

## Sending the list

On a probate matter, **Documents → Requested from the client → Ask for the
probate documents** opens the list, grouped by section:

| Section | Items (ticked by default unless noted) |
|---|---|
| Death certificate | Certified copy of the death certificate |
| The will and estate papers | The will and any codicils; any trust and its amendments (unticked) |
| Family and heirs | Names and addresses of the spouse, children and other close family |
| What the estate owns | Account statements; deeds and tax bills; vehicle titles (unticked); life insurance and annuities |
| What the estate owes | The funeral bill; bills since the death; mortgage statements (unticked) |
| Taxes | The last three years of income tax returns |

Untick what this estate does not need, optionally set one due date for the lot,
and send. Each ticked item becomes a document request; the client gets **one**
notice email for the list (the usual 30-minute de-duplication still applies).
Anything else is a one-off request typed on the same card.

The list lives in code, in `lib/documentRequests/probateSet.ts`. Change the
wording or add an item there.

## Never asking twice

Each request made from the list records the item it came from
(`document_requests.template_key`, unique per matter). Sending the list again
offers only what the matter does not have:

- an item already sent is greyed out, **whatever its status** — a request the
  attorney waived stays waived;
- an item whose title matches a live hand-typed request is treated as already
  asked.

Deleting an unanswered request (the bin icon) frees the item to be sent again.

## The portal

The client's **What we need from you** list groups list requests under the same
section headings, each with "N of M sent", and puts one-off requests last under
"Other requests". A matter with no list requests shows the flat list it always
did. Upload, received, accepted and waived work exactly as for any request.

## Migration

`20270124090000_probate_document_requests.sql` adds `section` and
`template_key` to `document_requests`, a check on each, and the unique index on
`(matter_id, template_key)`. Until it runs, requests read and upload as before
(the reads fall back to the old columns) and sending the list answers 503.
