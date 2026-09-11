import 'server-only'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadMatterContacts } from '@/lib/contacts/loadMatterContacts'
import { loadEstateClauseSnapshot } from '@/lib/estateClauses/source'
import type { EstateClauseClient } from '@/lib/estateClauses/repository'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { resolveEstateGeneratorEngine } from '@/lib/estateGenerator/engine'
import { sourceRevision } from './runState'
import type { DesignSheet, MatterContact } from '@/types/database'
import type { DraftDocumentSelection } from './generateDocuments'

export function draftingSheetInputs(sheet: DesignSheet | null) {
  if (!sheet) return null
  const workflowFields = new Set(['status', 'created_at', 'updated_at', 'version', 'approved_at', 'approved_by', 'generated_at', 'generated_by'])
  return Object.fromEntries(Object.entries(sheet).filter(([key]) => !workflowFields.has(key)))
}

/** Capture the data used by estate and deed rendering, including clause overrides. */
export async function loadDraftSourceSnapshot(matterId: string) {
  const payload = await buildDraftPayload(matterId)
  const admin = getAdminClient()
  const engine = resolveEstateGeneratorEngine()
  const [sheetResult, contacts, clauseSnapshot, selectionResult] = await Promise.all([
    payload.design_sheet_id ? admin.from('design_sheets').select('*').eq('id', payload.design_sheet_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    loadMatterContacts(admin, matterId),
    engine === 'node' ? loadEstateClauseSnapshot({ matterId, jurisdiction: normalizeJurisdictionStateCode(payload.client.state), client: admin as unknown as EstateClauseClient, allowDraft: true }) : Promise.resolve(undefined),
    engine === 'supabase' && payload.design_sheet_id ? admin.from('doc_selections').select('doc_type, variant, party, selected').eq('design_sheet_id', payload.design_sheet_id).eq('selected', true).order('sort_order', { ascending: true }) : Promise.resolve({ data: [], error: null }),
  ])
  if (selectionResult.error) throw new Error('Could not load selected templates. Try again.')
  if (sheetResult.error) throw new Error('Could not load current design decisions. Try again.')
  const sheet = sheetResult.data as DesignSheet | null
  const sortedContacts = [...contacts].sort((a, b) => String(a.id).localeCompare(String(b.id))) as unknown as MatterContact[]
  const selections = (selectionResult.data ?? []) as DraftDocumentSelection[]
  return { payload, sheet, selections, contacts: sortedContacts, clauseSnapshot, revision: sourceRevision({ payload, sheet: draftingSheetInputs(sheet), selections, contacts: sortedContacts, clauseSnapshot, engine }) }
}
