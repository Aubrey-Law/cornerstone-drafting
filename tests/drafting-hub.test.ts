import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hubNextActionKey } from '@/lib/drafting/hubUtils'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { PipelineMatter } from '@/types/database'

/**
 * `matter` is deliberately a stub: `hubNextActionKey` reads only `stage`, and
 * spelling out all 27 PipelineMatter fields would say nothing about the
 * behaviour under test. `Partial<DraftingHubMatter>` alone would still demand a
 * complete PipelineMatter from callers overriding it, which is what made the
 * override below a type error.
 */
function draftingQueueItem(
  overrides: Partial<Omit<DraftingHubMatter, 'matter'>> & { matter?: Partial<PipelineMatter> } = {},
): DraftingHubMatter {
  return {
    matter: { matter_id: 'matter-1', stage: 'drafting' },
    matterNumber: '2026-001',
    setupBlockers: [],
    designSheet: { id: 'sheet-1', status: 'draft', version: 1, updatedAt: null },
    documentInclusions: null,
    includedDocumentLabels: ['Will'],
    selectedTemplateCount: 1,
    selectedTemplates: ['will'],
    draftCount: 0,
    recentDrafts: [],
    supersededDrafts: [],
    supersededDraftCount: 0,
    ...overrides,
  } as unknown as DraftingHubMatter
}

