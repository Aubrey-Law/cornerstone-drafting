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
  // Firm staff work an opportunity across its whole lifecycle, so a lead's
  // documents are as much theirs to manage as a hired matter's. This has to
  // come first: the 'hired' gate below is a client-visibility rule, not a
  // firm one, and checking it first locked the firm out of lead documents.
  if (await isAdminUser(admin, user)) return true

  const { data: eligibleMatter } = await admin
    .from('matters')
    .select('id')
    .eq('id', matterId)
    .eq('relationship_status', 'hired')
    .maybeSingle()
  if (!eligibleMatter) return false

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
