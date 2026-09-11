import { documentReviewRevision } from '@/lib/documents/reviewRevision'
import { DEFAULT_HUB_VIEW, HUB_PAGE_SIZE, type HubPageQuery } from '@/lib/drafting/hubView'
import { EMPTY_HUB_COUNTS, type DraftingHubPage } from '@/lib/drafting/hub'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { docSelectionTemplateKey } from '@/lib/drafting/docSelectionKey'
import { getDocumentInclusions, DESIGN_DOCUMENT_LABELS, type DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { getDraftSetupBlockers } from '@/lib/matterSetup'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterDocument, PipelineMatter } from '@/types/database'

interface DesignSheetSummaryRow {
  id: string
  matter_id: string
  status: string | null
  version: number | null
  plan_type: string | null
  decisions: Record<string, unknown> | null
  created_at?: string | null
  updated_at?: string | null
}

/** Matter stages where document-production work is still an active next action. */
export const DRAFTING_QUEUE_STAGES = [
  'design',
  'drafting',
  'client_review',
  'drafts_approved',
  'revision',
] as const

interface DocSelectionRow {
  design_sheet_id: string
  doc_type: string | null
  variant: string | null
  party: string | null
  selected: boolean | null
}

export interface DraftingHubDocument {
  reviewRevision?: string
  id: string
  name: string
  size: number
  created_at: string
  generationId: string | null
  generationEngine: string | null
  markerCount: number | null
  missingCount: number | null
  supersededAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}

export interface DraftingHubMatter {
  matter: PipelineMatter
  matterNumber: string | null
  setupBlockers: string[]
  designSheet: {
    id: string
    status: string | null
    version: number | null
    updatedAt: string | null
  } | null
  documentInclusions: DesignDocumentInclusions | null
  includedDocumentLabels: string[]
  selectedTemplateCount: number
  selectedTemplates: string[]
  /** Count of current (non-superseded) drafts. */
  draftCount: number
  /** Current drafts, most recent first. Hub previews may cap this collection. */
  recentDrafts: DraftingHubDocument[]
  /** Drafts replaced by a later generation run; hidden unless explicitly shown. */
  supersededDrafts: DraftingHubDocument[]
  supersededDraftCount: number
}

function normalizeFlags(m: PipelineMatter): PipelineMatter {
  const raw = m.flags as unknown
  if (raw == null) return { ...m, flags: null }
  if (Array.isArray(raw)) return m
  if (typeof raw === 'string') {
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const inner = raw.slice(1, -1).trim()
      if (!inner) return { ...m, flags: [] }
      return { ...m, flags: inner.split(',').map(s => s.trim().replace(/^"|"$/g, '')) }
    }
    return { ...m, flags: raw ? [raw] : [] }
  }
  return { ...m, flags: [] }
}

function inclusionLabels(inclusions: DesignDocumentInclusions | null) {
  if (!inclusions) return []
  const labels = (Object.entries(DESIGN_DOCUMENT_LABELS) as Array<[keyof typeof DESIGN_DOCUMENT_LABELS, string]>)
    .filter(([key]) => inclusions[key])
    .map(([, label]) => label)
  if (inclusions.spouse_docs) labels.push('Spouse / partner documents')
  return labels
}

function mapHubDraftRow(doc: {
  r2_key?: string
  current_version_id?: string | null
  id: string
  name: string
  size: number
  created_at: string
  generationId?: string | null
  generationEngine?: string | null
  markerCount?: number | null
  missingCount?: number | null
  supersededAt?: string | null
  reviewedAt?: string | null
  reviewedBy?: string | null
}): DraftingHubDocument {
  return {
    reviewRevision: doc.r2_key ? documentReviewRevision({ r2_key: doc.r2_key, current_version_id: doc.current_version_id }) : undefined,
    id: doc.id,
    name: doc.name,
    size: doc.size,
    created_at: doc.created_at,
    generationId: doc.generationId ?? null,
    generationEngine: doc.generationEngine ?? null,
    markerCount: doc.markerCount ?? null,
    missingCount: doc.missingCount ?? null,
    supersededAt: doc.supersededAt ?? null,
    reviewedAt: doc.reviewedAt ?? null,
    reviewedBy: doc.reviewedBy ?? null,
  }
}

