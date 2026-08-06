# Documents & Sharing Simplification

**Date:** 2026-08-06
**Status:** Approved, ready for implementation planning

## Goal

The documents system supports three things: share documents with clients, let clients
share documents with the firm, and store matter documents. It currently carries a
supervision apparatus built for a firm with staff — four stacked sharing gates, seven
folders, and a fail-closed audit log. The firm is one attorney. This design removes the
apparatus and leaves the three things.

## Current state

Measured against the live database (project `qifunlovuwaryzsyfbnh`) on 2026-08-06:
102 documents across 47 matters.

**Only two of seven folders are in use.** `draft` (99 rows) and `review` (3 rows).
`final`, `signed`, `client`, `intake`, and `meeting-notes` are each defined, labeled,
filtered, and gated, with zero rows.

**Two folder systems exist and one is dead.** Alongside `matter_documents.folder` there
is a `folders` table joined via `folder_id`. The table has 0 rows, `folder_id` is null on
all 102 documents, and no UI path ever sets it. `documentSecurity.ts` nonetheless queries
it on every single-document read (`userCanReadDocument`) and every list read
(`filterClientVisibleDocuments`).

**`folder` carries three unrelated jobs:**

| Job | Values | Consumers |
|---|---|---|
| Visibility | `review`, `signed`, `final` = client can see | `lib/queries/portal.ts`, `documentSecurity.ts`, RLS |
| Provenance | `draft` / `client` / `meeting-notes` = where it came from | drafting hub, portal-uploads card, unreviewed-upload counter, meeting-notes card |
| Nothing | `final` unused; `signed` written only by the e-sign webhook | — |

**Folder-set knowledge is duplicated in 8 TypeScript files plus 2 RLS policies:**
`VALID_FOLDERS` in three API routes; `FIRM_SHARED_FOLDERS` in both `documentSharing.ts`
and `documentWorkspace.ts`; `INTERNAL_WORK_FOLDERS` and `INTERNAL_DOCUMENT_FOLDERS` (same
set, two names, two files); `CLIENT_HIDDEN_FOLDERS` in `documentSecurity.ts` carrying
legacy alias spellings (`drafts`, `meeting_notes`); `FOLDER_LABEL` in
`PromoteDocumentDialog.tsx`; `DOCUMENT_FOLDERS` in `documentWorkspace.ts`.

**Four gates stack before a document reaches a client**, each implemented twice — once
client-side for button state, once server-side for enforcement:

1. PDF-only — Word documents blocked from any client-visible folder
2. Marker-clean — `marker_count` must be 0
3. Attorney-reviewed — `reviewed_at` must be set, via its own PATCH mode
4. Explicit confirmation — server rejects without `confirmed: true`; the modal requires
   ticking a Mass. R.P.C. 1.1/5.3 acknowledgment checkbox

**The gates are already bypassable.** `app/api/documents/[id]/convert-pdf/route.ts:93`
inserts directly into the `review` folder, publishing to the client portal with no
confirmation, no review check, and no marker check. The gates bind only the manual path.

**RLS is more permissive than the API.** `client_read_visible_matter_documents` exposes
anything not in draft/meeting-notes, with no PDF requirement. The API's PDF filter is the
only thing hiding Word files from clients.

**Audit fails closed on reads.** Every view and download writes a `document_access_audit`
row and returns 503 if that insert fails. Mutations perform compensating reverts on audit
failure. 219 audit rows exist.

**The admin tab is 955 lines** with 20 `useState` hooks, four overlapping ways to narrow
one list (folder nav, visibility filter, type filter, search), and eight dialogs.

## Design

### Data model

Two columns replace `folder`, splitting the jobs it was conflating.

```
matter_documents
  shared_at  timestamptz | null   -- visibility. The one enforced rule.
  source     text                 -- provenance. Automatic and inert.
```

`shared_at` is the entire visibility model: a client sees a document if and only if
`shared_at` is set (or they uploaded it themselves).

`source` is one of `firm`, `client`, `meeting-notes`. It is written by whichever code path
creates the document, is never user-selectable, and gates nothing. It exists so the
meeting-notes card and portal-uploads card can find their rows. There is no move
operation, no folder picker, and no rule attached to it.

`reviewed_at` and `reviewed_by` are retained as informational bookkeeping — the "Reviewed"
badge in the drafting hub — but no longer gate anything.

### Migration

Ordered so nothing breaks mid-flight: add and backfill, then redefine dependents, then
drop.

**Step 1 — add and backfill:**

