import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteR2Key } from '@/lib/r2Delete'
import {
  MATTER_DELETION_PROTECTION_LABELS,
  type MatterDeletionProtection,
} from '@/lib/matters/deletionProtections'

export {
  MATTER_DELETION_PROTECTION_LABELS,
  type MatterDeletionProtection,
} from '@/lib/matters/deletionProtections'

export type MatterDeletionErrorCode = 'not_found' | 'blocked' | 'confirmation_required'

/** A refusal the caller can act on, as opposed to an infrastructure failure. */
export class MatterDeletionError extends Error {
  readonly code: MatterDeletionErrorCode
  readonly protections: MatterDeletionProtection[]

  constructor(
    message: string,
    code: MatterDeletionErrorCode,
    protections: MatterDeletionProtection[] = [],
  ) {
    super(message)
    this.name = 'MatterDeletionError'
    this.code = code
    this.protections = protections
  }
}

export type DeleteMatterOptions = {
  /**
   * Acknowledges every protection the matter carries. Deliberately not a
   * default: a caller that has not been told what it is destroying should not
   * be able to destroy it.
   */
  confirmProtected?: boolean
  actorId?: string | null
  actorEmail?: string | null
  reason?: string | null
}

export type DeleteMatterResult = {
  matterId: string
  intakeId: string | null
  protections: MatterDeletionProtection[]
  documentsDeleted: number
}

function protectionSentence(protections: MatterDeletionProtection[]): string {
  return protections.map(protection => MATTER_DELETION_PROTECTION_LABELS[protection]).join(', and ')
}

/**
 * What a matter carries that makes destroying it worth a second look.
 *
 * Split out of `deleteMatter` so a caller about to delete several at once — a
 * person's whole history with the firm, say — can ask once, before the first
 * one is gone, instead of stopping halfway through with part of it already
 * destroyed.
 */
export async function matterDeletionProtections(
  admin: SupabaseClient,
  matterId: string,
): Promise<MatterDeletionProtection[]> {
  const { data: matter, error } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('id', matterId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!matter) throw new MatterDeletionError('Matter not found', 'not_found')

  const protections: MatterDeletionProtection[] = []
  if (matter.relationship_status === 'hired') protections.push('hired')

  const { data: signedAgreement, error: agreementError } = await admin
    .from('engagement_agreements')
    .select('id')
    .eq('matter_id', matterId)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle()
  if (agreementError) throw new Error(agreementError.message)
  if (signedAgreement) protections.push('signed_engagement')

  return protections
}

/** The sentence a caller shows before asking for confirmation. */
export function matterDeletionConfirmationMessage(protections: MatterDeletionProtection[]): string {
  return `Permanently deleting this matter destroys client records — ${protectionSentence(protections)}. Confirm the deletion to proceed, or close or archive the matter instead.`
}

/**
 * Permanently delete a matter, its intake, documents (DB + best-effort R2), and
 * related rows.
 *
 * Closing and archiving keep the matter; this destroys it. A hired matter or one
 * with a signed engagement can be deleted, but only when the caller passes
 * `confirmProtected` — the route turns the refusal into a second confirmation
 * step rather than a dead end.
 */
