import { getAdminClient } from '@/lib/supabaseAdmin'
import { signingDateParts } from '@/lib/designSheet/signingDate'
import { buildDesignSheetSavePayload, inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { updatedAtMatches } from '@/lib/designSheet/updatedAt'
import { attachContactToMatter } from '@/lib/contacts/attachContactToMatter'
import {
  applyDecisionFieldValues,
  isDesignSheetDecisionField,
} from '@/lib/designSheetImport/decisionFields'
import { getDesignSheetImportFieldMeta } from '@/lib/designSheetImport/shared'
import {
  applyFiduciaryProposalsToSheet,
  type ResolvedFiduciaryProposal,
} from '@/lib/designSheet/fiduciaryProposal'

/**
 * The one writer for an accepted design-sheet proposal.
 *
 * Lives here rather than in a route because two surfaces now accept proposals —
 * the web review dialog and the Word add-in — and the design sheet is the firm's
 * authoritative record. Two writers would mean two answers to what a
 * compare-and-swap guards, whether a created contact gets its join row, and
 * whether an empty decisions blob can reach the database; each of those has been
 * got wrong once already, and the second writer is where it would silently come
 * back.
 *
 * Framework-free on purpose: it returns a result rather than a Response, so each
 * route shapes its own reply and this stays testable without one.
 */

/**
 * Split a submitted field map into what may be applied and what may not.
 *
 * For surfaces that accept a field map from a client rather than from their own
 * rendered review rows — the Word add-in, where the body is assembled in the
 * pane. `DESIGN_SHEET_IMPORT_FIELDS` is the set the extractor can propose and
 * the review UI can therefore show, so anything outside it is a field nobody
 * reviewed, heading for a column nobody was shown.
 *
 * Refused rather than dropped: silently ignoring a field the caller asked to
 * write would report success for a change that did not happen.
 */
export function partitionImportableFields(
  submitted: Record<string, unknown>,
): { fields: Record<string, unknown>; refused: string[] } {
  const fields: Record<string, unknown> = {}
  const refused: string[] = []
  for (const [field, value] of Object.entries(submitted)) {
    if (getDesignSheetImportFieldMeta(field)) fields[field] = value
    else refused.push(field)
  }
  return { fields, refused }
}

/**
 * The month and year columns an accepted signing date implies. The documents
 * print them beside the date, so they are set from it exactly as the sheet's
 * own date picker does; nothing else may propose them.
 */
export function withDerivedSigningParts(columnFields: Record<string, unknown>): Record<string, unknown> {
  if (typeof columnFields.signing_date !== 'string') return {}
  return signingDateParts(columnFields.signing_date)
}

export interface ApplyDesignSheetProposalArgs {
  matterId: string
  /** Pin to one sheet; omit to take the matter's latest. */
  sheetId?: string | null
  /** The `updated_at` the accepting surface last saw. Omit to skip the check. */
  expectedUpdatedAt?: string | null
  /** Accepted field values, keyed by column name or `<namespace>.<key>`. */
  fields: Record<string, unknown>
  /** Accepted fiduciary rows, exactly as the review surface listed them. */
  fiduciaries: ResolvedFiduciaryProposal[]
}

export type ApplyDesignSheetProposalResult =
  | {
      ok: true
      id: string
      updatedAt: string
      appliedFields: number
      appliedFiduciaries: number
    }
  | { ok: false; status: number; error: string; conflict?: boolean; updatedAt?: string }

export async function applyDesignSheetProposal(
  args: ApplyDesignSheetProposalArgs,
): Promise<ApplyDesignSheetProposalResult> {
  const { matterId, fields, fiduciaries } = args

  if (Object.keys(fields).length === 0 && fiduciaries.length === 0) {
    return { ok: false, status: 400, error: 'Nothing was selected to apply' }
  }

  const admin = getAdminClient()

  const { data: matterRow, error: matterError } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .eq('relationship_status', 'hired')
    .maybeSingle()
  if (matterError) throw new Error(matterError.message)
  if (!matterRow?.client_intake_id) {
    return {
      ok: false,
      status: 409,
      error: 'Drafting is available only for hired matters with a client intake record.',
    }
  }
  const clientIntakeId = matterRow.client_intake_id as string

  let sheetQuery = admin.from('design_sheets').select('*').eq('matter_id', matterId)
  if (args.sheetId) sheetQuery = sheetQuery.eq('id', args.sheetId)
  const { data: existingRow, error: sheetError } = await sheetQuery
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sheetError) throw new Error(sheetError.message)

  const existingSheet = inflateDesignSheetRow(existingRow as Record<string, unknown> | null)
  if (!existingSheet || !existingRow?.id) {
    return { ok: false, status: 404, error: 'No design sheet found for this matter' }
  }

  const storedUpdatedAt = typeof existingRow.updated_at === 'string' ? existingRow.updated_at : null
  const expectedUpdatedAt =
    typeof args.expectedUpdatedAt === 'string' ? args.expectedUpdatedAt : null
  if (expectedUpdatedAt && storedUpdatedAt && !updatedAtMatches(expectedUpdatedAt, storedUpdatedAt)) {
    return {
      ok: false,
      status: 409,
      error: 'Design sheet was updated elsewhere.',
      conflict: true,
      updatedAt: storedUpdatedAt,
    }
  }

  // Split by where each accepted field actually lives.
  const columnFields: Record<string, unknown> = {}
  const decisionFields: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (isDesignSheetDecisionField(field)) decisionFields[field] = value
    else columnFields[field] = value
  }
  Object.assign(columnFields, withDerivedSigningParts(columnFields))

  const contactIdByProposalId = await resolveProposalContacts({
    admin,
    matterId,
    clientIntakeId,
    fiduciaries,
  })

  const slotPatch = applyFiduciaryProposalsToSheet({
    sheet: existingSheet,
    accepted: fiduciaries,
    contactIdByProposalId,
  })

  const nextDecisions = Object.keys(decisionFields).length > 0
    ? applyDecisionFieldValues(existingSheet, decisionFields)
    // Never send `{}`: an empty decisions blob is treated as authoritative and
    // would replace every stored decision with nothing.
    : (existingSheet.decisions ?? {}) as Record<string, unknown>

  const payload = buildDesignSheetSavePayload({
    existingSheet,
    incomingSheet: { ...columnFields, ...slotPatch } as Record<string, unknown>,
    incomingDecisions: nextDecisions,
  })

  const now = new Date().toISOString()
  let updateQuery = admin
    .from('design_sheets')
    .update({ ...payload, client_intake_id: clientIntakeId, updated_at: now })
    .eq('id', existingRow.id as string)
    .eq('matter_id', matterId)

  // Compare-and-swap, matching the PATCH route: the time-of-check above cannot
  // stop a concurrent save, and the payload is the full merged sheet, so the
  // loser would otherwise be overwritten wholesale.
  if (storedUpdatedAt) updateQuery = updateQuery.eq('updated_at', storedUpdatedAt)

  const { data: updatedRows, error: updateError } = await updateQuery.select('id')
  if (updateError) throw new Error(updateError.message)
  if (storedUpdatedAt && (!updatedRows || updatedRows.length === 0)) {
    return { ok: false, status: 409, error: 'Design sheet was updated elsewhere.', conflict: true }
  }

  return {
    ok: true,
    id: existingRow.id as string,
    updatedAt: now,
    appliedFields: Object.keys(fields).length,
    appliedFiduciaries: Object.keys(contactIdByProposalId).length,
  }
}

