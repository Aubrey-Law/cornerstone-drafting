import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocumentKind } from '@/lib/execution/requirements'
import type { CeremonyRoles, DocumentRecord } from './validation'

/**
 * Columns of the two ceremony tables, declared here because the migration in
 * this change creates them and the generated types have not caught up.
 * `tests/ceremony-schema.test.ts` holds these against the migration's own SQL.
 */
export const SIGNING_CEREMONY_COLUMNS = [
  'id',
  'matter_id',
  'scheduled_for',
  'location',
  'notary_name',
  'witness_one_name',
  'witness_two_name',
  'health_care_agent_name',
  'status',
  'completed_at',
  'note',
  'created_by',
  'created_at',
  'updated_at',
] as const

export const CEREMONY_DOCUMENT_COLUMNS = [
  'id',
  'ceremony_id',
  'document_kind',
  'executed',
  'signed_on',
  'witness_count',
  'notarized',
  'recorded_on',
  'recording_reference',
  'note',
  'created_at',
  'updated_at',
] as const

export type CeremonyStatus = 'scheduled' | 'completed' | 'cancelled'

export interface Ceremony extends CeremonyRoles {
  id: string
  matterId: string
  scheduledFor: string | null
  location: string | null
  status: CeremonyStatus
  completedAt: string | null
  note: string | null
  documents: Array<DocumentRecord & { recordingReference: string | null; note: string | null }>
}

function untyped(client: SupabaseClient<never>): SupabaseClient {
  return client as unknown as SupabaseClient
}

export async function loadCeremony(
  client: SupabaseClient<never>,
  matterId: string,
): Promise<Ceremony | null> {
  const sb = untyped(client)

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
    })),
  }
}

export interface SaveCeremonyInput extends CeremonyRoles {
  matterId: string
  ceremonyId: string | null
  scheduledFor: string | null
  location: string | null
  status: CeremonyStatus
  note: string | null
  userId: string
}

export async function saveCeremony(
  client: SupabaseClient<never>,
  input: SaveCeremonyInput,
): Promise<{ ok: true; ceremonyId: string } | { ok: false; message: string }> {
  const sb = untyped(client)
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
  }

  const query = input.ceremonyId
    ? sb.from('signing_ceremonies').update(row).eq('id', input.ceremonyId).select('id').single()
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
  ceremonyId: string
  documentKind: DocumentKind
  executed: boolean
  signedOn: string | null
  witnessCount: number
  notarized: boolean
  recordedOn: string | null
  recordingReference: string | null
  note: string | null
}

export async function saveCeremonyDocument(
  client: SupabaseClient<never>,
  input: SaveDocumentInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.executed && !input.signedOn) {
    return { ok: false, message: 'Recording a document as signed needs the date it was signed.' }
  }

  const { error } = await untyped(client)
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
      },
      { onConflict: 'ceremony_id,document_kind' },
    )

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
