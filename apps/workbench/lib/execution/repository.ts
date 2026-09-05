import type { SupabaseClient } from '@supabase/supabase-js'

export interface ExecutionMatter {
  matterId: string
  title: string
  stage: string | null
  documentNames: string[]
}

function untyped(client: SupabaseClient<never>): SupabaseClient {
  return client as unknown as SupabaseClient
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
  client: SupabaseClient<never>,
  options: { matterId?: string } = {},
): Promise<ExecutionMatter[]> {
  const sb = untyped(client)

  let matterQuery = sb.from('matters').select('id, name, stage').eq('relationship_status', 'hired')
  if (options.matterId) matterQuery = matterQuery.eq('id', options.matterId)

  const { data: matters, error: matterError } = await matterQuery
  if (matterError) throw new Error(`Could not load matters: ${matterError.message}`)
  if (!matters || matters.length === 0) return []

  const { data: documents, error: documentError } = await sb
    .from('matter_documents')
    .select('matter_id, name')
    .in('matter_id', matters.map((m) => String(m.id)))
    .is('superseded_at', null)

  if (documentError) throw new Error(`Could not load documents: ${documentError.message}`)

  return matters.map((matter) => ({
    matterId: String(matter.id),
    title: (matter.name as string | null) ?? 'Untitled matter',
    stage: (matter.stage as string | null) ?? null,
    documentNames: (documents ?? [])
      .filter((d) => String(d.matter_id) === String(matter.id))
      .map((d) => String(d.name)),
  }))
}
