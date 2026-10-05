import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { isStoredDocumentKind, resolveDocumentKinds, type KindedDocument } from '@/lib/execution/documentKind'
import type { DocumentKind } from '@/lib/execution/requirements'

export interface ExecutionMatter {
  matterId: string
  title: string
  stage: string | null
  documentNames: string[]
  /** Each current document with the kind the generator recorded, when it did. */
  documents: KindedDocument[]
}

/** The kinds a matter's documents are: the recorded kind first, the filename guess for the rest. */
export function executionKinds(matter: Pick<ExecutionMatter, 'documents'>): { kinds: DocumentKind[]; unmatched: string[] } {
  return resolveDocumentKinds(matter.documents)
}

/**
 * Matters and the documents drafted for them.
 *
 * `matter_documents.matter_id` is `text` with no foreign key — a known wart of
 * the old schema — so the join happens here rather than in the query.
 * Superseded documents are excluded: a signing appointment is about the current
 * draft, and an old version in the list would be a document to sign twice.
 */
export async function loadExecutionMatters(
  client: SupabaseClient<GeneratedDatabase>,
  options: { matterId?: string } = {},
): Promise<ExecutionMatter[]> {
  const sb = client

  let matterQuery = sb.from('matters').select('id, name, stage').eq('relationship_status', 'hired')
  if (options.matterId) matterQuery = matterQuery.eq('id', options.matterId)

  const { data: matters, error: matterError } = await matterQuery
  if (matterError) throw new Error(`Could not load matters: ${matterError.message}`)
  if (!matters || matters.length === 0) return []

  // `document_kind` arrived with 20270108090000 and is read loosely until the
  // generated types catch up with the deployed schema.
  const documentResult = await sb
    .from('matter_documents')
    .select('matter_id, name, document_kind')
    .in('matter_id', matters.map((m) => String(m.id)))
    .is('superseded_at', null)
  const documentError = documentResult.error
  const documents = (documentResult.data ?? []) as unknown as Array<{ matter_id: string; name: string; document_kind?: string | null }>

  if (documentError) throw new Error(`Could not load documents: ${documentError.message}`)

  return matters.map((matter) => ({
    matterId: String(matter.id),
    title: (matter.name as string | null) ?? 'Untitled matter',
    stage: (matter.stage as string | null) ?? null,
    documentNames: documents
      .filter((d) => String(d.matter_id) === String(matter.id))
      .map((d) => String(d.name)),
    documents: documents
      .filter((d) => String(d.matter_id) === String(matter.id))
      .map((d) => ({
        name: String(d.name),
        kind: isStoredDocumentKind(d.document_kind) ? d.document_kind : null,
      })),
  }))
}
