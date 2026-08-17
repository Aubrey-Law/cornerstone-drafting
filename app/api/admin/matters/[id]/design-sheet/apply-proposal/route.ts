import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { buildDesignSheetSavePayload, inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { updatedAtMatches } from '@/lib/designSheet/updatedAt'
import { attachContactToMatter } from '@/lib/contacts/attachContactToMatter'
import {
  applyDecisionFieldValues,
  isDesignSheetDecisionField,
} from '@/lib/designSheetImport/decisionFields'
import {
  applyFiduciaryProposalsToSheet,
  type ResolvedFiduciaryProposal,
} from '@/lib/designSheet/fiduciaryProposal'
import type { DesignSheet } from '@/types/database'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface ApplyProposalBody {
  sheetId?: string | null
  expectedUpdatedAt?: string | null
  /** Accepted field values, keyed by column name or `<namespace>.<key>`. */
  fields?: Record<string, unknown>
  /** Accepted fiduciary rows, exactly as the review dialog listed them. */
  fiduciaries?: ResolvedFiduciaryProposal[]
}

/**
 * Save an accepted proposal.
 *
 * The generic design-sheet PATCH cannot do this job. A decision field has to be
 * folded into its `decisions` namespace, and a fiduciary may have to mint a
 * `contacts` row before there is an id to store — both of which need the
 * authoritative sheet, not the client's copy of it. Doing the routing here means
 * the merge always happens against what is actually in the database.
 */
export async function POST(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as ApplyProposalBody | null

  const fields = body?.fields && typeof body.fields === 'object' ? body.fields : {}
  const fiduciaries = Array.isArray(body?.fiduciaries) ? body.fiduciaries : []

  if (Object.keys(fields).length === 0 && fiduciaries.length === 0) {
    return NextResponse.json({ error: 'Nothing was selected to apply' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()

    const { data: matterRow, error: matterError } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', matterId)
      .eq('relationship_status', 'hired')
      .maybeSingle()
    if (matterError) throw new Error(matterError.message)
    if (!matterRow?.client_intake_id) {
      return NextResponse.json(
        { error: 'Drafting is available only for hired matters with a client intake record.' },
        { status: 409 },
      )
    }
    const clientIntakeId = matterRow.client_intake_id as string

    let sheetQuery = admin.from('design_sheets').select('*').eq('matter_id', matterId)
    if (body?.sheetId) sheetQuery = sheetQuery.eq('id', body.sheetId)
    const { data: existingRow, error: sheetError } = await sheetQuery
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (sheetError) throw new Error(sheetError.message)

    const existingSheet = inflateDesignSheetRow(existingRow as Record<string, unknown> | null)
    if (!existingSheet || !existingRow?.id) {
      return NextResponse.json({ error: 'No design sheet found for this matter' }, { status: 404 })
    }

    const storedUpdatedAt = typeof existingRow.updated_at === 'string' ? existingRow.updated_at : null
    const expectedUpdatedAt = typeof body?.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
    if (expectedUpdatedAt && storedUpdatedAt && !updatedAtMatches(expectedUpdatedAt, storedUpdatedAt)) {
      return NextResponse.json(
        { error: 'Design sheet was updated elsewhere.', conflict: true, updated_at: storedUpdatedAt },
        { status: 409 },
      )
    }

    // Split by where each accepted field actually lives.
    const columnFields: Record<string, unknown> = {}
    const decisionFields: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(fields)) {
      if (isDesignSheetDecisionField(field)) decisionFields[field] = value
      else columnFields[field] = value
    }

    const contactIdByProposalId = await resolveProposalContacts({
      admin, matterId, clientIntakeId, fiduciaries,
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
      return NextResponse.json(
        { error: 'Design sheet was updated elsewhere.', conflict: true },
        { status: 409 },
      )
    }

    return NextResponse.json({
      ok: true,
      id: existingRow.id,
      updated_at: now,
      applied_fields: Object.keys(fields).length,
      applied_fiduciaries: Object.keys(contactIdByProposalId).length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to apply design sheet proposal'
    return NextResponse.json({ error: message }, { status: 500 })
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
