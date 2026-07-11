# Client Selections to Spouse

## Goal

Revise the design-sheet **Client selections → spouse** action so each spouse fiduciary list names the client as primary and then reuses the client's backup nominations in their existing order.

## Behavior

For trustee, personal representative, financial POA agent, and health care agent slots:

1. Set the spouse's primary slot to the client.
2. Copy the client's slots after the primary slot as the spouse's backups.
3. Preserve backup order and co-fiduciary flags.
4. Create independent slot objects so later spouse edits do not mutate client selections.

The action continues copying the client's anatomical-gift election, advance-directive election, and additional HIPAA agents to the spouse as it does today.

If a client role has no backups, the spouse list contains only the client as primary. The action remains available only when spouse documents are included.

## Scope

Change only the fast-entry helper behind the existing button and its focused tests. Do not alter the design-sheet data model, drafting payload, document generator, detailed fiduciary editors, or attorney standards feature.

## Verification

Focused tests will prove that the client becomes the spouse primary, the original client primary is omitted, backups retain their order and flags, empty lists produce a client-only primary, source arrays remain unmodified, and health-care elections still copy.
