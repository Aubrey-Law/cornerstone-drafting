import { createHash } from 'node:crypto'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import { ensureInitialVersion } from '@/lib/documentVersions'
import { deleteR2Key } from '@/lib/r2Delete'
import type { PmpsArtifact } from '@/lib/pmps/types'
import { worksDb } from '@/lib/works/data'

export interface WorkRunArtifactRow {
  id: string
  run_id: string
  artifact_kind: string
  filename: string
  content_type: string
  size_bytes: number
  r2_key: string
  sha256: string
  promotion_status: 'pending' | 'promoted' | 'cancelled'
  promoted_document_id: string | null
  created_at: string
  promoted_at: string | null
}

export function artifactR2Key(runId: string, filename: string) {
  return `work-runs/${runId}/${safeUploadFilename(filename)}`
}

export function artifactClientShape(row: WorkRunArtifactRow) {
  return {
    id: row.id, kind: row.artifact_kind, filename: row.filename,
    contentType: row.content_type, size: Number(row.size_bytes), sha256: row.sha256,
    status: row.promotion_status, documentId: row.promoted_document_id,
    downloadUrl: `/api/admin/works/runs/${row.run_id}/artifacts/${row.id}`,
  }
}

export async function storeRunArtifacts(runId: string, artifacts: PmpsArtifact[]) {
  const db = worksDb()
  const stored: WorkRunArtifactRow[] = []
  const uploadedKeys: string[] = []
  try {
    for (const artifact of artifacts) {
      const r2Key = artifactR2Key(runId, artifact.filename)
      await putFileToR2(r2Key, artifact.bytes, artifact.contentType)
      uploadedKeys.push(r2Key)
      const sha256 = createHash('sha256').update(artifact.bytes).digest('hex')
      const { data, error } = await db.from('work_run_artifacts').insert({
        run_id: runId, artifact_kind: artifact.kind, filename: artifact.filename,
        content_type: artifact.contentType, size_bytes: artifact.bytes.byteLength,
        r2_key: r2Key, sha256,
      }).select('*').single()
      if (error || !data) throw new Error(error?.message ?? 'Unable to register workflow artifact')
      stored.push(data as WorkRunArtifactRow)
    }
    return stored
  } catch (error) {
    await Promise.all(uploadedKeys.map(deleteR2Key))
    if (stored.length) await db.from('work_run_artifacts').delete().in('id', stored.map(row => row.id))
    throw error
  }
}

export async function cancelRunArtifacts(runId: string) {
  const db = worksDb()
  const { data } = await db.from('work_run_artifacts').select('*').eq('run_id', runId).eq('promotion_status', 'pending')
  await Promise.all((data ?? []).map((row: WorkRunArtifactRow) => deleteR2Key(row.r2_key)))
  await db.from('work_run_artifacts').update({ promotion_status: 'cancelled' }).eq('run_id', runId).eq('promotion_status', 'pending')
}

export async function promoteRunArtifacts(args: { runId: string; matterId: string; userId: string }) {
  const db = worksDb()
  const { data, error } = await db.from('work_run_artifacts').select('*').eq('run_id', args.runId).order('created_at')
  if (error) throw new Error(error.message)
  const promoted: Array<{ artifactId: string; documentId: string }> = []
  for (const artifact of (data ?? []) as WorkRunArtifactRow[]) {
    if (artifact.promotion_status === 'promoted' && artifact.promoted_document_id) {
      promoted.push({ artifactId: artifact.id, documentId: artifact.promoted_document_id })
      continue
    }
    if (artifact.promotion_status !== 'pending') continue
    let { data: document, error: insertError } = await db.from('matter_documents').insert({
      matter_id: args.matterId, r2_key: artifact.r2_key, name: artifact.filename,
      size: artifact.size_bytes, content_type: artifact.content_type,
      source: 'client', shared_at: null,
      uploaded_by: args.userId, generation_id: args.runId, generation_engine: 'node',
      marker_count: 0, missing_count: 0,
    }).select('*').single()
    if (insertError || !document) {
      const existing = await db.from('matter_documents').select('*').eq('r2_key', artifact.r2_key).eq('matter_id', args.matterId).maybeSingle()
      document = existing.data
      insertError = existing.error
    }
    if (insertError || !document) throw new Error(insertError?.message ?? 'Unable to register PMPS document')
    const version = await ensureInitialVersion({
      admin: db, documentId: document.id, r2Key: artifact.r2_key, filename: artifact.filename,
      contentType: artifact.content_type, sizeBytes: artifact.size_bytes, source: 'generated', createdBy: args.userId,
    })
    if (!version) throw new Error(`Unable to create the initial version for ${artifact.filename}`)
    const { error: updateError } = await db.from('work_run_artifacts').update({
      promotion_status: 'promoted', promoted_document_id: document.id, promoted_at: new Date().toISOString(),
    }).eq('id', artifact.id).eq('promotion_status', 'pending')
    if (updateError) throw new Error(updateError.message)
    promoted.push({ artifactId: artifact.id, documentId: document.id })
  }
  return promoted
}
