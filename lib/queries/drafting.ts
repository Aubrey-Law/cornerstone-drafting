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

interface DocSelectionRow {
  design_sheet_id: string
  doc_type: string | null
  variant: string | null
  party: string | null
  selected: boolean | null
}

export interface DraftingHubDocument {
  id: string
  name: string
  size: number
  created_at: string
  folder: MatterDocument['folder']
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
  /** Current drafts (most recent first), capped for display. */
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

export async function fetchDraftingHubMatters(): Promise<{
  matters: DraftingHubMatter[]
  error: string | null
}> {
  const admin = getAdminClient()
  const { data: mattersRaw, error: mattersError } = await admin
    .from('v_matter_pipeline')
    .select('*')
    .neq('stage', 'closed')
    .order('matter_created', { ascending: false })

  if (mattersError) {
    console.error('fetchDraftingHubMatters matters error:', mattersError)
    return { matters: [], error: mattersError.message }
  }

  const matters = ((mattersRaw ?? []) as PipelineMatter[]).map(normalizeFlags)
  const matterIds = matters.map(matter => matter.matter_id)
  if (matterIds.length === 0) return { matters: [], error: null }

  const [
    designSheetsRes,
    detailsRes,
    draftDocsRes,
    matterNumbersRes,
  ] = await Promise.all([
    admin
      .from('design_sheets')
      .select('id, matter_id, status, version, plan_type, decisions, created_at, updated_at')
      .in('matter_id', matterIds)
      .order('created_at', { ascending: false }),
    admin
      .from('matter_details')
      .select('*')
      .in('client_id', matterIds),
    admin
      .from('matter_documents')
      .select('id, matter_id, name, size, created_at, generation_id, generation_engine, marker_count, missing_count, superseded_at, reviewed_at, reviewed_by')
      .in('matter_id', matterIds)
      .eq('folder', 'draft')
      .order('created_at', { ascending: false }),
    admin
      .from('matters')
      .select('id, matter_number')
      .in('id', matterIds),
  ])

  if (designSheetsRes.error) console.error('fetchDraftingHubMatters design sheets error:', designSheetsRes.error)
  if (detailsRes.error) console.error('fetchDraftingHubMatters matter details error:', detailsRes.error)
  if (draftDocsRes.error) console.error('fetchDraftingHubMatters draft docs error:', draftDocsRes.error)
  if (matterNumbersRes.error) console.error('fetchDraftingHubMatters matter numbers error:', matterNumbersRes.error)

  const designSheets = (designSheetsRes.data ?? []) as DesignSheetSummaryRow[]
  const latestDesignByMatter = new Map<string, DesignSheetSummaryRow>()
  for (const sheet of designSheets) {
    if (!latestDesignByMatter.has(sheet.matter_id)) latestDesignByMatter.set(sheet.matter_id, sheet)
  }

  const designSheetIds = Array.from(latestDesignByMatter.values()).map(sheet => sheet.id)
  const selectionsRes = designSheetIds.length
    ? await admin
        .from('doc_selections')
        .select('design_sheet_id, doc_type, variant, party, selected')
        .in('design_sheet_id', designSheetIds)
        .eq('selected', true)
    : { data: [] as DocSelectionRow[], error: null }

  if (selectionsRes.error) console.error('fetchDraftingHubMatters doc selections error:', selectionsRes.error)

  const selectionsBySheet = new Map<string, string[]>()
  for (const selection of (selectionsRes.data ?? []) as DocSelectionRow[]) {
    const templateKey = docSelectionTemplateKey(selection)
    if (!templateKey) continue
    const list = selectionsBySheet.get(selection.design_sheet_id) ?? []
    list.push(templateKey)
    selectionsBySheet.set(selection.design_sheet_id, list)
  }

  const detailsByMatter = new Map<string, MatterDetailsRow>()
  for (const detail of (detailsRes.data ?? []) as MatterDetailsRow[]) {
    if (detail.client_id) detailsByMatter.set(detail.client_id, detail)
  }

  const matterNumberById = new Map<string, string | null>()
  for (const row of (matterNumbersRes.data ?? []) as Array<{ id: string; matter_number: string | null }>) {
    matterNumberById.set(row.id, row.matter_number)
  }

  const draftsByMatter = new Map<string, DraftingHubDocument[]>()
  for (const doc of (draftDocsRes.data ?? []) as Array<Pick<
    MatterDocument,
    'id' | 'matter_id' | 'name' | 'size' | 'created_at' | 'generation_id' | 'generation_engine' | 'marker_count' | 'missing_count' | 'superseded_at' | 'reviewed_at' | 'reviewed_by'
  >>) {
    const list = draftsByMatter.get(doc.matter_id) ?? []
    list.push({
      id: doc.id,
      name: doc.name,
      size: doc.size,
      created_at: doc.created_at,
      folder: 'draft',
      generationId: doc.generation_id ?? null,
      generationEngine: doc.generation_engine ?? null,
      markerCount: doc.marker_count ?? null,
      missingCount: doc.missing_count ?? null,
      supersededAt: doc.superseded_at ?? null,
      reviewedAt: doc.reviewed_at ?? null,
      reviewedBy: doc.reviewed_by ?? null,
    })
    draftsByMatter.set(doc.matter_id, list)
  }

  return {
    matters: matters.map(matter =>
      assembleDraftingHubMatter({
        matter,
        sheet: latestDesignByMatter.get(matter.matter_id) ?? null,
        details: detailsByMatter.get(matter.matter_id) ?? null,
        matterNumber: matterNumberById.get(matter.matter_id) ?? null,
        selectedTemplates: (() => {
          const sheet = latestDesignByMatter.get(matter.matter_id)
          return sheet ? selectionsBySheet.get(sheet.id) ?? [] : []
        })(),
        drafts: draftsByMatter.get(matter.matter_id) ?? [],
      }),
    ),
    error: null,
  }
}

function assembleDraftingHubMatter(args: {
  matter: PipelineMatter
  sheet: DesignSheetSummaryRow | null
  details: MatterDetailsRow | null
  matterNumber: string | null
  selectedTemplates: string[]
  drafts: DraftingHubDocument[]
}): DraftingHubMatter {
  const { matter, sheet, details, matterNumber, selectedTemplates, drafts } = args
  const inclusions = sheet
    ? getDocumentInclusions({
        plan_type: sheet.plan_type,
        marital_status: matter.marital_status,
        decisions: sheet.decisions,
      })
    : null
  const currentDrafts = drafts.filter(draft => !draft.supersededAt)
  const supersededDrafts = drafts.filter(draft => draft.supersededAt)

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
    draftCount: currentDrafts.length,
    recentDrafts: currentDrafts.slice(0, 5),
    supersededDrafts,
    supersededDraftCount: supersededDrafts.length,
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
        'id, matter_id, name, size, created_at, generation_id, generation_engine, marker_count, missing_count, superseded_at, reviewed_at, reviewed_by',
      )
      .eq('matter_id', matterId)
      .eq('folder', 'draft')
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
      >
    >
  ).map(doc => ({
    id: doc.id,
    name: doc.name,
    size: doc.size,
    created_at: doc.created_at,
    folder: 'draft' as const,
    generationId: doc.generation_id ?? null,
    generationEngine: doc.generation_engine ?? null,
    markerCount: doc.marker_count ?? null,
    missingCount: doc.missing_count ?? null,
    supersededAt: doc.superseded_at ?? null,
    reviewedAt: doc.reviewed_at ?? null,
    reviewedBy: doc.reviewed_by ?? null,
  }))

  return {
    matter: assembleDraftingHubMatter({
      matter,
      sheet,
      details: (detailsRes.data as MatterDetailsRow | null) ?? null,
      matterNumber: (matterNumbersRes.data as { matter_number: string | null } | null)?.matter_number ?? null,
      selectedTemplates,
      drafts,
    }),
    error: null,
  }
}
