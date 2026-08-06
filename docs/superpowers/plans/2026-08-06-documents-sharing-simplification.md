# Documents & Sharing Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven-folder, four-gate document sharing model with a single `shared_at` column for visibility and an inert `source` column for provenance.

**Architecture:** `matter_documents.folder` currently conflates visibility, provenance, and dead values, and that conflation is duplicated across 8 TypeScript files and 2 RLS policies. We add `shared_at` (the one visibility rule) and `source` (`firm`/`client`/`meeting-notes`, set automatically, gates nothing), migrate every writer and reader onto them while `folder` remains in place as a safety net, then drop `folder`, `folder_id`, and the empty `folders` table in the final task. Every task leaves the app deployable.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres 17), Cloudflare R2, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-06-documents-sharing-simplification-design.md`

**Note on scope discovered during planning:** the spec did not name `app/admin/drafting/[matterId]/ReviewStep.tsx`, but it is a second consumer of the sharing model (it imports `PromoteDocumentDialog`, promotes to `review`, and uploads to `review`). Task 11 covers it. Six test files beyond the three the spec listed also reference folders; Tasks 4, 9, 10, 11, and 13 cover them.

**Commands used throughout:**
- Tests: `npm test` (all) or `npx vitest run tests/<file> -t '<name>'` (one)
- Types: `npm run typecheck`
- Lint: `npm run lint`
- Migrations: `npm run supabase:db:push`

**Database caution:** `supabase_migrations.schema_migrations` is unreliable in this project — it shows phantom-applied rows. After every migration task, verify the actual object state with a direct SQL query, never by reading the migration history table.

---

### Task 1: Add `shared_at` and `source` columns

**Files:**
- Create: `supabase/migrations/20260906000000_documents_shared_at_source.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Splits matter_documents.folder into its two real jobs:
--   shared_at = client visibility (the only enforced rule)
--   source    = provenance, set automatically, gates nothing
-- folder and folder_id remain until the cleanup migration.

alter table public.matter_documents
  add column if not exists shared_at timestamptz,
  add column if not exists source text not null default 'firm';

alter table public.matter_documents
  drop constraint if exists matter_documents_source_check;

alter table public.matter_documents
  add constraint matter_documents_source_check
  check (source in ('firm', 'client', 'meeting-notes'));

update public.matter_documents
  set shared_at = created_at
  where folder in ('review', 'signed', 'final')
    and shared_at is null;

update public.matter_documents
  set source = 'client'
  where folder in ('client', 'intake');

update public.matter_documents
  set source = 'meeting-notes'
  where folder = 'meeting-notes';

create index if not exists matter_documents_matter_shared_idx
  on public.matter_documents (matter_id, shared_at);

create index if not exists matter_documents_matter_source_idx
  on public.matter_documents (matter_id, source);
```

- [ ] **Step 2: Apply the migration**

Run: `npm run supabase:db:push`
Expected: applies `20260906000000_documents_shared_at_source.sql` with no error.

- [ ] **Step 3: Verify the columns exist and the backfill is correct**

Run this SQL against the database directly (Supabase SQL editor or MCP `execute_sql`), not the migration history table:

```sql
select folder, source, count(*) as docs, count(shared_at) as shared
from matter_documents
group by folder, source
order by docs desc;
```

Expected, given the current 102 rows: `draft/firm` → 99 docs, 0 shared; `review/firm` → 3 docs, 3 shared. If any row shows a `source` that disagrees with its `folder`, stop and fix the backfill before continuing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260906000000_documents_shared_at_source.sql
git commit -m "feat(db): add matter_documents.shared_at and source"
```

---

### Task 2: Expose the new columns to TypeScript

**Files:**
- Modify: `lib/queryColumns.ts:1`
- Modify: `types/database.ts:547-568`

- [ ] **Step 1: Add both columns to the shared select list**

Replace the single line in `lib/queryColumns.ts` with:

```ts
export const MATTER_DOCUMENT_COLUMNS = 'id, matter_id, r2_key, name, size, content_type, folder, folder_id, shared_at, source, uploaded_by, created_at, generation_id, generation_engine, marker_count, missing_count, superseded_at, reviewed_at, reviewed_by, current_version_id' as const
```

- [ ] **Step 2: Add both fields to the `MatterDocument` interface**

In `types/database.ts`, inside `export interface MatterDocument`, replace the `folder` and `folder_id` lines with:

```ts
  /** @deprecated Removed in the cleanup migration. Use `shared_at` and `source`. */
  folder: 'draft' | 'final' | 'client' | 'review' | 'signed' | 'intake' | 'meeting-notes'
  /** @deprecated Always null. Removed in the cleanup migration. */
  folder_id: string | null
  /** Set when the document is visible to the client. Null means firm-only. */
  shared_at: string | null
  /** Provenance, written automatically at creation. Never gates anything. */
  source: 'firm' | 'client' | 'meeting-notes'
```

- [ ] **Step 3: Verify types still compile**

Run: `npm run typecheck`
Expected: PASS. Existing code does not reference the new fields yet, and both are non-optional on a type that is always built from a full row select.

- [ ] **Step 4: Commit**

```bash
git add lib/queryColumns.ts types/database.ts
git commit -m "feat(types): expose matter_documents.shared_at and source"
```

---

### Task 3: Dual-write `source` and `shared_at` on every insert path

Every writer sets the new columns alongside `folder`, so readers can switch over safely in later tasks. The `folder` writes are removed in Task 15.

**Files:**
- Modify: `app/api/documents/upload/route.ts:104-119`
- Modify: `app/api/documents/route.ts:68-80`
- Modify: `app/api/documents/[id]/convert-pdf/route.ts:88-98`
- Modify: `app/api/webhooks/esign/route.ts:65-78`
- Modify: `app/api/admin/meeting-notes/route.ts:107-120`
- Modify: `lib/drafting/persistGeneratedDocument.ts:80-92`
- Modify: `lib/intake/promoteIntakeDocuments.ts:25-35`
- Modify: `lib/works/artifacts.ts:78-86`

- [ ] **Step 1: Add a shared source resolver**

Create `lib/documentSource.ts`:

```ts
import type { MatterDocument } from '@/types/database'

export type DocumentSource = MatterDocument['source']

/**
 * Provenance for a newly created document. Written once at creation, never
 * changed, and never used to decide whether a client may see a document —
 * that is `shared_at` alone.
 */
export const DOCUMENT_SOURCES: readonly DocumentSource[] = ['firm', 'client', 'meeting-notes'] as const

export function isDocumentSource(value: unknown): value is DocumentSource {
  return typeof value === 'string' && (DOCUMENT_SOURCES as readonly string[]).includes(value)
}
```

- [ ] **Step 2: Dual-write in the proxy upload route**

In `app/api/documents/upload/route.ts`, the insert currently reads:

```ts
    .insert({
      matter_id: matterId,
      r2_key: r2Key,
      name: file.name,
      size: file.size,
      content_type: contentType,
      folder,
      folder_id: folderId,
      uploaded_by: user.id,
    })
```

Replace with:

```ts
    .insert({
      matter_id: matterId,
      r2_key: r2Key,
      name: file.name,
      size: file.size,
      content_type: contentType,
      folder,
      folder_id: folderId,
      source: isAdmin ? 'firm' : 'client',
      shared_at: isFirmSharedFolder(folder as MatterDocument['folder']) ? new Date().toISOString() : null,
      uploaded_by: user.id,
    })
```

- [ ] **Step 3: Dual-write in the direct-insert route**

In `app/api/documents/route.ts`, add to the `POST` insert object, after `folder_id: folderId,`:

```ts
      source: (await isAdminUser(sb, user)) ? 'firm' : 'client',
      shared_at: ['review', 'signed', 'final'].includes(folder) ? new Date().toISOString() : null,
```

Hoist the admin check above the insert so it is not awaited twice — the route already computes it on line 60; assign it to `const userIsAdmin` there and reuse it in both places.

- [ ] **Step 4: Dual-write in convert-pdf, esign, meeting-notes, and the three lib writers**

`app/api/documents/[id]/convert-pdf/route.ts` — both inserts (the ones with `folder: 'review'`) gain:

```ts
        source: 'firm',
        shared_at: new Date().toISOString(),
```

`app/api/webhooks/esign/route.ts` — the insert with `folder: 'signed'` gains:

```ts
      source: 'firm',
      shared_at: new Date().toISOString(),
```

`app/api/admin/meeting-notes/route.ts` — the insert with `folder: 'meeting-notes'` gains:

```ts
      source: 'meeting-notes',
      shared_at: null,
```

`lib/drafting/persistGeneratedDocument.ts` and `lib/estateClauses/persistGeneratedDocument.ts` — each insert with `folder: 'draft'` gains:

```ts
    source: 'firm',
    shared_at: null,
```

`lib/intake/promoteIntakeDocuments.ts` and `lib/works/artifacts.ts` — each insert with `folder: 'intake'` gains:

```ts
        source: 'client',
        shared_at: null,
```

- [ ] **Step 5: Write a test asserting every writer sets `source`**