describe('drafting hub and workspace', () => {
  it('exposes drafting in admin navigation', () => {
    const adminNav = fs.readFileSync(path.join(process.cwd(), 'app/admin/AdminLayoutClient.tsx'), 'utf8')

    expect(adminNav).toContain("{ href: '/admin/drafting', label: 'Drafting'")
  })

  it('adds an admin drafting route backed by the drafting query layer', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/page.tsx'), 'utf8')
    const query = fs.readFileSync(path.join(process.cwd(), 'lib/queries/drafting.ts'), 'utf8')

    expect(page).toContain("import { fetchDraftingHubMatters } from '@/lib/queries/drafting'")
    expect(page).toContain('<DraftingHubClient matters={matters} loadError={error} />')
    expect(query).toContain(".from('v_matter_pipeline')")
    expect(query).toContain(".in('stage', [...DRAFTING_QUEUE_STAGES])")
    expect(query).toContain(".from('design_sheets')")
    expect(query).toContain(".from('doc_selections')")
    expect(query).toContain(".select('design_sheet_id, doc_type, variant, party, selected')")
    expect(query).toContain(".from('matter_documents')")
    expect(query).toContain("rpc('drafting_hub_draft_rollups'")
    expect(query).toContain("matter.marital_status")
    expect(query).toContain('docSelectionTemplateKey(selection)')
    expect(query).not.toContain('template_filename')
    expect(query).not.toContain('plan_type, marital_status, decisions')
  })

  it('uses the existing matter draft endpoint and displays backend detail errors', () => {
    const step = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/GenerateStep.tsx'), 'utf8')

    expect(step).toContain('fetch(`/api/admin/matters/${matterId}/draft`')
    expect(step).toContain('data.detail ?? data.error ??')
    expect(step).toContain('setResult({ success: false, error: message })')
    expect(step).toContain("logMatterActivity(matterId, 'draft_generated'")
  })

  it('requires a generator preflight review before saving generated drafts', () => {
    const step = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/GenerateStep.tsx'), 'utf8')

    expect(step).toContain('type DraftPreflight')
    expect(step).toContain('const [preflight, setPreflight] = useState<DraftPreflight | null>(null)')
    expect(step).toContain('const handlePreflight = (options?: { quiet?: boolean }) =>')
    // Preflight auto-runs when the step opens so generation is one click.
    expect(step).toContain('handlePreflight({ quiet: true })')
    expect(step).toContain('fetch(`/api/admin/matters/${matterId}/draft/preflight`')
    expect(step).toContain('const preflightReady = preflight?.matterId === matterId')
    expect(step).toContain('Save Drafts')
    expect(step).toContain('preflight.documentsToGenerate.map')
    expect(step).toContain('preflight.unsupportedDocumentLabels.map')
    // Preflight review is shown in two blocks: missing fields, then errors/warnings
    // (refactored in #297). Both are required before generation is allowed.
    expect(step).toContain('preflight.missingFields.length > 0 && (')
    expect(step).toContain('preflight.error || preflight.warnings.length > 0')
    expect(step).toContain(
      'disabled={!authReady || !preflightReady || !preflight?.canGenerate || selectedCount === 0 || busy !== null}',
    )
  })

  it('lets admins delete recent drafts through the audited document API', () => {
    const review = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/ReviewStep.tsx'), 'utf8')

    expect(review).toContain('deleteDocument')
    expect(review).toContain('getDocumentViewerUrl')
    expect(review).toContain('const confirmDelete = async')
    expect(review).toContain('await deleteDocument(doc.id)')
    expect(review).toContain('setDeletedIds')
    expect(review).toContain('<Trash2 className="h-3.5 w-3.5" />')
  })

  it('loads every current draft into the matter review workspace', () => {
    const query = fs.readFileSync(path.join(process.cwd(), 'lib/queries/drafting.ts'), 'utf8')
    const matterQuery = query.slice(query.indexOf('export async function fetchDraftingHubMatter('))

    expect(matterQuery).toContain('recentDrafts: currentDrafts,')
    expect(matterQuery).not.toContain('recentDrafts: currentDrafts.slice(0, 5)')
  })

  it('lets admins approve one recent draft into client review through the audited document API', () => {
    const review = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/ReviewStep.tsx'), 'utf8')

    expect(review).toContain('setDocumentShared')
    expect(review).toContain('const [approvingId, setApprovingId] = useState<string | null>(null)')
    expect(review).toContain('const [promotedIds, setPromotedIds] = useState<Set<string>>(() => new Set())')
    expect(review).toContain('await setDocumentShared(doc.id, true)')
    expect(review).toContain("logMatterActivity(matterId, 'draft_promoted_to_review'")
    expect(review).toContain('setPromotedIds')
    expect(review).toContain('Share PDF')
    expect(review).toContain('<Send className="h-3.5 w-3.5" />')
  })

  it('shares a draft with the client directly, with no promotion dialog', () => {
    const review = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/ReviewStep.tsx'), 'utf8')
    const approveSlice = review.slice(
      review.indexOf('const handleApprove'),
      review.indexOf('const handleConvertPdf'),
    )

    expect(review).not.toContain('PromoteDocumentDialog')
    expect(review).not.toContain('updateDocumentFolder')
    expect(review).toContain('setDocumentShared')
    expect(approveSlice).toContain('setDocumentShared(doc.id, true)')
    expect(approveSlice).not.toContain('window.confirm')
  })

  it('uses a focused next-action queue instead of a second matter-stage pipeline', () => {
    const hub = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/DraftingHubClient.tsx'), 'utf8')
    const table = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/MatterPipelineTable.tsx'), 'utf8')

    expect(hub).toContain('Next actions across active document work')
    expect(hub).toContain('Next action filter')
    expect(hub).toContain('router.refresh()')
    expect(hub).not.toContain('MatterPipelineKanban')
    expect(hub).not.toContain('/admin/matters?create=1')
    expect(table).toContain('hubNextAction(item)')
    expect(table).not.toContain('updateMatterStage')
  })

  it('derives one concrete drafting action from the document-work state', () => {
    expect(hubNextActionKey(draftingQueueItem({ designSheet: null }))).toBe('design')
    expect(hubNextActionKey(draftingQueueItem({ setupBlockers: ['Missing plan type'] }))).toBe('setup')
    expect(hubNextActionKey(draftingQueueItem())).toBe('generate')
    expect(hubNextActionKey(draftingQueueItem({ draftCount: 2 }))).toBe('review')
    expect(hubNextActionKey(draftingQueueItem({
      matter: { matter_id: 'matter-1', stage: 'revision' },
      draftCount: 2,
    }))).toBe('revise')
  })

  it('seeds intake values through the shared ensure helper', () => {
    const loader = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/loadDraftingMatterContext.ts'), 'utf8')
    const seedModule = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/seedFromIntake.ts'), 'utf8')
    const ensureModule = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/ensureDesignSheetSeeded.ts'), 'utf8')
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260723000000_lite_design_sheets_excluded_guardian.sql'),
      'utf8',
    )

    expect(loader).toContain("import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'")
    expect(loader).toContain('ensureDesignSheetSeededFromIntake(matterId, { sheet, intake: intakeSnapshot })')
    expect(loader).toContain('ensureDesignSheetSeededFromIntake failed')
    expect(seedModule).toContain('street: intake.address_line1')
    expect(seedModule).toContain('city: intake.city')
    expect(ensureModule).toContain('ensureBlankDesignSheet')
    expect(migration).toContain('excluded_guardian_flag')
    expect(migration).toContain('excluded_guardian_name')
  })

  it('lazy-loads generate and review steps in the drafting workspace', () => {
    const workspace = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/DraftingWorkspace.tsx'),
      'utf8',
    )

    expect(workspace).toContain("import dynamic from 'next/dynamic'")
    expect(workspace).toContain("dynamic(() => import('./GenerateStep')")
    expect(workspace).toContain("dynamic(() => import('./ReviewStep')")
    expect(workspace).not.toContain("import GenerateStep from './GenerateStep'")
    expect(workspace).not.toContain("import ReviewStep from './ReviewStep'")
  })

  it('debounces design readiness in the shared design sheet state hook', () => {
    const state = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/useDesignSheetState.ts'), 'utf8')

    expect(state).toContain('READINESS_DEBOUNCE_MS = 300')
    expect(state).toContain('setReadinessSheet(sheet)')
    expect(state).toContain('sheet: readinessSheet')
    expect(state).toContain('shouldApplyServerSheetProps')
    expect(state).not.toContain('propsSheetStampRef.current = savedAt')
  })

  it('keeps design sheet state above the single-page sheet in the drafting workspace', () => {
    const workspace = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/DraftingWorkspace.tsx'),
      'utf8',
    )
    expect(workspace).toContain('useDesignSheetState({')
    expect(workspace).toContain('designState={designState}')
    expect(workspace).toContain('<DesignSheetPage')
    expect(workspace).not.toContain('<ExpressDesignSheet')
  })

  it('offers a direct path back to the matter from the drafting workspace', () => {
    const workspace = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/DraftingWorkspace.tsx'),
      'utf8',
    )

    expect(workspace).toContain('href={`/admin/matters/${matterId}`}')
    expect(workspace).toContain('Back to matter')
  })

  it('prefetches drafting workspace routes on hub hover', () => {
    const table = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/MatterPipelineTable.tsx'), 'utf8')
    expect(table).toContain('useDebouncedPrefetch')
  })

  it('documents the one-way intake sync policy in Intake Review', () => {
    const intakeSection = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/IntakeSection.tsx'),
      'utf8',
    )

    expect(intakeSection).toContain('Intake updates do not overwrite your design sheet automatically')
    expect(intakeSection).toContain('Re-sync from intake')
    expect(intakeSection).toContain('IntakeResyncDialog')
  })
})