```sql
alter table matter_documents
  add column shared_at timestamptz,
  add column source text not null default 'firm'
    check (source in ('firm','client','meeting-notes'));

update matter_documents set shared_at = created_at
  where folder in ('review','signed','final');
update matter_documents set source = 'client'
  where folder in ('client','intake');
update matter_documents set source = 'meeting-notes'
  where folder = 'meeting-notes';

create index on matter_documents (matter_id, shared_at);
create index on matter_documents (matter_id, source);
```

Backfill touches 3 rows. The other 99 are `draft`, which maps to the defaults
(`shared_at` null, `source` `'firm'`).

**Step 2 — redefine the three RPCs that reference `folder`.** These were verified against
the live database and will break on the column drop if skipped.

| RPC | Change |
|---|---|
| `drafting_hub_draft_rollups` | `WHERE d.folder = 'draft'` → `WHERE d.source = 'firm'`. This widens the rollup to include shared PDFs, which previously sat in `review` and were excluded. Accepted: a shared PDF appearing beside its source draft in the hub is an improvement, not noise |
| `persist_generated_estate_document` | Drop `folder` from the INSERT column list and its value; the defaults (`source` `'firm'`, `shared_at` null) are correct |
| `get_matter_links_by_emails` | `doc_counts` filters on four folder values. Replace with `drafts` = `source='firm' and shared_at is null`, `shared` = `shared_at is not null`. Collapse the `review`/`signed`/`final` JSON keys into a single `shared` key |

`get_matter_links_by_emails` has no caller in the application code. It is updated rather
than dropped in case an external consumer exists.

**Step 3 — replace both RLS policies:**

```sql
-- client_read_visible_matter_documents
(shared_at is not null or uploaded_by = auth.uid())
  and <existing matter-ownership clause, unchanged>

-- client_insert_own_client_folder_documents
source = 'client' and <existing matter-ownership clause, unchanged>
```

This makes RLS say the same thing as the app layer instead of a looser second version of
it. Rename the insert policy to `client_insert_own_documents`.

**Step 4 — drop:**

```sql
alter table matter_documents drop column folder, drop column folder_id;
drop table folders;
```

Per the known-unreliable state of `supabase_migrations.schema_migrations` in this project,
verify each object's actual state in the database after applying — do not trust the
migration history table.

### Security and audit

`lib/documentSecurity.ts`, 167 → ~75 lines.

- `userCanReadDocument`: admin → allow; otherwise allow if `shared_at is not null` or
  `uploaded_by === user.id`, then `userCanAccessMatter`. The `folders` table lookup is
  removed.
- Deleted: `isClientVisibleDocument`, `isClientUploadFolder`,
  `filterClientVisibleDocuments`.
- `userCanAccessMatter` is untouched. It is real access control and unrelated to sharing.
- `auditDocumentAccess` returns `void` and logs a console warning on failure. Every
  `if (!audit.ok)` branch, every 503 response, and every compensating revert is deleted.
- Audited actions narrow to `share | unshare | delete | rename | review`. `view` and
  `download` no longer write audit rows, which removes the fail-closed path from `GET`
  entirely.

The audit table and the audit sheet in the tab UI are retained.

### Server API

| Route | Change |
|---|---|
| `GET /api/documents` | `?source=` replaces `?folder=`. `lib/documents.ts` `listDocuments(matterId, folder?)` becomes `listDocuments(matterId, source?)`; `uploadDocument(file, matterId, folder, onProgress, folderId)` loses both the `folder` and `folderId` parameters |
| `PATCH /api/documents/[id]` | Three modes: `{shared}`, `{name}`, `{reviewed}`. No `confirmed` flag, no PDF check, no marker check, no review check. 303 → ~150 lines |
| `POST /api/documents/upload` | No `folder` or `folderId` param. Admin → `source:'firm'`, client → `source:'client'`. Retains auth, matter access, size and MIME limits, and the matter-closed check |
| `POST /api/documents/upload-url` | Drop `VALID_FOLDERS`; same source rule as above |
| `POST /api/documents/[id]/convert-pdf` | Creates the PDF **unshared** rather than inserting into `review`. Closes the bypass |
| `POST /api/webhooks/esign` | Countersigned document → `source:'firm'`, `shared_at: now()`, preserving today's behavior |
| `POST /api/admin/meeting-notes` | `source:'meeting-notes'` |
| `lib/queries/portal.ts` | `fetchSharedDocuments` → `shared_at is not null`. `fetchClientUploads` → `source='client' and uploaded_by = userId`. Drops `filterClientVisibleDocuments` and `isClientPortalFirmDocument` |
| `lib/queries/drafting.ts`, `app/api/admin/matters/[id]/draft`, `.../assistant` | `.eq('folder','draft')` → `.eq('source','firm')` |
| `app/admin/drafting/[matterId]/page.tsx` | `.eq('folder','review')` → `.not('shared_at','is',null)` |
| `lib/matter/unreviewedUploads.ts`, `MatterPortalUploadsCard` | `folder='client'` → `source='client'` |
| `MatterMeetingNotesCard` | `listDocuments(matterId,'meeting-notes')` → `source='meeting-notes'` |
| `lib/intake/promoteIntakeDocuments.ts`, `lib/works/artifacts.ts` | `folder:'intake'` → `source:'client'` |