interface HubPageRow {
  matter: PipelineMatter
  sheet: DesignSheetSummaryRow | null
  matterNumber: string | null
  selections: DocSelectionRow[]
  currentDraftCount: number
  supersededDraftCount: number
  recentDrafts: Array<DraftingHubDocument & { r2_key: string; current_version_id: string | null }>
}

/** One database snapshot owns facets, total, ordering, page clamping and rows. */
export async function fetchDraftingHubMatters(
  query: HubPageQuery = { ...DEFAULT_HUB_VIEW, page: 1 },
): Promise<DraftingHubPage> {
  const admin = getAdminClient()
  // The additive RPC is deployed with this release; keep its boundary explicit
  // until the next generated Database refresh includes the new function.
  const rpc = admin.rpc.bind(admin) as unknown as (name: 'drafting_hub_page', args: {
    p_search: string; p_action: string; p_practice: string; p_sort: string; p_page: number; p_page_size: number
  }) => Promise<{ data: (Omit<DraftingHubPage, 'matters' | 'error'> & { rows: HubPageRow[] }) | null; error: { message: string } | null }>
  const { data, error } = await rpc('drafting_hub_page', {
    p_search: query.search, p_action: query.action, p_practice: query.practice,
    p_sort: query.sort, p_page: query.page, p_page_size: HUB_PAGE_SIZE,
  })
  if (error || !data) {
    return { matters: [], total: 0, page: 1, pageSize: HUB_PAGE_SIZE,
      actionCounts: { ...EMPTY_HUB_COUNTS }, practiceCounts: [], error: error?.message ?? 'No worklist response' }
  }
  return {
    total: data.total, page: data.page, pageSize: data.pageSize,
    actionCounts: { ...EMPTY_HUB_COUNTS, ...data.actionCounts }, practiceCounts: data.practiceCounts,
    matters: data.rows.map(row => assembleDraftingHubMatter({
      matter: normalizeFlags(row.matter), sheet: row.sheet, details: null,
      matterNumber: row.matterNumber,
      selectedTemplates: row.selections.map(docSelectionTemplateKey).filter((key): key is string => Boolean(key)),
      currentDraftCount: row.currentDraftCount, recentDrafts: row.recentDrafts.map(mapHubDraftRow),
      supersededDraftCount: row.supersededDraftCount, supersededDrafts: [],
    })),
    error: null,
  }
}

function assembleDraftingHubMatter(args: {
  matter: PipelineMatter
  sheet: DesignSheetSummaryRow | null
  details: MatterDetailsRow | null
  matterNumber: string | null
  selectedTemplates: string[]
  currentDraftCount: number
  recentDrafts: DraftingHubDocument[]
  supersededDrafts: DraftingHubDocument[]
  supersededDraftCount: number
}): DraftingHubMatter {
  const {
    matter,
    sheet,
    details,
    matterNumber,
    selectedTemplates,
    currentDraftCount,
    recentDrafts,
    supersededDrafts,
    supersededDraftCount,
  } = args
  const inclusions = sheet
    ? getDocumentInclusions({
        plan_type: sheet.plan_type,
        marital_status: matter.marital_status,
        decisions: sheet.decisions,
      })
    : null

  return {
    matter,
    matterNumber,
    setupBlockers: getDraftSetupBlockers(details, matter),
    designSheet: sheet
      ? {
          id: sheet.id,
          status: sheet.status,
          version: sheet.version,
          updatedAt: sheet.updated_at ?? sheet.created_at ?? null,
        }
      : null,
    documentInclusions: inclusions,
    includedDocumentLabels: inclusionLabels(inclusions),
    selectedTemplateCount: selectedTemplates.length,
    selectedTemplates,
    draftCount: currentDraftCount,
    recentDrafts,
    supersededDrafts,
    supersededDraftCount,
  }
}