export async function deleteMatter(
  admin: SupabaseClient,
  matterId: string,
  options: DeleteMatterOptions = {},
): Promise<DeleteMatterResult> {
  const { data: matter, error: fetchError } = await admin
    .from('matters')
    .select('id, client_intake_id, name, matter_number, stage, status, relationship_status, created_at')
    .eq('id', matterId)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!matter) throw new MatterDeletionError('Matter not found', 'not_found')

  // estate_clause_preview_evidence.representative_matter_id is ON DELETE
  // RESTRICT and NOT NULL, so this matter is load-bearing for the clause
  // library's proof that a published revision was previewed against a real
  // file. Checked first, before anything is destroyed: letting the constraint
  // fire mid-delete would leave the matter stripped of its children.
  const { data: clauseEvidence, error: evidenceError } = await admin
    .from('estate_clause_preview_evidence')
    .select('id')
    .eq('representative_matter_id', matterId)
    .limit(1)
    .maybeSingle()
  if (evidenceError) throw new Error(evidenceError.message)
  if (clauseEvidence) {
    throw new MatterDeletionError(
      'This matter is the preview evidence behind a published clause and cannot be deleted. Close or archive it instead.',
      'blocked',
    )
  }

  const protections = await matterDeletionProtections(admin, matterId)

  if (protections.length > 0 && !options.confirmProtected) {
    throw new MatterDeletionError(
      matterDeletionConfirmationMessage(protections),
      'confirmation_required',
      protections,
    )
  }

  const intakeId = (matter.client_intake_id as string | null) ?? null

  // Collect the storage keys now, but do NOT delete blobs yet. Destroying files
  // first meant any later failure left live matter_documents/document_versions
  // rows pointing at objects that no longer exist — visible in the UI,
  // unrecoverable. Same ordering the single-document route uses: DB first,
  // storage last.
  const { data: docs, error: docsError } = await admin
    .from('matter_documents')
    .select('id, r2_key')
    .eq('matter_id', matterId)
  if (docsError) throw new Error(docsError.message)

  const r2Keys: (string | null)[] = []
  if (docs?.length) {
    r2Keys.push(...docs.map(d => d.r2_key as string | null))

    const { data: versions, error: versionsError } = await admin
      .from('document_versions')
      .select('r2_key, pdf_r2_key')
      .in('document_id', docs.map(d => d.id))
    if (versionsError) throw new Error(versionsError.message)

    for (const version of versions ?? []) {
      r2Keys.push(version.r2_key as string | null, version.pdf_r2_key as string | null)
    }
  }

  // Rows keyed by text matter_id (no FK cascade from matters). Errors are fatal:
  // aborting here leaves the matter intact and its files still present, which is
  // recoverable — the reverse is not.
  const scopedDeletes: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
    ['tabular_reviews', () => admin.from('tabular_reviews').delete().eq('matter_id', matterId)],
    ['box_document_exports', () => admin.from('box_document_exports').delete().eq('matter_id', matterId)],
    ['box_matter_folders', () => admin.from('box_matter_folders').delete().eq('matter_id', matterId)],
    ['matter_documents', () => admin.from('matter_documents').delete().eq('matter_id', matterId)],
    ['document_access_audit', () => admin.from('document_access_audit').delete().eq('matter_id', matterId)],
    ['matter_activity', () => admin.from('matter_activity').delete().eq('matter_id', matterId)],
    ['messages', () => admin.from('messages').delete().eq('matter_id', matterId)],
    ['matter_assistant_messages', () => admin.from('matter_assistant_messages').delete().eq('matter_id', matterId)],
    ['pipeline_aging_snooze', () => admin.from('pipeline_aging_snooze').delete().eq('entity', 'matter').eq('entity_id', matterId)],
    ['sms_messages', () => admin.from('sms_messages').delete().eq('matter_id', matterId)],
    ['email_log', () => admin.from('email_log').delete().eq('matter_id', matterId)],
    ['work_runs', () => admin.from('work_runs').delete().eq('matter_id', matterId)],
  ]

  for (const [table, run] of scopedDeletes) {
    const { error } = await run()
    if (error) throw new Error(`Failed to delete ${table} rows for matter ${matterId}: ${error.message}`)
  }

  const { error: deleteMatterError } = await admin.from('matters').delete().eq('id', matterId)
  if (deleteMatterError) throw new Error(deleteMatterError.message)

  // The matter is gone, so a failed tombstone is a lost audit line rather than a
  // half-deleted file — logged, not thrown, the same way the R2 cleanup below is
  // treated. Written before the intake so a signed matter never loses both.
  const { error: logError } = await admin.from('matter_deletions').insert({
    matter_id: matterId,
    client_intake_id: intakeId,
    matter_number: matter.matter_number ?? null,
    matter_name: matter.name ?? null,
    stage: matter.stage ?? null,
    relationship_status: matter.relationship_status,
    status: matter.status ?? 'active',
    had_signed_engagement: protections.includes('signed_engagement'),
    documents_deleted: docs?.length ?? 0,
    reason: options.reason?.trim() || null,
    matter_created_at: matter.created_at ?? null,
    deleted_by: options.actorId ?? null,
    deleted_by_email: options.actorEmail ?? null,
  })
  if (logError) {
    console.error(`[deleteMatter] failed to record the deletion of matter ${matterId}:`, logError.message)
  }

  if (intakeId) {
    const { error: intakeError } = await admin.from('client_intake').delete().eq('id', intakeId)
    if (intakeError) throw new Error(intakeError.message)
  }

  // Every DB row is gone; the blobs are now unreachable, so failing to remove
  // one is a storage leak rather than a dangling reference. Best-effort.
  for (const key of r2Keys) {
    try {
      await deleteR2Key(key)
    } catch (error) {
      console.error(`[deleteMatter] failed to delete R2 object ${key}:`, error)
    }
  }

  return { matterId, intakeId, protections, documentsDeleted: docs?.length ?? 0 }
}