type AdminClient = ReturnType<typeof getAdminClient>

/**
 * The contact id for each accepted fiduciary — reusing the person already on the
 * matter where the review matched one, and creating them where it did not.
 *
 * A created contact gets its own `matter_contacts` join row (step 7a of
 * docs/matter-contacts-migration.md). Relying on the legacy
 * `contacts.client_intake_id` trigger instead would make every person this route
 * creates invisible the moment step 7b drops it.
 */
async function resolveProposalContacts(args: {
  admin: AdminClient
  matterId: string
  clientIntakeId: string
  fiduciaries: ResolvedFiduciaryProposal[]
}): Promise<Record<string, string>> {
  const { admin, matterId, clientIntakeId, fiduciaries } = args
  const out: Record<string, string> = {}
  // One created row per person, not per role: the same person is routinely named
  // trustee and personal representative.
  const createdByName = new Map<string, string>()

  for (const proposal of fiduciaries) {
    if (proposal.matchedContactId) {
      out[proposal.id] = proposal.matchedContactId
      continue
    }

    const first = proposal.first_name?.trim()
    const last = proposal.last_name?.trim()
    if (!first || !last) continue

    const nameKey = `${first.toLowerCase()}|${last.toLowerCase()}`
    const already = createdByName.get(nameKey)
    if (already) {
      out[proposal.id] = already
      continue
    }

    const { data: created, error } = await admin
      .from('contacts')
      .insert({
        client_intake_id: clientIntakeId,
        first_name: first,
        last_name: last,
        relationship_type: 'other',
        relationship_label: proposal.relationship ?? null,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    const contactId = (created as { id: string }).id
    await attachContactToMatter(admin, matterId, contactId, {
      relationship_type: 'other',
      relationship_label: proposal.relationship ?? null,
      for_party: proposal.party,
    })

    createdByName.set(nameKey, contactId)
    out[proposal.id] = contactId
  }

  return out
}