/** Scoped hub row for a single matter — avoids firm-wide fetch on workspace open. */
export async function fetchDraftingHubMatter(matterId: string): Promise<{
  matter: DraftingHubMatter | null
  error: string | null
}> {
  const admin = getAdminClient()
  const { data: matterRaw, error: mattersError } = await admin
    .from('v_matter_pipeline')
    .select('*')
    .eq('matter_id', matterId)
    .maybeSingle()

  if (mattersError) {
    console.error('fetchDraftingHubMatter matters error:', mattersError)
    return { matter: null, error: mattersError.message }
  }
  if (!matterRaw) return { matter: null, error: null }

  const matter = normalizeFlags(matterRaw as PipelineMatter)

  const [designSheetsRes, detailsRes, draftDocsRes, matterNumbersRes] = await Promise.all([
    admin
      .from('design_sheets')
      .select('id, matter_id, status, version, plan_type, decisions, created_at, updated_at')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: false })
      .limit(1),
    admin.from('matter_details').select('*').eq('client_id', matterId).maybeSingle(),
    admin
      .from('matter_documents')
      .select(
        'id, matter_id, name, size, created_at, generation_id, generation_engine, marker_count, missing_count, superseded_at, reviewed_at, reviewed_by, r2_key, current_version_id',
      )
      .eq('matter_id', matterId)
      .eq('source', 'firm')
      .order('created_at', { ascending: false }),
    admin.from('matters').select('id, matter_number').eq('id', matterId).maybeSingle(),
  ])

  if (designSheetsRes.error) console.error('fetchDraftingHubMatter design sheets error:', designSheetsRes.error)
  if (detailsRes.error) console.error('fetchDraftingHubMatter matter details error:', detailsRes.error)
  if (draftDocsRes.error) console.error('fetchDraftingHubMatter draft docs error:', draftDocsRes.error)
  if (matterNumbersRes.error) console.error('fetchDraftingHubMatter matter numbers error:', matterNumbersRes.error)

  const sheet = ((designSheetsRes.data ?? []) as DesignSheetSummaryRow[])[0] ?? null
  let selectedTemplates: string[] = []
  if (sheet?.id) {
    const selectionsRes = await admin
      .from('doc_selections')
      .select('design_sheet_id, doc_type, variant, party, selected')
      .eq('design_sheet_id', sheet.id)
      .eq('selected', true)
    if (selectionsRes.error) console.error('fetchDraftingHubMatter doc selections error:', selectionsRes.error)
    selectedTemplates = ((selectionsRes.data ?? []) as DocSelectionRow[])
      .map(docSelectionTemplateKey)
      .filter((key): key is string => Boolean(key))
  }

  const drafts: DraftingHubDocument[] = (
    (draftDocsRes.data ?? []) as Array<
      Pick<
        MatterDocument,
        | 'id'
        | 'matter_id'
        | 'name'
        | 'size'
        | 'created_at'
        | 'generation_id'
        | 'generation_engine'
        | 'marker_count'
        | 'missing_count'
        | 'superseded_at'
        | 'reviewed_at'
        | 'reviewed_by'
        | 'r2_key'
        | 'current_version_id'
      >
    >
  ).map(doc => ({
    reviewRevision: doc.r2_key ? documentReviewRevision({ r2_key: doc.r2_key, current_version_id: doc.current_version_id }) : undefined,
    id: doc.id,
    name: doc.name,
    size: doc.size,
    created_at: doc.created_at,
    generationId: doc.generation_id ?? null,
    generationEngine: doc.generation_engine ?? null,
    markerCount: doc.marker_count ?? null,
    missingCount: doc.missing_count ?? null,
    supersededAt: doc.superseded_at ?? null,
    reviewedAt: doc.reviewed_at ?? null,
    reviewedBy: doc.reviewed_by ?? null,
  }))

  const currentDrafts = drafts.filter(draft => !draft.supersededAt)
  const supersededDrafts = drafts.filter(draft => draft.supersededAt)

  return {
    matter: assembleDraftingHubMatter({
      matter,
      sheet,
      details: (detailsRes.data as MatterDetailsRow | null) ?? null,
      matterNumber: (matterNumbersRes.data as { matter_number: string | null } | null)?.matter_number ?? null,
      selectedTemplates,
      currentDraftCount: currentDrafts.length,
      // The matter workspace is the review surface, so it must receive every
      // current draft. Only the multi-matter hub preview is capped at five.
      recentDrafts: currentDrafts,
      supersededDrafts,
      supersededDraftCount: supersededDrafts.length,
    }),
    error: null,
  }
}