Create `tests/document-source-writes.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const WRITERS: Array<{ file: string; source: string }> = [
  { file: 'app/api/documents/upload/route.ts', source: "source: isAdmin ? 'firm' : 'client'" },
  { file: 'app/api/documents/[id]/convert-pdf/route.ts', source: "source: 'firm'" },
  { file: 'app/api/webhooks/esign/route.ts', source: "source: 'firm'" },
  { file: 'app/api/admin/meeting-notes/route.ts', source: "source: 'meeting-notes'" },
  { file: 'lib/drafting/persistGeneratedDocument.ts', source: "source: 'firm'" },
  { file: 'lib/estateClauses/persistGeneratedDocument.ts', source: "source: 'firm'" },
  { file: 'lib/intake/promoteIntakeDocuments.ts', source: "source: 'client'" },
  { file: 'lib/works/artifacts.ts', source: "source: 'client'" },
]

describe('every matter_documents writer sets source', () => {
  for (const { file, source } of WRITERS) {
    it(`${file} sets ${source}`, () => {
      const contents = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(contents).toContain(source)
    })
  }
})
```

- [ ] **Step 6: Run the test and the type check**

Run: `npx vitest run tests/document-source-writes.test.ts`
Expected: 8 passing tests.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/documentSource.ts tests/document-source-writes.test.ts app/api lib
git commit -m "feat(documents): dual-write source and shared_at on all insert paths"
```

---

### Task 4: Rewrite `documentSecurity.ts` around `shared_at`

**Files:**
- Modify: `lib/documentSecurity.ts` (167 → ~90 lines)
- Modify: `tests/document-security.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/document-security.test.ts`, delete the `describe('isClientVisibleDocument')`, `describe('document folder promotion route')`, and `describe('isClientUploadFolder')` blocks entirely, and update the import at the top to:

```ts
import {
  isAdminUser,
  userCanAccessMatter,
  userCanReadDocument,
} from '@/lib/documentSecurity'
```

Then append:

```ts
describe('userCanReadDocument', () => {
  const client = { id: 'client-1', email: 'c@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }

  it('allows an admin to read an unshared document', async () => {
    const sb = stubAdmin({ users: { data: { role: 'attorney' }, error: null } })
    const doc = { matter_id: 'm1', shared_at: null, uploaded_by: 'someone-else' }
    expect(await userCanReadDocument(sb, client, doc)).toBe(true)
  })

  it('denies a client an unshared document they did not upload', async () => {
    const sb = stubAdmin({ users: { data: { role: 'client' }, error: null } })
    const doc = { matter_id: 'm1', shared_at: null, uploaded_by: 'someone-else' }
    expect(await userCanReadDocument(sb, client, doc)).toBe(false)
  })

  it('allows a client an unshared document they uploaded themselves', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [{ data: { id: 'm1' }, error: null }, { data: { id: 'm1' }, error: null }],
      client_intake: { data: null, error: null },
    })
    const doc = { matter_id: 'm1', shared_at: null, uploaded_by: 'client-1' }
    expect(await userCanReadDocument(sb, client, doc)).toBe(true)
  })

  it('allows a client a shared document on a matter they own', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [{ data: { id: 'm1' }, error: null }, { data: { id: 'm1' }, error: null }],
      client_intake: { data: null, error: null },
    })
    const doc = { matter_id: 'm1', shared_at: '2026-08-01T00:00:00Z', uploaded_by: null }
    expect(await userCanReadDocument(sb, client, doc)).toBe(true)
  })
})
```

Note: the `matters` entry is an array because `userCanAccessMatter` queries the `matters` table twice — first for `relationship_status = 'hired'`, then for ownership. The existing `stubAdmin` helper already walks arrays per call.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/document-security.test.ts`
Expected: FAIL — `userCanReadDocument` still takes a `folder`-shaped document and consults the `folders` table.

- [ ] **Step 3: Rewrite the module**

Replace the contents of `lib/documentSecurity.ts` with:

```ts
import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatterDocument } from '@/types/database'

type AuthUser = Pick<User, 'id' | 'email'> & {
  email_confirmed_at?: string | null
}

export async function isAdminUser(
  admin: SupabaseClient,
  user: Pick<User, 'id' | 'email'> | null | undefined,
): Promise<boolean> {
  if (!user) return false
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return !!profile && ['attorney', 'admin'].includes(profile.role)
}

export async function userCanAccessMatter(
  admin: SupabaseClient,
  user: AuthUser,
  matterId: string,
) {
  const { data: eligibleMatter } = await admin
    .from('matters')
    .select('id')
    .eq('id', matterId)
    .eq('relationship_status', 'hired')
    .maybeSingle()
  if (!eligibleMatter) return false
  if (await isAdminUser(admin, user)) return true

  const [{ data: matter }, { data: intake }] = await Promise.all([
    admin
      .from('matters')
      .select('id')
      .eq('id', matterId)
      .eq('client_id', user.id)
      .maybeSingle(),
    admin
      .from('client_intake')
      .select('matter_id')
      .eq('matter_id', matterId)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (matter || intake) return true

  // Pre-conversion fallback: a matter created from a lead may not yet have
  // client_id wired up. Match on the verified auth email and opportunistically
  // backfill client_id so subsequent reads use the auth.uid path above.
  if (!user.email || !user.email_confirmed_at) return false

  const { data: pipelineMatter } = await admin
    .from('v_matter_pipeline')
    .select('matter_id, client_email')
    .eq('matter_id', matterId)
    .eq('client_email', user.email)
    .maybeSingle()

  if (!pipelineMatter) return false

  await admin
    .from('matters')
    .update({ client_id: user.id })
    .eq('id', matterId)
    .is('client_id', null)

  return true
}

/**
 * The entire client visibility rule: a non-admin may read a document if the
 * firm shared it, or if they uploaded it themselves — and in either case only
 * on a matter they can access.
 */
export async function userCanReadDocument(
  admin: SupabaseClient,
  user: AuthUser,
  doc: Pick<MatterDocument, 'matter_id' | 'shared_at' | 'uploaded_by'>,
) {
  if (await isAdminUser(admin, user)) return true
  const ownUpload = doc.uploaded_by === user.id
  if (!doc.shared_at && !ownUpload) return false
  return userCanAccessMatter(admin, user, doc.matter_id)
}

// 'convert' | 'edit' | 'version' belong to the versioning and tracked-changes
// routes, which are out of scope for this change. 'view', 'download',
// 'folder_change', and 'export' are gone.
type AuditAction =
  | 'share'
  | 'unshare'
  | 'delete'
  | 'rename'
  | 'review'
  | 'convert'
  | 'edit'
  | 'version'

/**
 * Records what the firm did to a document. Best-effort: a failed write is
 * logged and the operation proceeds. The record exists so the firm can
 * reconstruct what a client received, not as an access-control mechanism.
 */
export async function auditDocumentAccess(
  admin: SupabaseClient,
  user: Pick<User, 'id' | 'email'>,
  doc: Pick<MatterDocument, 'id' | 'matter_id'>,
  action: AuditAction,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('document_access_audit').insert({
    document_id: doc.id,
    matter_id: doc.matter_id,
    user_id: user.id,
    user_email: user.email ?? null,
    action,
    metadata,
  })
  if (error) console.warn('document_access_audit insert failed:', error.message)
}
```

- [ ] **Step 4: Narrow the audit action union on the row type**

In `types/database.ts`, replace the `action` union inside `DocumentAccessAudit` with:

```ts
  action:
    | 'share'
    | 'unshare'
    | 'delete'
    | 'rename'
    | 'review'
    | 'convert'
    | 'edit'
    | 'version'
```

- [ ] **Step 5: Update the six other `auditDocumentAccess` callers**

`auditDocumentAccess` no longer returns `{ ok }`, so every `if (!audit.ok)` block is now a type error. Five of these routes audit plain reads, which we are dropping entirely.

Delete the whole `const audit = await auditDocumentAccess(...)` call **and** its `if (!audit.ok)` block from:

- `app/api/documents/[id]/preview/route.ts:43-52` (action `'view'`)
- `app/api/documents/[id]/docx/route.ts:35-41` (action `'view'`)
- `app/api/documents/[id]/tracked-change-ids/route.ts:31-36` (action `'view'`)
- `app/api/documents/bulk-download/route.ts:73-84` (action `'download'`)
- `app/api/documents/combine/route.ts:96-107` (action `'download'`)

In `app/api/documents/[id]/versions/route.ts:26-31`, keep the audit call — `'version'` survives — but unwrap it:

```ts
  await auditDocumentAccess(sb, user, doc, 'version', {
    route: '/api/documents/[id]/versions',
  })
```

Apply the same unwrap to `app/api/documents/[id]/convert-pdf/route.ts` (action `'convert'`), `app/api/documents/[id]/edits/route.ts`, `app/api/documents/[id]/edits/resolve-all/route.ts`, and `app/api/documents/[id]/edits/[editId]/_resolve.ts` (action `'edit'`): drop `const audit = ` and delete the following `if (!audit.ok)` block, leaving a bare `await auditDocumentAccess(...)`.

