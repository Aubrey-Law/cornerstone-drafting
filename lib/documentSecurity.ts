import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatterDocument } from '@/types/database'

const CLIENT_HIDDEN_FOLDERS = new Set(['draft', 'drafts', 'meeting-notes', 'meeting_notes'])
const CLIENT_UPLOAD_FOLDERS = new Set(['client', 'intake'])

type AuthUser = Pick<User, 'id' | 'email'> & {
  email_confirmed_at?: string | null
}

function normalizeFolder(folder: string | null | undefined) {
  return (folder ?? '').trim().toLowerCase()
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

export function isClientVisibleDocument(doc: { folder: string | null | undefined }) {
  return !CLIENT_HIDDEN_FOLDERS.has(normalizeFolder(doc.folder))
}

export function isClientUploadFolder(folder: string) {
  return CLIENT_UPLOAD_FOLDERS.has(normalizeFolder(folder))
}

export async function userCanAccessMatter(
  admin: SupabaseClient,
  user: AuthUser,
  matterId: string,
) {
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

export async function userCanReadDocument(
  admin: SupabaseClient,
  user: AuthUser,
  doc: Pick<MatterDocument, 'matter_id' | 'folder' | 'folder_id'>,
) {
  if (await isAdminUser(admin, user)) return true
  if (!isClientVisibleDocument(doc)) return false
  if (doc.folder_id) {
    const { data: folder } = await admin
      .from('folders')
      .select('name')
      .eq('id', doc.folder_id)
      .maybeSingle()

    if (CLIENT_HIDDEN_FOLDERS.has(normalizeFolder(folder?.name))) return false
  }

  return userCanAccessMatter(admin, user, doc.matter_id)
}

export async function filterClientVisibleDocuments<T extends { folder: MatterDocument['folder'] | null | undefined; folder_id?: string | null }>(
  admin: SupabaseClient,
  docs: T[],
) {
  const visibleByLegacyFolder = docs.filter(isClientVisibleDocument)
  const folderIds = Array.from(
    new Set(visibleByLegacyFolder.map((doc) => doc.folder_id).filter(Boolean) as string[]),
  )

  if (folderIds.length === 0) return visibleByLegacyFolder

  const { data: hiddenFolders } = await admin
    .from('folders')
    .select('id')
    .in('id', folderIds)
    .in('name', ['Draft', 'Drafts', 'draft', 'drafts', 'Meeting Notes', 'meeting notes', 'meeting-notes'])

  const hiddenFolderIds = new Set((hiddenFolders ?? []).map((folder) => folder.id))
  return visibleByLegacyFolder.filter((doc) => !doc.folder_id || !hiddenFolderIds.has(doc.folder_id))
}

type AuditAction = 'download' | 'view' | 'folder_change' | 'delete' | 'export' | 'review' | 'rename'

export async function auditDocumentAccess(
  admin: SupabaseClient,
  user: Pick<User, 'id' | 'email'>,
  doc: Pick<MatterDocument, 'id' | 'matter_id'>,
  action: AuditAction,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from('document_access_audit').insert({
    document_id: doc.id,
    matter_id: doc.matter_id,
    user_id: user.id,
    user_email: user.email ?? null,
    action,
    metadata,
  })

  if (error) {
    // Every access — read or mutation — is a compliance requirement for a
    // law firm. Callers must check ok and refuse the operation on failure.
    console.warn('document_access_audit insert failed:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
