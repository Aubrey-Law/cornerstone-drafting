import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { DocumentKind } from '@/lib/execution/requirements'
import type { CeremonyRoles, DocumentRecord } from './validation'

export type CeremonyStatus = 'scheduled' | 'completed' | 'cancelled'

export interface Ceremony extends CeremonyRoles {
  id: string
  matterId: string
  scheduledFor: string | null
  location: string | null
  /** Where the signed originals are kept, so the file can answer years later. */
  originalsLocation: string | null
  status: CeremonyStatus
  completedAt: string | null
  note: string | null
  documents: Array<DocumentRecord & { recordingReference: string | null; note: string | null; executedDocumentId: string | null }>
}

export async function loadCeremony(
  client: SupabaseClient<GeneratedDatabase>,
  matterId: string,
): Promise<Ceremony | null> {
  const sb = client

  // The most recent appointment. A matter can be signed more than once — a
  // restatement, a missed document — and the latest is the one being worked on.
  const { data: rows, error } = await sb
    .from('signing_ceremonies')
    .select('*')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`Could not load the signing record: ${error.message}`)
  const row = rows?.[0]
  if (!row) return null

  const { data: documents, error: documentError } = await sb
    .from('ceremony_documents')
    .select('*')
    .eq('ceremony_id', row.id)

  if (documentError) throw new Error(`Could not load the signed documents: ${documentError.message}`)

  return {
    id: String(row.id),
    matterId: String(row.matter_id),
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    originalsLocation: ((row as Record<string, unknown>).originals_location as string | null) ?? null,
    notaryName: (row.notary_name as string | null) ?? null,
    witnessOneName: (row.witness_one_name as string | null) ?? null,
    witnessTwoName: (row.witness_two_name as string | null) ?? null,
    healthCareAgentName: (row.health_care_agent_name as string | null) ?? null,
    status: (row.status as CeremonyStatus) ?? 'scheduled',
    completedAt: (row.completed_at as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    documents: (documents ?? []).map((doc) => ({
      documentKind: doc.document_kind as DocumentKind,
      executed: Boolean(doc.executed),
      signedOn: (doc.signed_on as string | null) ?? null,
      witnessCount: Number(doc.witness_count ?? 0),
      notarized: Boolean(doc.notarized),
      recordedOn: (doc.recorded_on as string | null) ?? null,
      recordingReference: (doc.recording_reference as string | null) ?? null,
      note: (doc.note as string | null) ?? null,
      executedDocumentId: ((doc as Record<string, unknown>).executed_document_id as string | null) ?? null,
    })),
  }
}

/**
 * Each matter's most recent signing status, for counting what is still to be
 * signed across many matters at once. A matter with no appointment recorded
 * is absent from the map.
 */
export async function loadCeremonyStatuses(
  client: SupabaseClient<GeneratedDatabase>,
  matterIds: readonly string[],
): Promise<Map<string, CeremonyStatus>> {
  const statuses = new Map<string, CeremonyStatus>()
  if (matterIds.length === 0) return statuses

  const { data: rows, error } = await client
    .from('signing_ceremonies')
    .select('matter_id, status, created_at')
    .in('matter_id', [...matterIds])
  if (error) throw new Error(`Could not load signing records: ${error.message}`)

  // The latest per matter, as `loadCeremony` reads it: a matter can be signed more than once.
  const latestAt = new Map<string, string>()
  for (const row of rows ?? []) {
    const matterId = String(row.matter_id)
    const createdAt = String(row.created_at ?? '')
    if ((latestAt.get(matterId) ?? '') > createdAt) continue
    latestAt.set(matterId, createdAt)
    statuses.set(matterId, (row.status as CeremonyStatus | null) ?? 'scheduled')
  }
  return statuses
}

export interface SaveCeremonyInput extends CeremonyRoles {
  matterId: string
  ceremonyId: string | null
  scheduledFor: string | null
  location: string | null
  /** Omit to leave the stored value alone; null clears it. */
  originalsLocation?: string | null
  status: CeremonyStatus
  note: string | null
  userId: string
}

export async function saveCeremony(
  client: SupabaseClient<GeneratedDatabase>,
  input: SaveCeremonyInput,
): Promise<{ ok: true; ceremonyId: string } | { ok: false; message: string }> {
  const sb = client
  const row = {
    matter_id: input.matterId,
    scheduled_for: input.scheduledFor,
    location: input.location,
    notary_name: input.notaryName,
    witness_one_name: input.witnessOneName,
    witness_two_name: input.witnessTwoName,
    health_care_agent_name: input.healthCareAgentName,
    status: input.status,
    // The database also refuses a completed ceremony with no time; setting it
    // here means the attorney never meets that constraint as an error.
    completed_at: input.status === 'completed' ? new Date().toISOString() : null,
    note: input.note,
    updated_at: new Date().toISOString(),
    ...(input.originalsLocation !== undefined ? { originals_location: input.originalsLocation } : {}),
  }

  const query = input.ceremonyId
    ? sb
        .from('signing_ceremonies')
        .update(row)
        .eq('id', input.ceremonyId)
        .eq('matter_id', input.matterId)
        .select('id')
        .single()
    : sb
        .from('signing_ceremonies')
        .insert({ ...row, created_by: input.userId })
        .select('id')
        .single()

  const { data, error } = await query
  if (error) return { ok: false, message: error.message }
  return { ok: true, ceremonyId: String(data.id) }
}

export interface SaveDocumentInput {
  matterId: string
  ceremonyId: string
  documentKind: DocumentKind
  executed: boolean
  signedOn: string | null
  witnessCount: number
  notarized: boolean
  recordedOn: string | null
  recordingReference: string | null
  note: string | null
  /** The filed scan this record describes; omit to leave the stored link alone. */
  executedDocumentId?: string | null
}

export async function saveCeremonyDocument(
  client: SupabaseClient<GeneratedDatabase>,
  input: SaveDocumentInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.executed && !input.signedOn) {
    return { ok: false, message: 'Recording a document as signed needs the date it was signed.' }
  }

  // The form names both; a ceremony id from another matter must not be writable from this one.
  const { data: owner, error: ownerError } = await client
    .from('signing_ceremonies')
    .select('id')
    .eq('id', input.ceremonyId)
    .eq('matter_id', input.matterId)
    .maybeSingle()
  if (ownerError) return { ok: false, message: ownerError.message }
  if (!owner) return { ok: false, message: 'That signing appointment is not on this matter.' }

  const { error } = await client
    .from('ceremony_documents')
    .upsert(
      {
        ceremony_id: input.ceremonyId,
        document_kind: input.documentKind,
        executed: input.executed,
        signed_on: input.executed ? input.signedOn : null,
        witness_count: input.witnessCount,
        notarized: input.notarized,
        recorded_on: input.recordedOn,
        recording_reference: input.recordingReference,
        note: input.note,
        updated_at: new Date().toISOString(),
        ...(input.executedDocumentId !== undefined ? { executed_document_id: input.executedDocumentId } : {}),
      },
      { onConflict: 'ceremony_id,document_kind' },
    )

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