Sharing becomes a single `update matter_documents set shared_at = now()`. The existing
client notification on first share is preserved.

### Admin documents tab

`MatterDocumentsTab.tsx`, 955 → ~350 lines, 20 `useState` → ~8.

```
Matter documents                                    [ Upload ]

[ All 102 ][ Shared 3 ][ From client 0 ]     [ Search…        ]

☐  Document                      From    Shared
☐  Trust Agreement.docx          Firm    ( ●——)   [View] [⋯]
☐  Deed.pdf                      Firm    (——● )   [View] [⋯]
☐  2024 tax return.pdf           Client  (——● )   [View] [⋯]
```

The toggle is the share action — one click on, one click off, no modal.

Removed: folder navigation (7 buttons), upload folder picker, visibility filter, type
filter, move dialog, bulk move dialog, promote dialog, the 7-metric counts strip,
`getDocumentShareEligibility`, `buildSelectedDocumentEligibility`.

Retained: search, row selection, bulk download / share / unshare / combine Word documents,
preview dialog, audit sheet, the "N uploads need review" banner, and the deep-link row
highlight.

The row action menu drops from seven items to five: Open original, Download, Rename,
History, Delete.

Marker counts survive as an amber line on the row when greater than zero — information,
not a gate.

### Client portal

Two fixes in `PortalDocumentList.tsx`:

- The hardcoded `PDF` file-type tile derives from the filename extension, since Word
  documents can now be shared.
- `documentStatus()`, which switches on `doc.folder` to produce "Action needed" /
  "Signed copy" chips, is replaced by a plain `Shared {date}`. Those chips encoded folder
  distinctions that no longer exist.

`ClientUploadCard` and the portal page are otherwise unchanged.

### Deleted outright

- `lib/documentSharing.ts` (60 lines)
- `lib/drafting/reviewGate.ts`
- `components/documents/PromoteDocumentDialog.tsx` (~160 lines)
- `tests/document-sharing.test.ts`
- `tests/draft-review-gate.test.ts`
- the `folders` table and the `folder_id` column

`lib/documentWorkspace.ts` shrinks from 177 to ~45 lines, keeping `documentFileType` and
the status badges and losing `DOCUMENT_FOLDERS`, every folder set, and both eligibility
functions.

Net reduction is roughly 1,200 lines, and the folder rules stop existing in 8 TypeScript
files and 2 RLS policies.

## Accepted behavior changes

1. **Word documents become shareable to clients.** This follows from dropping the PDF
   gate. Clients may receive editable `.docx` files.
2. **"Convert & share PDF" stops auto-sharing.** It creates the PDF and the attorney flips
   the toggle. This closes the bypass at the cost of one click.
3. **Views and downloads are no longer audited.** Shares, unshares, deletes, renames, and
   review toggles still are — the record of what a client received is preserved.
4. **A failed audit write no longer blocks the operation.** It logs a warning.

## Testing

- Rewrite `tests/document-security.test.ts` against the new model. The central case: a
  client can read a document if and only if `shared_at` is set or they uploaded it.
- Rewrite `tests/document-workspace.test.ts` for the reduced module.
- Update folder references in `tests/api-route-auth.test.ts`,
  `tests/lite-app-foundations.test.ts`, and `tests/matter-owned-lead-lifecycle.test.ts`.
- Add coverage for the share toggle round trip: PATCH `{shared:true}` sets `shared_at` and
  emits the notification; PATCH `{shared:false}` clears it.
- Verify the three redefined RPCs return correct results against backfilled data before
  dropping `folder`.

## Out of scope

Document versioning (`document_versions`, `lib/documentVersions.ts`), the tracked-changes
and edits API under `app/api/documents/[id]/edits`, the document template system under
`lib/documentTemplates`, and the drafting generation pipeline. None of these depend on
`folder` for visibility and none are part of the sharing model.
