import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'
import { resolveDocumentTemplate } from '@/lib/documentTemplates/resolver'

/**
 * Hash the complete active estate-template set. Publication uses the same
 * server-derived value as preview, so any bundled file or published template
 * change invalidates earlier preview evidence.
 */
export async function currentEstateTemplateSnapshotHash(client: SupabaseClient): Promise<string> {
  const entries: string[] = []
  for (const definition of getDocumentTemplateRegistry().filter(item => item.category === 'estate')) {
    const resolved = await resolveDocumentTemplate(definition.id, client)
    entries.push(`${definition.id}:${resolved.versionId ?? 'bundled'}:${resolved.sha256}`)
  }
  return createHash('sha256').update(entries.sort().join('\n')).digest('hex')
}