After this step the only file still containing `audit.ok` / `audit_failed` is
`app/api/documents/[id]/route.ts`, which has five more such sites. Leave it alone — Task 6
replaces that file wholesale, and its `'folder_change'` audit becomes `'share'`/`'unshare'`
there. The grep comes back clean after Task 6, not after this task.

- [ ] **Step 6: Run the tests and check the audit surface**

Run: `npx vitest run tests/document-security.test.ts`
Expected: PASS.

Run: `grep -rn --include="*.ts" "audit.ok\|audit_failed" app lib`
Expected: no matches.

`npm run typecheck` will still report errors in `lib/queries/portal.ts`, `app/api/documents/route.ts`, and `app/api/documents/upload/route.ts`, which import the three deleted helpers. Those are fixed in Tasks 5 and 7. Either accept a transient red typecheck across these commits on this branch, or hold the commits and land Tasks 4–7 as one.

- [ ] **Step 7: Commit**

```bash
git add lib/documentSecurity.ts types/database.ts tests/document-security.test.ts app/api/documents
git commit -m "refactor(documents): security helpers key on shared_at, audit is best-effort"
```

---

### Task 5: Switch every reader onto `shared_at` / `source`

**Files:**
- Modify: `lib/queries/portal.ts:18-54`
- Modify: `app/api/documents/route.ts:12-41`
- Modify: `lib/documents.ts:299-312`
- Modify: `lib/queries/drafting.ts:169`, `:404`
- Modify: `app/admin/drafting/[matterId]/page.tsx:26`
- Modify: `app/api/admin/matters/[id]/assistant/route.ts:51`
- Modify: `app/api/admin/matters/[id]/draft/route.ts:514`
- Modify: `lib/matter/unreviewedUploads.ts:58`, `:123`
- Modify: `app/admin/matters/[id]/MatterPortalUploadsCard.tsx:53`
- Modify: `app/admin/matters/[id]/MatterMeetingNotesCard.tsx:46`

- [ ] **Step 1: Rewrite the two portal queries**

In `lib/queries/portal.ts`, delete the two imports at the top:

```ts
import { isClientPortalFirmDocument } from '@/lib/documentSharing'
import { filterClientVisibleDocuments } from '@/lib/documentSecurity'
```

Replace `fetchSharedDocuments` and `fetchClientUploads` with:

```ts
/** Everything the firm has shared with the client, newest first. */
export async function fetchSharedDocuments(matterId: string): Promise<MatterDocument[]> {
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .not('shared_at', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchSharedDocuments error:', error)
    return []
  }
  return (data ?? []) as MatterDocument[]
}

/** Documents the client uploaded themselves. */
export async function fetchClientUploads(
  matterId: string,
  userId: string,
): Promise<MatterDocument[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .eq('source', 'client')
    .eq('uploaded_by', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchClientUploads error:', error)
    return []
  }
  return (data ?? []) as MatterDocument[]
}
```

- [ ] **Step 2: Rewrite the list route**

In `app/api/documents/route.ts`, change the import block to:

```ts
import { isAdminUser, userCanAccessMatter } from '@/lib/documentSecurity'
```

Replace the body of `GET` between the matter-access check and the `POST` function with:

```ts
  const source = searchParams.get('source')
  let query = sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
  if (source) query = query.eq('source', source)
  if (!(await isAdminUser(sb, user))) {
    query = query.or(`shared_at.not.is.null,uploaded_by.eq.${user.id}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: data ?? [] })
```

Also change the `const folder = searchParams.get('folder')` line to be removed, and in `POST` replace the `isClientUploadFolder(folder)` guard with `folder !== 'client'` for now — Task 7 removes the `folder` parameter from this route entirely.

- [ ] **Step 3: Change the client-side list helper to take a source**

In `lib/documents.ts`, replace `listDocuments`:

```ts
/** List documents for a matter, optionally filtered by provenance. */
export async function listDocuments(
  matterId: string,
  source?: MatterDocument['source'],
): Promise<MatterDocument[]> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const params = new URLSearchParams({ matterId })
  if (source) params.set('source', source)

  const res = await fetch(`/api/documents?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const { documents } = await res.json()
  return documents ?? []
}
```

- [ ] **Step 4: Update the remaining folder-keyed reads**

Apply each of these one-line substitutions:

| File:line | From | To |
|---|---|---|
| `lib/queries/drafting.ts:169` | `.eq('folder', 'draft')` | `.eq('source', 'firm')` |
| `lib/queries/drafting.ts:404` | `.eq('folder', 'draft')` | `.eq('source', 'firm')` |
| `app/api/admin/matters/[id]/assistant/route.ts:51` | `.eq('folder', 'draft')` | `.eq('source', 'firm')` |
| `app/api/admin/matters/[id]/draft/route.ts:514` | `.eq('folder', 'draft')` | `.eq('source', 'firm')` |
| `app/admin/drafting/[matterId]/page.tsx:26` | `.eq('folder', 'review')` | `.not('shared_at', 'is', null)` |
| `lib/matter/unreviewedUploads.ts:58` | `.eq('folder', 'client')` | `.eq('source', 'client')` |
| `lib/matter/unreviewedUploads.ts:123` | `.eq('folder', 'client')` | `.eq('source', 'client')` |
| `app/admin/matters/[id]/MatterPortalUploadsCard.tsx:53` | `listDocuments(matterId, 'client')` | `listDocuments(matterId, 'client')` — unchanged text, now means source |
| `app/admin/matters/[id]/MatterMeetingNotesCard.tsx:46` | `listDocuments(matterId, 'meeting-notes')` | unchanged text, now means source |

The last two need no edit: the string arguments happen to match the new `source` values. Verify by reading each line rather than assuming.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: remaining errors only in `app/api/documents/[id]/route.ts`, `app/api/documents/upload/route.ts`, and files importing `documentSharing` — all fixed in Tasks 6–7.

Run: `npx vitest run tests/document-security.test.ts tests/document-source-writes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/queries app/api lib/documents.ts lib/matter app/admin
git commit -m "refactor(documents): read visibility from shared_at and provenance from source"
```

---

### Task 6: Replace the folder PATCH with a share toggle

**Files:**
- Modify: `app/api/documents/[id]/route.ts` (303 → ~150 lines)
- Modify: `lib/documents.ts:214-255`
- Modify: `tests/document-security.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/document-security.test.ts`:

```ts
describe('document share route', () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'app/api/documents/[id]/route.ts'),
    'utf8',
  )

  it('accepts a shared flag and audits share/unshare', () => {
    expect(routeSource).toContain('const isShareToggle = typeof shared === \'boolean\'')
    expect(routeSource).toContain("shared ? 'share' : 'unshare'")
    expect(routeSource).toContain('shared_at: shared ? new Date().toISOString() : null')
  })

  it('has no sharing gates left', () => {
    expect(routeSource).not.toContain('confirmed')
    expect(routeSource).not.toContain('canPromoteDraft')
    expect(routeSource).not.toContain('wordDocShareBlockReason')
    expect(routeSource).not.toContain('pdf_required')
  })

  it('does not audit plain reads or fail closed on audit errors', () => {
    expect(routeSource).not.toContain('audit_failed')
    expect(routeSource).not.toContain('if (!audit.ok)')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/document-security.test.ts -t 'document share route'`
Expected: FAIL — the route still implements the folder/confirm model.

- [ ] **Step 3: Rewrite the route**

Replace the contents of `app/api/documents/[id]/route.ts` with:

```ts
import { NextResponse, after } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { auditDocumentAccess, isAdminUser, userCanReadDocument } from '@/lib/documentSecurity'
import { notifyClientOfSharedDocument } from '@/lib/portalNotifications'

// GET /api/documents/[id]  →  { url: signedDownloadUrl, document: MatterDocument }
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const sb = getAdminClient()
  const { data: doc, error } = await sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(await userCanReadDocument(sb, user, doc))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const r2 = getR2Client()
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }),
    { expiresIn: 300 },
  )
  return NextResponse.json({ url, document: doc })
}

// PATCH /api/documents/[id]
//
// Three modes, all attorney-only:
//   { shared: boolean }   toggle client visibility
//   { name: string }      rename
//   { reviewed: boolean } informational review marker (gates nothing)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { shared, reviewed, name } = (await req.json()) as {
    shared?: boolean
    reviewed?: boolean
    name?: string
  }

  const isShareToggle = typeof shared === 'boolean'
  const isReviewToggle = typeof reviewed === 'boolean'
  const isRename = typeof name === 'string'
  if (!isShareToggle && !isReviewToggle && !isRename) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing, error: loadError } = await sb
    .from('matter_documents')
    .select('id, matter_id, name, shared_at')
    .eq('id', id)
    .single()
  if (loadError || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isShareToggle) {
    const wasShared = existing.shared_at !== null
    const { data, error: shareErr } = await sb
      .from('matter_documents')
      .update({ shared_at: shared ? new Date().toISOString() : null })
      .eq('id', id)
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()
    if (shareErr) return NextResponse.json({ error: shareErr.message }, { status: 500 })

    await auditDocumentAccess(sb, user, data, shared ? 'share' : 'unshare', {
      document_name: data.name,
    })

    if (shared && !wasShared) {
      after(() => notifyClientOfSharedDocument(data.matter_id, data.name))
    }
    return NextResponse.json({ document: data })
  }

  if (isReviewToggle) {
    const { data, error: reviewErr } = await sb
      .from('matter_documents')
      .update({
        reviewed_at: reviewed ? new Date().toISOString() : null,
        reviewed_by: reviewed ? user.id : null,
      })
      .eq('id', id)
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()
    if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 })

    await auditDocumentAccess(sb, user, data, 'review', { reviewed, document_name: data.name })
    return NextResponse.json({ document: data })
  }

  const trimmed = (name ?? '').trim()
  if (!trimmed) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (trimmed === existing.name) return NextResponse.json({ document: existing })

  const { data, error: renameErr } = await sb
    .from('matter_documents')
    .update({ name: trimmed })
    .eq('id', id)
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()
  if (renameErr) return NextResponse.json({ error: renameErr.message }, { status: 500 })

  await auditDocumentAccess(sb, user, data, 'rename', {
    previous_name: existing.name,
    document_name: trimmed,
  })
  return NextResponse.json({ document: data })
}

// DELETE /api/documents/[id]  →  audit, delete DB row, then best-effort R2 delete
//
// Order matters: the DB row goes first so a partial failure leaves an orphaned
// R2 object (invisible to the app, costs only storage) rather than a ghost row
// pointing at nothing.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: doc, error } = await sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditDocumentAccess(sb, user, doc, 'delete', {
    document_name: doc.name,
    r2_key: doc.r2_key,
    was_shared: doc.shared_at !== null,
  })

  const { error: dbError } = await sb.from('matter_documents').delete().eq('id', id)
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  const r2 = getR2Client()
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }))
  } catch (e) {
    console.error('R2 delete error (object orphaned, will need GC):', e)
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Replace the client-side folder helper with a share helper**

In `lib/documents.ts`, delete `updateDocumentFolder` entirely and add in its place:

```ts
/** Show or hide a document in the client portal. */
export async function setDocumentShared(
  docId: string,
  shared: boolean,
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ shared }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Failed to update sharing')
  }
  const { document } = await res.json()
  return document as MatterDocument
}
```

Leave `setDocumentReviewed` and `renameDocument` as they are — both still work against the rewritten PATCH.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/document-security.test.ts`
Expected: PASS, including the three new `document share route` cases.

