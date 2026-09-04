import type { SupabaseClient } from '@supabase/supabase-js'
import type { Citation, TextBlock, TextLayer, TextLayerSourceKind, TextSpan } from './types'

/**
 * Reading and writing text layers and citations.
 *
 * The client is passed in rather than imported. These functions are the seam
 * between pure extraction and the database, and keeping the dependency explicit
 * is what lets the extraction and verification code above stay testable without
 * a database — which is most of why the offsets can be trusted at all.
 */

export interface StoredTextLayer extends TextLayer {
  id: string
  documentVersionId: string
}

interface TextLayerRow {
  id: string
  document_version_id: string
  source_kind: string
  status: string
  extractor: string
  extractor_version: string
  source_sha256: string
  page_count: number | null
  text: string
  blocks: unknown
  spans: unknown
}

function rowToLayer(row: TextLayerRow): StoredTextLayer {
  return {
    id: row.id,
    documentVersionId: row.document_version_id,
    sourceKind: row.source_kind as TextLayerSourceKind,
    status: row.status === 'no_text' ? 'no_text' : 'ok',
    extractor: row.extractor,
    extractorVersion: row.extractor_version,
    sourceSha256: row.source_sha256,
    pageCount: row.page_count,
    text: row.text,
    blocks: (row.blocks ?? []) as TextBlock[],
    spans: (row.spans ?? []) as TextSpan[],
  }
}

/**
 * Stores a text layer, replacing any existing one for the same version and
 * source kind.
 *
 * Replacement rather than versioning is right here because a layer is derived
 * data: the document version it describes is immutable, so re-extracting the
 * same bytes under the same extractor can only produce the same layer. What
 * genuinely changes is the *extractor*, and `extractor_version` records which
 * one wrote these offsets — so a citation written under an older one can be
 * marked stale rather than silently trusted.
 */
export async function saveTextLayer(
  admin: SupabaseClient,
  documentVersionId: string,
  layer: TextLayer,
): Promise<StoredTextLayer> {
  const { data, error } = await admin
    .from('document_text_layers')
    .upsert(
      {
        document_version_id: documentVersionId,
        source_kind: layer.sourceKind,
        status: layer.status,
        extractor: layer.extractor,
        extractor_version: layer.extractorVersion,
        source_sha256: layer.sourceSha256,
        page_count: layer.pageCount,
        text: layer.text,
        blocks: layer.blocks,
        spans: layer.spans,
      },
      { onConflict: 'document_version_id,source_kind' },
    )
    .select()
    .single()

  if (error) throw new Error(`Failed to store text layer: ${error.message}`)
  return rowToLayer(data as TextLayerRow)
}

export async function loadTextLayer(
  admin: SupabaseClient,
  documentVersionId: string,
  sourceKind: TextLayerSourceKind,
): Promise<StoredTextLayer | null> {
  const { data, error } = await admin
    .from('document_text_layers')
    .select()
    .eq('document_version_id', documentVersionId)
    .eq('source_kind', sourceKind)
    .maybeSingle()

  if (error) throw new Error(`Failed to load text layer: ${error.message}`)
  return data ? rowToLayer(data as TextLayerRow) : null
}

/**
 * Stores citations for a finding.
 *
 * Unverified citations are dropped here rather than saved with a flag. The
 * schema can hold them — `verification` admits 'unverified' so a later phase
 * can show a reviewer what the model claimed and could not support — but
 * nothing in this slice has a use for one, and writing rows no reader filters
 * on is how an exclusion rule quietly stops being enforced.
 */
export async function saveCitations(
  admin: SupabaseClient,
  textLayerId: string,
  documentVersionId: string,
  citations: Citation[],
): Promise<number> {
  const verified = citations.filter(c => c.verification === 'verified')
  if (verified.length === 0) return 0

  const { error } = await admin.from('workflow_citations').insert(
    verified.map(citation => ({
      text_layer_id: textLayerId,
      document_version_id: documentVersionId,
      block_index: citation.blockIndex,
      char_start: citation.charStart,
      char_end: citation.charEnd,
      page: citation.page,
      bbox: citation.bbox,
      quote: citation.quote,
      verification: citation.verification,
    })),
  )

  if (error) throw new Error(`Failed to store citations: ${error.message}`)
  return verified.length
}

/**
 * Re-checks that a stored citation still addresses the text it claims to.
 *
 * The cheap half of staleness: if the layer's own bytes no longer slice to the
 * stored quote, the citation is wrong now regardless of why. Cheap enough to
 * run before every export, which is where being wrong actually costs something.
 */
export function citationIsStale(layer: TextLayer, citation: Citation): boolean {
  return layer.text.slice(citation.charStart, citation.charEnd) !== citation.quote
}
