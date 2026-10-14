import type { SenderMatch } from '@/lib/emailTriage/classifySender'
import type { TriageClassification } from '@/lib/queries/emailTriage'

/**
 * Resolve a Mail Desk "link to record" body into the columns written on the
 * triage row. Pure so route tests do not need Supabase.
 *
 * Matter wins when both ids are present — a hired client is the stronger
 * attachment, and Tasks / send already prefer `matter_id`.
 */
export function resolveEmailTriageLink(input: {
  leadId?: string | null
  matterId?: string | null
  /** Intake id owned by the matter, when known. */
  matterIntakeId?: string | null
  /** Matter id already on the lead, when known. */
  leadMatterId?: string | null
  unlink?: boolean
}): {
  classification: TriageClassification
  client_intake_id: string | null
  matter_id: string | null
  contact_id: null
  classification_reason: string
  record_linked_manually: boolean
} | { error: string } {
  if (input.unlink) {
    // Back to an unmatched queue row — the next scan can re-classify freely.
    return {
      classification: 'possible_lead',
      client_intake_id: null,
      matter_id: null,
      contact_id: null,
      classification_reason: 'Unlinked in Mail Desk',
      record_linked_manually: false,
    }
  }

  const matterId = input.matterId?.trim() || null
  const leadId = input.leadId?.trim() || null
  if (!matterId && !leadId) {
    return { error: 'Choose a lead or matter to link.' }
  }

  if (matterId) {
    return {
      classification: 'client',
      client_intake_id: input.matterIntakeId?.trim() || leadId,
      matter_id: matterId,
      contact_id: null,
      classification_reason: 'Linked manually in Mail Desk',
      record_linked_manually: true,
    }
  }

  return {
    classification: 'lead',
    client_intake_id: leadId,
    matter_id: input.leadMatterId?.trim() || null,
    contact_id: null,
    classification_reason: 'Linked manually in Mail Desk',
    record_linked_manually: true,
  }
}

export type ManualLinkExisting = {
  record_linked_manually: boolean
  classification: TriageClassification
  client_intake_id: string | null
  matter_id: string | null
  contact_id: string | null
  classification_reason: string | null
}

/**
 * When a scan would re-file an open thread, prefer the attorney's manual link
 * over a fresh sender classification (including automated → Noise).
 */
export function applyManualLinkOnScan(
  match: SenderMatch,
  existing: ManualLinkExisting | undefined,
): SenderMatch & { recordLinkedManually: boolean } {
  if (!existing?.record_linked_manually) {
    return { ...match, recordLinkedManually: false }
  }
  return {
    ...match,
    classification: existing.classification,
    clientIntakeId: existing.client_intake_id,
    matterId: existing.matter_id,
    contactId: existing.contact_id,
    reason: existing.classification_reason ?? 'Linked manually in Mail Desk',
    recordLinkedManually: true,
  }
}