- [ ] **Step 6: Commit**

```bash
git add app/api/documents/\[id\]/route.ts lib/documents.ts tests/document-security.test.ts
git commit -m "feat(documents): replace folder promotion with a share toggle, drop all gates"
```

---

### Task 7: Drop the folder parameter from the upload routes

**Files:**
- Modify: `app/api/documents/upload/route.ts`
- Modify: `app/api/documents/upload-url/route.ts`
- Modify: `app/api/documents/route.ts` (`POST`)
- Modify: `lib/documents.ts:36-83`

- [ ] **Step 1: Rewrite the proxy upload route**

In `app/api/documents/upload/route.ts`: delete the `VALID_FOLDERS` constant, the `folder`/`folderIdRaw`/`folderId` form reads, the folder validation block, the `pdfRequiredUploadReason` block, and the `isFirmSharedFolder` notification block. Change the import block to:

```ts
import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAdminUser, userCanAccessMatter } from '@/lib/documentSecurity'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  inferContentType,
  putFileToR2,
  safeUploadFilename,
} from '@/lib/documentUpload'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
```

Replace the R2 key construction and the insert with:

```ts
  const isAdmin = await isAdminUser(admin, user)
  const source = isAdmin ? 'firm' : 'client'

  const timestamp = Date.now()
  const safeFilename = safeUploadFilename(file.name)
  const r2Key = `matters/${matterId}/${source}/${timestamp}-${safeFilename}`
```

and

```ts
    .insert({
      matter_id: matterId,
      r2_key: r2Key,
      name: file.name,
      size: file.size,
      content_type: contentType,
      folder: isAdmin ? 'draft' : 'client',
      source,
      shared_at: null,
      uploaded_by: user.id,
    })
```

The `folder` value is a transitional placeholder that satisfies the not-null column until Task 15 drops it. Uploads always land unshared; the attorney flips the toggle.

Keep unchanged: the auth check, `userCanAccessMatter`, the size bound, the MIME check, and the matter-closed check.

- [ ] **Step 2: Apply the same shape to `upload-url` and the direct-insert POST**

In `app/api/documents/upload-url/route.ts`, delete the `VALID_FOLDERS` constant and the folder validation, derive `source` the same way, and build the key as `matters/${matterId}/${source}/...`.

In `app/api/documents/route.ts` `POST`, replace the destructure and the guards:

```ts
  const { matterId, r2Key, name, size, contentType } = await req.json()
  if (!matterId || !r2Key || !name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const sb = getAdminClient()
  if (!(await userCanAccessMatter(sb, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userIsAdmin = await isAdminUser(sb, user)
  const source = userIsAdmin ? 'firm' : 'client'
  if (!r2Key.startsWith(`matters/${matterId}/${source}/`)) {
    return NextResponse.json({ error: 'Invalid document key' }, { status: 400 })
  }
```

and the insert object's `folder`/`folder_id` lines with:

```ts
      folder: userIsAdmin ? 'draft' : 'client',
      source,
      shared_at: null,
```

- [ ] **Step 3: Drop the folder parameters from the client helper**

In `lib/documents.ts`, replace the `uploadDocument` signature and form construction:

```ts
/** Upload a file via the app proxy (R2 + DB). Returns the new MatterDocument. */
export async function uploadDocument(
  file: File,
  matterId: string,
  onProgress?: (pct: number) => void,
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const form = new FormData()
  form.append('file', file)
  form.append('matterId', matterId)
```

Leave the rest of the function body (the `XMLHttpRequest` block) unchanged.

- [ ] **Step 4: Update the three call sites**

| File:line | From | To |
|---|---|---|
| `app/(portal)/documents/ClientUploadCard.tsx:48` | `uploadDocument(file, matterId, 'client', (pct) => setProgress(pct))` | `uploadDocument(file, matterId, (pct) => setProgress(pct))` |
| `app/admin/drafting/[matterId]/ReviewStep.tsx:335` | `uploadDocument(file, matterId, 'review')` | `uploadDocument(file, matterId)` |
| `app/admin/matters/[id]/MatterDocumentsTab.tsx:313` | `uploadDocument(file, matterId, uploadFolder)` | `uploadDocument(file, matterId)` |

`MatterDocumentsTab.tsx` is fully rewritten in Task 10; make the minimal edit here so the tree compiles.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: remaining errors only where `documentSharing`, `reviewGate`, or `PromoteDocumentDialog` are still imported — `lib/documentWorkspace.ts`, `MatterDocumentsTab.tsx`, `ReviewStep.tsx`. Tasks 9–11 clear these.

Run: `npx vitest run tests/document-source-writes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/documents lib/documents.ts app/\(portal\)/documents app/admin
git commit -m "feat(documents): uploads derive source from role, no folder parameter"
```

---

### Task 8: Stop convert-pdf from auto-sharing

**Files:**
- Modify: `app/api/documents/[id]/convert-pdf/route.ts:88-130`
- Modify: `app/admin/drafting/[matterId]/ReviewStep.tsx:386`
- Modify: `tests/esign.test.ts:200`

- [ ] **Step 1: Write the failing test**

Create `tests/convert-pdf-unshared.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('convert-pdf', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/documents/[id]/convert-pdf/route.ts'),
    'utf8',
  )

  it('creates the PDF unshared so the attorney chooses when to share', () => {
    expect(source).toContain('shared_at: null')
    expect(source).not.toContain("folder: 'review'")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/convert-pdf-unshared.test.ts`
Expected: FAIL — the route still writes `folder: 'review'` and a non-null `shared_at` from Task 3.

- [ ] **Step 3: Change both inserts**

In `app/api/documents/[id]/convert-pdf/route.ts`, both insert objects change from:

```ts
        folder: 'review',
        source: 'firm',
        shared_at: new Date().toISOString(),
```

to:

```ts
        folder: 'draft',
        source: 'firm',
        shared_at: null,
```

- [ ] **Step 4: Correct the success toast**

In `app/admin/drafting/[matterId]/ReviewStep.tsx`, replace:

```ts
      toast.success('PDF created in Review folder')
```

with:

```ts
      toast.success('PDF created — use the share toggle to send it to the client')
```

- [ ] **Step 5: Update the e-sign assertion**

In `tests/esign.test.ts:200`, replace:

```ts
    expect(source).toContain("folder: 'signed'")
```

with:

```ts
    expect(source).toContain("source: 'firm'")
    expect(source).toContain('shared_at: new Date().toISOString()')
```

