import { isClientPortalFirmDocument } from '@/lib/documentSharing'
import { filterClientVisibleDocuments } from '@/lib/documentSecurity'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { MatterDocument } from '@/types/database'

/**
 * Firm-shared PDFs in review / signed / final for the client portal.
 */
export async function fetchSharedDocuments(matterId: string): Promise<MatterDocument[]> {
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .in('folder', ['review', 'signed', 'final'])
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchSharedDocuments error:', error)
    return []
  }
  const visible = await filterClientVisibleDocuments(admin, data ?? [])
  return visible.filter(isClientPortalFirmDocument)
}

/** Documents the client uploaded themselves (folder = 'client'). */
export async function fetchClientUploads(
  matterId: string,
  userId: string,
): Promise<MatterDocument[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .eq('folder', 'client')
    .eq('uploaded_by', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchClientUploads error:', error)
    return []
  }
  return (data ?? []) as MatterDocument[]
}