The e-sign webhook keeps sharing automatically — a countersigned document should reach the client without a second step.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/convert-pdf-unshared.test.ts tests/esign.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/documents/\[id\]/convert-pdf app/admin/drafting tests
git commit -m "fix(documents): convert-pdf no longer silently publishes to the client portal"
```

---

### Task 9: Slim `documentWorkspace.ts`

**Files:**
- Modify: `lib/documentWorkspace.ts` (177 → ~45 lines)
- Modify: `tests/document-workspace.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/document-workspace.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildDocumentStatusBadges,
  documentFileType,
  isDocumentPdf,
  isDocumentWord,
  isDocumentShared,
} from '@/lib/documentWorkspace'
import type { MatterDocument } from '@/types/database'

function doc(overrides: Partial<MatterDocument>): MatterDocument {
  return {
    id: 'doc-1',
    matter_id: 'matter-1',
    r2_key: 'documents/doc-1',
    name: 'Trust.pdf',
    size: 1024,
    content_type: 'application/pdf',
    folder: 'draft',
    folder_id: null,
    shared_at: null,
    source: 'firm',
    uploaded_by: null,
    created_at: '2026-08-06T00:00:00Z',
    ...overrides,
  }
}

describe('document workspace helpers', () => {
  it('detects Word and PDF files', () => {
    expect(isDocumentPdf(doc({ name: 'Plan.pdf' }))).toBe(true)
    expect(isDocumentWord(doc({ name: 'Plan.docx', content_type: 'application/octet-stream' }))).toBe(true)
    expect(documentFileType(doc({ name: 'notes.txt', content_type: 'text/plain' }))).toBe('other')
  })

  it('reads sharing from shared_at alone', () => {
    expect(isDocumentShared(doc({ shared_at: null }))).toBe(false)
    expect(isDocumentShared(doc({ shared_at: '2026-08-06T00:00:00Z' }))).toBe(true)
  })

  it('badges a shared document and a client upload', () => {
    expect(buildDocumentStatusBadges(doc({ shared_at: '2026-08-06T00:00:00Z' })))
      .toContainEqual({ label: 'Shared', tone: 'success' })
    expect(buildDocumentStatusBadges(doc({ source: 'client' })))
      .toContainEqual({ label: 'Client upload', tone: 'info' })
  })

  it('badges marker and missing counts', () => {
    const badges = buildDocumentStatusBadges(doc({ marker_count: 2, missing_count: 1 }))
    expect(badges).toContainEqual({ label: '2 markers', tone: 'danger' })
    expect(badges).toContainEqual({ label: '1 missing', tone: 'warning' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/document-workspace.test.ts`
Expected: FAIL — `isDocumentShared` does not exist and the module still imports `reviewGate`.

- [ ] **Step 3: Replace the module**

Replace the contents of `lib/documentWorkspace.ts` with:

```ts
import { isPdfDocument, isWordDocument } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

export type FileTypeFilter = 'all' | 'pdf' | 'word' | 'other'

export interface DocumentBadgeModel {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}

type DocFile = Pick<MatterDocument, 'name'> & { content_type?: string | null }

export function isDocumentPdf(doc: DocFile) {
  return isPdfDocument(doc.name, doc.content_type)
}

export function isDocumentWord(doc: DocFile) {
  return isWordDocument(doc.name, doc.content_type)
}

export function documentFileType(doc: DocFile): Exclude<FileTypeFilter, 'all'> {
  if (isDocumentPdf(doc)) return 'pdf'
  if (isDocumentWord(doc)) return 'word'
  return 'other'
}

/** The whole visibility rule. */
export function isDocumentShared(doc: Pick<MatterDocument, 'shared_at'>) {
  return doc.shared_at !== null
}

export function buildDocumentStatusBadges(doc: MatterDocument): DocumentBadgeModel[] {
  const badges: DocumentBadgeModel[] = []

  if (isDocumentShared(doc)) badges.push({ label: 'Shared', tone: 'success' })
  if (doc.source === 'client') badges.push({ label: 'Client upload', tone: 'info' })
  if (doc.generation_id) badges.push({ label: 'Generated', tone: 'info' })
  if (doc.reviewed_at) badges.push({ label: 'Reviewed', tone: 'success' })
  if (typeof doc.marker_count === 'number' && doc.marker_count > 0) {
    badges.push({ label: `${doc.marker_count} marker${doc.marker_count === 1 ? '' : 's'}`, tone: 'danger' })
  }
  if (typeof doc.missing_count === 'number' && doc.missing_count > 0) {
    badges.push({ label: `${doc.missing_count} missing`, tone: 'warning' })
  }
  if (doc.superseded_at) badges.push({ label: 'Superseded', tone: 'warning' })

  return badges
}
```

Deleted from this module: `DOCUMENT_FOLDERS`, `FIRM_SHARED_FOLDERS`, `INTERNAL_DOCUMENT_FOLDERS`, `CLIENT_UPLOAD_FOLDERS`, `INTAKE_DOCUMENT_FOLDERS`, `DEFAULT_SHARE_FOLDER`, `DEFAULT_UNSHARE_FOLDER`, `documentFolderLabel`, `documentFolderDescription`, `classifyDocumentVisibility`, `isFirmSharedDocument`, `getDocumentShareEligibility`, `buildSelectedDocumentEligibility`, and the `Versioned` badge.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/document-workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/documentWorkspace.ts tests/document-workspace.test.ts
git commit -m "refactor(documents): documentWorkspace loses folder and eligibility logic"
```

---

### Task 10: Rewrite the matter documents tab

**Files:**
- Modify: `app/admin/matters/[id]/MatterDocumentsTab.tsx` (955 → ~350 lines)
- Modify: `tests/matter-documents-tab.test.ts`

- [ ] **Step 1: Rewrite the test**

Replace the contents of `tests/matter-documents-tab.test.ts` with:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const matterRoute = path.join(process.cwd(), 'app/admin/matters/[id]')
const tabPath = path.join(matterRoute, 'MatterDocumentsTab.tsx')
const clientPath = path.join(matterRoute, 'MatterDetailClient.tsx')

describe('matter documents tab', () => {
  it('is wired into the matter page', () => {
    const client = readFileSync(clientPath, 'utf8')
    expect(client).toContain("import { MatterDocumentsTab } from './MatterDocumentsTab'")
    expect(client).toContain('<MatterDocumentsTab')
    expect(client).toContain('documents={documents}')
    expect(client).toContain('onDocumentsChanged={loadDocuments}')
  })

  it('shares with a toggle and keeps the surviving document actions', () => {
    const source = readFileSync(tabPath, 'utf8')

    for (const helper of [
      'setDocumentShared',
      'deleteDocument',
      'downloadDocumentsZip',
      'getDocumentAuditEvents',
      'getDocumentViewerUrl',
      'getDocumentUrl',
      'renameDocument',
      'uploadDocument',
    ]) {
      expect(source).toContain(helper)
    }

    for (const label of [
      'Upload',
      'Download selected',
      'Share',
      'Unshare',
      'Combine Word documents',
      'View',
      'Download',
      'Rename',
      'History',
      'Delete',
      'From client',
    ]) {
      expect(source).toContain(label)
    }

    expect(source).toContain('DocumentStatusBadges')
    expect(source).toContain('DocumentPreviewDialog')
    expect(source).toContain('CombineWordDraftsDialog')
    expect(source).toContain('unreviewedUploadCounts')
    expect(source).toContain('onReviewPortalUploads')
  })

  it('has no folder machinery left', () => {
    const source = readFileSync(tabPath, 'utf8')
    expect(source).not.toContain('PromoteDocumentDialog')
    expect(source).not.toContain('activeFolder')
    expect(source).not.toContain('folderSummaries')
    expect(source).not.toContain('Bulk move')
    expect(source).not.toContain('updateDocumentFolder')
    expect(source).not.toContain('getDocumentShareEligibility')
    expect(source).not.toContain('visibilityFilter')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/matter-documents-tab.test.ts`
Expected: FAIL on `setDocumentShared` and on the folder-machinery assertions.

- [ ] **Step 3: Replace the component**

Replace the contents of `app/admin/matters/[id]/MatterDocumentsTab.tsx` with:

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Combine,
  Download,
  Eye,
  FileSearch,
  FileText,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Share2,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CombineWordDraftsDialog } from '@/components/drafting/CombineWordDraftsDialog'
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog'
import { DocumentStatusBadges } from '@/components/documents/DocumentStatusBadges'
import {
  buildDocumentStatusBadges,
  isDocumentPdf,
  isDocumentShared,
  isDocumentWord,
} from '@/lib/documentWorkspace'
import {
  deleteDocument,
  downloadDocumentsZip,
  getDocumentAuditEvents,
  getDocumentUrl,
  getDocumentViewerUrl,
  renameDocument,
  setDocumentShared,
  uploadDocument,
} from '@/lib/documents'
import { cn, formatDateTime } from '@/lib/utils'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import type { DocumentAccessAudit, MatterDocument } from '@/types/database'
import { documentDisplayTitle } from '@/lib/documentDisplayTitle'

type Scope = 'all' | 'shared' | 'client'

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function auditLabel(event: DocumentAccessAudit) {
  if (event.action === 'share') return 'Shared with client'
  if (event.action === 'unshare') return 'Unshared'
  if (event.action === 'rename') return 'Renamed'
  if (event.action === 'review') return 'Review state changed'
  if (event.action === 'delete') return 'Deleted'
  return event.action
}

interface MatterDocumentsTabProps {
  matterId: string
  documents: MatterDocument[]
  loading: boolean
  onDocumentsChanged: () => void | Promise<void>
  unreviewedUploadCounts?: UnreviewedUploadCounts
  onReviewPortalUploads?: () => void | Promise<void>
  onReviewIntakeUploads?: () => void | Promise<void>
  clientName?: string | null
  deepLinkedDocumentId?: string | null
  recordLabel?: 'matter' | 'lead'
}

export function MatterDocumentsTab({
  matterId,
  documents,
  loading,
  onDocumentsChanged,
  unreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
  onReviewPortalUploads,
  onReviewIntakeUploads,
  clientName,
  deepLinkedDocumentId,
  recordLabel = 'matter',
}: MatterDocumentsTabProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renameTarget, setRenameTarget] = useState<MatterDocument | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<MatterDocument | null>(null)
  const [previewTarget, setPreviewTarget] = useState<MatterDocument | null>(null)
  const [combineOpen, setCombineOpen] = useState(false)
  const [auditTarget, setAuditTarget] = useState<MatterDocument | null>(null)
  const [auditEvents, setAuditEvents] = useState<DocumentAccessAudit[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(null)

  useEffect(() => {
    if (!deepLinkedDocumentId) return
    const target = documents.find(candidate => candidate.id === deepLinkedDocumentId)
    if (!target) return
    setScope('all')
    setQuery('')
    setHighlightedDocumentId(target.id)
    const scrollTimer = window.setTimeout(() => {
      window.document.getElementById(`document-row-${target.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 0)
    const highlightTimer = window.setTimeout(() => setHighlightedDocumentId(null), 2500)
    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [deepLinkedDocumentId, documents])

  // Meeting notes have their own card on the matter page.
  const visibleDocuments = useMemo(
    () => documents.filter(doc => doc.source !== 'meeting-notes'),
    [documents],
  )

  const counts = useMemo(() => ({
    all: visibleDocuments.length,
    shared: visibleDocuments.filter(isDocumentShared).length,
    client: visibleDocuments.filter(doc => doc.source === 'client').length,
  }), [visibleDocuments])

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return visibleDocuments.filter(doc => {
      if (scope === 'shared' && !isDocumentShared(doc)) return false
      if (scope === 'client' && doc.source !== 'client') return false
      if (normalized && !doc.name.toLowerCase().includes(normalized)) return false
      return true
    })
  }, [query, scope, visibleDocuments])

  const selectedDocuments = useMemo(
    () => visibleDocuments.filter(doc => selectedIds.has(doc.id)),
    [visibleDocuments, selectedIds],
  )
  const selectedCombinableDocs = useMemo(
    () => selectedDocuments
      .filter(doc => isDocumentWord(doc) && doc.name.toLowerCase().endsWith('.docx'))
      .map(doc => ({ id: doc.id, name: doc.name })),
    [selectedDocuments],
  )

  const allVisibleSelected =
    filteredDocuments.length > 0 && filteredDocuments.every(doc => selectedIds.has(doc.id))

  const refresh = async () => {
    await onDocumentsChanged()
  }

  const toggleSelected = (docId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(docId)
      else next.delete(docId)
      return next
    })
  }

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const doc of filteredDocuments) {
        if (checked) next.add(doc.id)
        else next.delete(doc.id)
      }
      return next
    })
  }

  const openDocument = async (doc: MatterDocument, action: 'view' | 'download') => {
    setBusy(`${action}:${doc.id}`)
    try {
      const url = action === 'view'
        ? await getDocumentViewerUrl(doc.id, doc.name, doc.content_type)
        : await getDocumentUrl(doc.id, 'download')
      if (action === 'view') {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
      }
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = doc.name
      anchor.click()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load document')
    } finally {
      setBusy(null)
    }
  }

  const handleShare = async (docs: MatterDocument[], shared: boolean) => {
    if (docs.length === 0) return
    setBusy(shared ? 'share' : 'unshare')
    try {
      for (const doc of docs) {
        await setDocumentShared(doc.id, shared)
      }
      const verb = shared ? 'Shared' : 'Unshared'
      toast.success(`${verb} ${docs.length} document${docs.length === 1 ? '' : 's'}`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update sharing')
    } finally {
      setBusy(null)
    }
  }

  const handleDownloadSelected = async () => {
    if (selectedDocuments.length === 0) return
    setBusy('bulk-download')
    try {
      await downloadDocumentsZip(selectedDocuments.map(doc => doc.id))
      toast.success(`Downloaded ${selectedDocuments.length} document${selectedDocuments.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download selected documents')
    } finally {
      setBusy(null)
    }
  }

  const handleUpload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadDocument(file, matterId)
      toast.success(`Uploaded ${file.name}`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload document')
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  const handleRename = async () => {
    const doc = renameTarget
    const nextName = renameValue.trim()
    if (!doc || !nextName) return
    setBusy(`rename:${doc.id}`)
    try {
      await renameDocument(doc.id, nextName)
      toast.success('Document renamed')
      setRenameTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename document')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    const doc = deleteTarget
    if (!doc) return
    setBusy(`delete:${doc.id}`)
    try {
      await deleteDocument(doc.id)
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(doc.id)
        return next
      })
      toast.success('Document deleted')
      setDeleteTarget(null)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete document')
    } finally {
      setBusy(null)
    }
  }

  const openAudit = async (doc: MatterDocument) => {
    setAuditTarget(doc)
    setAuditLoading(true)
    try {
      setAuditEvents(await getDocumentAuditEvents({ matterId, documentId: doc.id }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load history')
      setAuditEvents([])
    } finally {
      setAuditLoading(false)
    }
  }

  const scopes: Array<{ value: Scope; label: string; count: number }> = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'shared', label: 'Shared', count: counts.shared },
    { value: 'client', label: 'From client', count: counts.client },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              {recordLabel === 'lead' ? 'Lead documents' : 'Matter documents'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Everything filed to this {recordLabel}. Flip the switch to show a document in the client portal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              onChange={event => void handleUpload(event.target.files)}
            />
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={uploading}
              onClick={() => uploadInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </Button>
          </div>
        </div>

        {(unreviewedUploadCounts.intake > 0 || unreviewedUploadCounts.portal > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-amber-bg px-4 py-2 text-sm">
            <span className="text-amber">
              {unreviewedUploadCounts.total} upload{unreviewedUploadCounts.total === 1 ? '' : 's'} need review.
            </span>
            <div className="flex flex-wrap gap-2">
              {unreviewedUploadCounts.portal > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => void onReviewPortalUploads?.()}>
                  Mark portal uploads reviewed
                </Button>
              )}
              {unreviewedUploadCounts.intake > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => void onReviewIntakeUploads?.()}>
                  Review intake uploads
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1" role="group" aria-label="Filter documents">
            {scopes.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={scope === option.value}
                onClick={() => setScope(option.value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  scope === option.value
                    ? 'bg-primary/10 font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                {option.label} <span className="tabular-nums">{option.count}</span>
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-9 pl-8 text-sm"
              placeholder="Search documents"
            />
          </div>
        </div>

        {selectedDocuments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-3">
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'bulk-download'} onClick={() => void handleDownloadSelected()}>
              {busy === 'bulk-download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download selected
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'share'} onClick={() => void handleShare(selectedDocuments.filter(doc => !isDocumentShared(doc)), true)}>
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy === 'unshare'} onClick={() => void handleShare(selectedDocuments.filter(isDocumentShared), false)}>
              <Undo2 className="h-3.5 w-3.5" />
              Unshare
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={selectedCombinableDocs.length < 2} onClick={() => setCombineOpen(true)}>
              <Combine className="h-3.5 w-3.5" />
              Combine Word documents
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading documents...
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">
              {query.trim() || scope !== 'all' ? 'No matching documents' : 'No documents yet'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {query.trim() || scope !== 'all'
                ? 'Clear the search or filter to see everything.'
                : 'Upload a file to get started.'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={checked => toggleAllVisible(checked === true)}
                    aria-label="Select all visible documents"
                  />
                </TableHead>
                <TableHead>Document</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Shared</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocuments.map(doc => {
                const issues = (doc.marker_count ?? 0) + (doc.missing_count ?? 0)
                return (
                  <TableRow
                    key={doc.id}
                    id={`document-row-${doc.id}`}
                    data-state={selectedIds.has(doc.id) ? 'selected' : undefined}
                    className={cn(highlightedDocumentId === doc.id && 'bg-amber-100/70 ring-1 ring-inset ring-amber-400 dark:bg-amber-950/30')}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(doc.id)}
                        onCheckedChange={checked => toggleSelected(doc.id, checked === true)}
                        aria-label={`Select ${doc.name}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[360px] whitespace-normal">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p
                            className="break-words text-sm font-medium"
                            title={doc.name}
                            aria-label={`${documentDisplayTitle(doc.name, clientName)}. Full filename: ${doc.name}`}
                          >
                            {documentDisplayTitle(doc.name, clientName)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatBytes(doc.size)}
                            {doc.created_at ? ` · ${formatDateTime(doc.created_at)}` : ''}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <DocumentStatusBadges badges={buildDocumentStatusBadges(doc).slice(0, 2)} />
                            {issues > 0 && (
                              <span className="text-xs font-medium text-amber">
                                {issues} issue{issues === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px]">
                        {doc.source === 'client' ? 'Client' : 'Firm'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={isDocumentShared(doc)}
                        disabled={busy === 'share' || busy === 'unshare'}
                        onCheckedChange={checked => void handleShare([doc], checked)}
                        aria-label={`Share ${doc.name} with the client`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 text-xs"
                          aria-label={isDocumentPdf(doc) ? `Preview PDF ${doc.name}` : `View ${doc.name}`}
                          onClick={() => isDocumentPdf(doc) ? setPreviewTarget(doc) : void openDocument(doc, 'view')}
                        >
                          {busy === `view:${doc.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                          View
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions for ${doc.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isDocumentPdf(doc) && (
                              <DropdownMenuItem onSelect={() => void openDocument(doc, 'view')}>
                                <FileSearch className="mr-2 h-4 w-4" />Open original
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => void openDocument(doc, 'download')}>
                              <Download className="mr-2 h-4 w-4" />Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { setRenameTarget(doc); setRenameValue(doc.name) }}>
                              <Pencil className="mr-2 h-4 w-4" />Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void openAudit(doc)}>
                              <History className="mr-2 h-4 w-4" />History
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteTarget(doc)}>
                              <Trash2 className="mr-2 h-4 w-4" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={renameTarget !== null} onOpenChange={open => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>Update the display name shown in the document list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="document-name">Name</Label>
            <Input id="document-name" value={renameValue} onChange={event => setRenameValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button type="button" disabled={!renameValue.trim() || busy?.startsWith('rename:')} onClick={() => void handleRename()}>
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DocumentPreviewDialog
        document={previewTarget}
        open={previewTarget !== null}
        onOpenChange={open => !open && setPreviewTarget(null)}
      />

      <CombineWordDraftsDialog
        open={combineOpen}
        onOpenChange={setCombineOpen}
        documents={selectedCombinableDocs}
        defaultFilename="combined-matter-drafts.docx"
      />

      <Sheet open={auditTarget !== null} onOpenChange={open => !open && setAuditTarget(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Document history</SheetTitle>
            <SheetDescription>{auditTarget?.name ?? 'Recent document history'}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {auditLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            ) : auditEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recorded history.</p>
            ) : (
              auditEvents.map(event => (
                <div key={event.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{auditLabel(event)}</p>
                      <p className="text-xs text-muted-foreground">{event.user_email ?? 'Unknown user'}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/matter-documents-tab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/matters/\[id\]/MatterDocumentsTab.tsx tests/matter-documents-tab.test.ts
git commit -m "feat(documents): one list, one share toggle, no folders in the matter tab"
```

---

### Task 11: Update the drafting ReviewStep

**Files:**
- Modify: `app/admin/drafting/[matterId]/ReviewStep.tsx`
- Modify: `tests/drafting-hub.test.ts:95-110`

- [ ] **Step 1: Rewrite the drafting-hub assertions**

In `tests/drafting-hub.test.ts`, replace the block spanning lines 95–110 with:

```ts
    const review = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/ReviewStep.tsx'), 'utf8')
    const approveSlice = review.slice(
      review.indexOf('const handleApprove'),
      review.indexOf('const handleConvertPdf'),
    )

    expect(review).not.toContain('PromoteDocumentDialog')
    expect(review).not.toContain('updateDocumentFolder')
    expect(review).toContain('setDocumentShared')
    expect(approveSlice).toContain('setDocumentShared(doc.id, true)')
    expect(approveSlice).not.toContain('window.confirm')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/drafting-hub.test.ts`
Expected: FAIL — `ReviewStep.tsx` still imports `PromoteDocumentDialog`.

- [ ] **Step 3: Replace the promotion flow with direct sharing**

In `app/admin/drafting/[matterId]/ReviewStep.tsx`:

Change the import on line 57 from `updateDocumentFolder` to `setDocumentShared`.

Delete the `PromoteDocumentDialog` dynamic import (lines 68–70), the `pendingPromotion` state declaration (line 103), the `confirmPromotion` function, and the `<PromoteDocumentDialog .../>` element (lines 811–815).

Replace `handleApprove` with:

```ts
  const handleApprove = async (doc: DraftingHubDocument) => {
    if (approvingId) return
    setApprovingId(doc.id)
    try {
      await setDocumentShared(doc.id, true)
      setPromotedIds(prev => new Set(prev).add(doc.id))
      void logMatterActivity(matterId, 'draft_promoted_to_review', 'Draft shared with client', {
        detail: `Shared ${doc.name} with the client`,
        metadata: { documentId: doc.id, documentName: doc.name },
      })
      toast.success('Draft shared with client')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not share draft')
    } finally {
      setApprovingId(null)
    }
  }
```

Update the call site on line 591 to `onClick={() => void handleApprove(doc)}`.

Replace the body of `confirmBulkShare`'s loop — change `await updateDocumentFolder(doc.id, 'review', { confirmed: true })` to `await setDocumentShared(doc.id, true)`.

In `handleUploadSharedPdf`, delete the `isPdfDocument` guard and its `toast.error`, and change the call to `await uploadDocument(file, matterId)` followed by `await setDocumentShared(newDoc.id, true)` using the returned document:

```ts
      const newDoc = await uploadDocument(file, matterId)
      await setDocumentShared(newDoc.id, true)
      toast.success('Document shared with client')
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/drafting-hub.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS — this is the last file importing the modules deleted in Task 13, apart from the test files themselves.

- [ ] **Step 5: Commit**

```bash
git add app/admin/drafting tests/drafting-hub.test.ts
git commit -m "feat(drafting): ReviewStep shares directly, no promotion modal"
```

---

### Task 12: Fix the client portal document list

**Files:**
- Modify: `app/(portal)/documents/PortalDocumentList.tsx:26-70`

- [ ] **Step 1: Replace the folder-derived status chip and the hardcoded file tile**

Delete the `documentStatus` function entirely. In `DocumentRow`, replace the file-type tile:

```tsx
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-bold uppercase text-muted-foreground">
          PDF
        </div>
```

with:

```tsx
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-bold uppercase text-muted-foreground">
          {(doc.name.split('.').pop() ?? 'file').slice(0, 4)}
        </div>
```

and replace the name row's chip block:

```tsx
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${documentStatus(doc).className}`}>
              {documentStatus(doc).label}
            </span>
          </div>
```

with:

```tsx
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
          </div>
```

The `Shared {formatDate(doc.created_at)}` line directly below already tells the client what they need.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS — if `ShieldCheck` or another icon import is now unused, remove it.

- [ ] **Step 3: Commit**

```bash
git add app/\(portal\)/documents/PortalDocumentList.tsx
git commit -m "fix(portal): document list no longer keys off folder"
```

---

### Task 13: Delete the dead sharing modules

**Files:**
- Delete: `lib/documentSharing.ts`
- Delete: `lib/drafting/reviewGate.ts`
- Delete: `components/documents/PromoteDocumentDialog.tsx`
- Delete: `tests/document-sharing.test.ts`
- Delete: `tests/draft-review-gate.test.ts`
- Modify: `tests/lite-app-foundations.test.ts:100-112`

- [ ] **Step 1: Confirm nothing imports them**

Run: `grep -rn --include="*.ts" --include="*.tsx" "documentSharing\|reviewGate\|PromoteDocumentDialog" app components lib tests`
Expected: matches only in the five files being deleted and in `tests/lite-app-foundations.test.ts`. If any other file appears, fix that file before continuing.

- [ ] **Step 2: Replace the lite-app-foundations assertion**

In `tests/lite-app-foundations.test.ts`, remove the `isClientPortalFirmDocument` import and replace the `it('keeps draft folders off the client portal', ...)` block with:

```ts
  it('keeps unshared documents off the client portal', () => {
    expect(isDocumentShared({ shared_at: null })).toBe(false)
    expect(isDocumentShared({ shared_at: '2026-08-06T00:00:00Z' })).toBe(true)
  })
```

adding `import { isDocumentShared } from '@/lib/documentWorkspace'` at the top.

- [ ] **Step 3: Delete the files**

```bash
git rm lib/documentSharing.ts lib/drafting/reviewGate.ts components/documents/PromoteDocumentDialog.tsx tests/document-sharing.test.ts tests/draft-review-gate.test.ts
```

- [ ] **Step 4: Verify the whole suite**

Run: `npm test`
Expected: PASS, all files.

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(documents): delete the sharing gate modules"
```

---

### Task 14: Redefine the three RPCs and both RLS policies

**Files:**
- Create: `supabase/migrations/20260906000001_documents_rpcs_and_rls.sql`

- [ ] **Step 1: Capture the current RPC bodies**

Run this against the database and save the output — you need the full existing definitions to edit them, since they are not stored in this repository:

```sql
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('drafting_hub_draft_rollups', 'get_matter_links_by_emails', 'persist_generated_estate_document');
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260906000001_documents_rpcs_and_rls.sql` containing a `create or replace function` for each of the three, copied verbatim from Step 1 with these edits, followed by the policy replacements:

- `drafting_hub_draft_rollups`: change `WHERE d.folder = 'draft'` to `WHERE d.source = 'firm'`.
- `persist_generated_estate_document`: remove `folder` from the `INSERT INTO public.matter_documents (...)` column list and remove the corresponding value from the `VALUES` list. The column defaults (`source` = `'firm'`, `shared_at` = null) are correct for a generated draft.
- `get_matter_links_by_emails`: replace the `doc_counts` CTE body's four filters with two, and the matching `jsonb_build_object` keys:

```sql
  doc_counts AS (
    SELECT
      md.matter_id::uuid AS matter_id,
      count(*) FILTER (WHERE md.source = 'firm' AND md.shared_at IS NULL) AS drafts,
      count(*) FILTER (WHERE md.shared_at IS NOT NULL) AS shared
    FROM public.matter_documents md
    JOIN matched_matters mm ON mm.matter_id::text = md.matter_id
    GROUP BY md.matter_id
  )
```

with the object becoming `jsonb_build_object('drafts', COALESCE(dc.drafts, 0), 'shared', COALESCE(dc.shared, 0))`.

Then append the policy replacements:

```sql
drop policy if exists client_read_visible_matter_documents on public.matter_documents;
create policy client_read_visible_matter_documents
  on public.matter_documents for select
  using (
    (shared_at is not null or uploaded_by = auth.uid())
    and (
      exists (select 1 from matters m where m.id::text = matter_documents.matter_id and m.client_id = auth.uid())
      or exists (
        select 1 from v_matter_pipeline v
        where v.matter_id::text = matter_documents.matter_id
          and v.client_email = (select u.email from auth.users u where u.id = auth.uid())::text
      )
    )
  );

drop policy if exists client_insert_own_client_folder_documents on public.matter_documents;
create policy client_insert_own_documents
  on public.matter_documents for insert
  with check (
    source = 'client'
    and (
      exists (select 1 from matters m where m.id::text = matter_documents.matter_id and m.client_id = auth.uid())
      or exists (
        select 1 from v_matter_pipeline v
        where v.matter_id::text = matter_documents.matter_id
          and v.client_email = (select users.email from auth.users where users.id = auth.uid())::text
      )
    )
  );
```

- [ ] **Step 3: Apply and verify**

Run: `npm run supabase:db:push`

Then verify directly in SQL that no function or policy still mentions `folder`:

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ilike '%matter_documents%' and p.prosrc ilike '%folder%';

select policyname from pg_policies where tablename = 'matter_documents'
  and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%folder%';
```

Expected: both queries return zero rows. If either returns a row, that object still blocks the column drop in Task 15.

- [ ] **Step 4: Verify the drafting hub still returns data**

```sql
select * from drafting_hub_draft_rollups(array(select id from matters limit 5));
```

Expected: rows with non-zero `current_draft_count` for matters that have drafts.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260906000001_documents_rpcs_and_rls.sql
git commit -m "refactor(db): RPCs and RLS read shared_at and source"
```

---

### Task 15: Drop `folder`, `folder_id`, and the `folders` table

**Files:**
- Create: `supabase/migrations/20260906000002_drop_document_folders.sql`
- Modify: `types/database.ts`
- Modify: `lib/queryColumns.ts:1`
- Modify: the eight writers from Task 3 (remove the transitional `folder` values)

- [ ] **Step 1: Remove every remaining `folder` reference from application code**

Run: `grep -rn --include="*.ts" --include="*.tsx" "folder" app components lib`

Delete the `folder:` line from each insert object it reports — the eight writers from Task 3 plus the two upload routes from Task 7. Every one of them now sets `source` and `shared_at`, which is sufficient. Also delete any surviving `folder: doc.folder` audit-metadata entries; the ones in `bulk-download` and `combine` went with their audit calls in Task 4.

Two known sites that the earlier tasks deliberately left alone and that MUST be fixed here:

- `app/api/admin/matters/[id]/assistant/route.ts:49` still does `.select('name, folder, marker_count')`, and line 44 interpolates `${d.folder}` into an LLM prompt string. Change the select to `'name, source, shared_at, marker_count'` and the prompt line to `` `- ${d.name} (${d.shared_at ? 'shared' : 'internal'}, markers=${d.marker_count ?? '?'})` `` — the prompt was telling the model which folder a draft sat in, and shared-vs-internal is the equivalent fact now.
- `app/api/documents/route.ts` `POST` still speaks folder vocabulary in its `r2Key.startsWith(...)` check and its `shared_at: [...].includes(folder)` expression. Task 7 rewrites both; confirm they are gone rather than assuming.

Expected after this step: the grep returns matches only for unrelated identifiers (R2 key path segments, `folderName`-style variables in non-document code). It must return nothing referencing `matter_documents`.

- [ ] **Step 2: Update the two remaining tests that assert on `folder`**

In `tests/estate-clause-provenance.test.ts`, the fixture objects on lines 305, 340, and 357 each carry `folder: 'draft' as const`. Replace each with:

```ts
      source: 'firm' as const,
```

In `tests/granola-meeting-notes.test.ts:30-35`, replace the assertion:

```ts
  it('saves matter meeting notes with the meeting-notes source without lead support', () => {
```

and

```ts
    expect(route).toContain("source: 'meeting-notes'")
```

- [ ] **Step 3: Remove the columns from the type and the select list**

In `types/database.ts`, delete the `folder` and `folder_id` lines from `MatterDocument`.

In `lib/queryColumns.ts`, remove `folder, folder_id, ` from the string:

```ts
export const MATTER_DOCUMENT_COLUMNS = 'id, matter_id, r2_key, name, size, content_type, shared_at, source, uploaded_by, created_at, generation_id, generation_engine, marker_count, missing_count, superseded_at, reviewed_at, reviewed_by, current_version_id' as const
```

- [ ] **Step 4: Verify the application no longer references the columns**

Run: `npm run typecheck`
Expected: PASS. Any error here names a file still reading `doc.folder` — fix it before touching the database.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write the drop migration**

Create `supabase/migrations/20260906000002_drop_document_folders.sql`:

```sql
-- folder's three jobs now live in shared_at (visibility) and source
-- (provenance). folder_id and the folders table were never populated:
-- 0 rows in folders, 0 non-null folder_id across all matter_documents.

drop policy if exists attorneys_all_folders on public.folders;
drop policy if exists clients_select_own_folders on public.folders;

alter table public.matter_documents
  drop column if exists folder,
  drop column if exists folder_id;

drop table if exists public.folders;
```

- [ ] **Step 6: Apply and verify**

Run: `npm run supabase:db:push`

Verify directly in SQL:

```sql
select column_name from information_schema.columns
where table_name = 'matter_documents' and column_name in ('folder', 'folder_id');

select to_regclass('public.folders') as folders_table;

select source, count(*) as docs, count(shared_at) as shared
from matter_documents group by source;
```

Expected: the first query returns zero rows; `folders_table` is null; the third shows `firm` → 102 docs with 3 shared (or whatever the counts are at that point, with `shared` matching the number of documents visible in the portal).

- [ ] **Step 7: Verify the app end to end**

Start the dev server via the Browser pane preview tools (never `npm run dev` in Bash), then confirm:

1. The matter documents tab lists documents with a `From` column and a working `Shared` toggle.
2. Toggling `Shared` on a document makes it appear in the client portal at `/documents`; toggling it off removes it.
3. Uploading from the admin tab produces an unshared firm document.
4. The drafting hub still lists drafts for a matter that has them.
5. The meeting-notes card on the matter page still lists its notes.

Check `read_console_messages` and `preview_logs` for errors after each step.

- [ ] **Step 8: Final verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(db): drop matter_documents.folder, folder_id, and the folders table"
```

---

## Verification checklist

After Task 15, confirm each spec requirement landed:

- [ ] `shared_at` is the only thing deciding client visibility — in the API, in `documentSecurity.ts`, and in RLS
- [ ] `source` is written by every creation path and read by the meeting-notes card, portal-uploads card, unreviewed-upload counter, and drafting hub
- [ ] No TypeScript file references `folder`, `folder_id`, `FIRM_SHARED_FOLDERS`, or `VALID_FOLDERS`
- [ ] `GET /api/documents/[id]` writes no audit row and can no longer return 503
- [ ] No route performs a compensating revert on audit failure
- [ ] Word documents can be shared with a client
- [ ] `convert-pdf` creates an unshared document
- [ ] `lib/documentSharing.ts`, `lib/drafting/reviewGate.ts`, and `components/documents/PromoteDocumentDialog.tsx` no longer exist
- [ ] The `folders` table no longer exists
