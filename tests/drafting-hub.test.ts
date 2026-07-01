import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('drafting hub and workspace', () => {
  it('exposes drafting in admin navigation', () => {
    const adminNav = fs.readFileSync(path.join(process.cwd(), 'app/admin/AdminLayoutClient.tsx'), 'utf8')

    expect(adminNav).toContain("{ href: '/admin/drafting', label: 'Drafting'")
  })

  it('adds an admin drafting route backed by the drafting query layer', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/page.tsx'), 'utf8')
    const query = fs.readFileSync(path.join(process.cwd(), 'lib/queries/drafting.ts'), 'utf8')

    expect(page).toContain("import { fetchDraftingHubMatters } from '@/lib/queries/drafting'")
    expect(page).toContain('<DraftingHubClient matters={matters} />')
    expect(query).toContain(".from('v_matter_pipeline')")
    expect(query).toContain(".from('design_sheets')")
    expect(query).toContain(".from('doc_selections')")
    expect(query).toContain(".select('design_sheet_id, doc_type, variant, party, selected')")
    expect(query).toContain(".from('matter_documents')")
    expect(query).toContain(".eq('folder', 'draft')")
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
    expect(step).toContain('const handlePreflight = () =>')
    expect(step).toContain('fetch(`/api/admin/matters/${matterId}/draft/preflight`')
    expect(step).toContain('const preflightReady = preflight?.matterId === matterId')
    expect(step).toContain('Save Drafts')
    expect(step).toContain('preflight.documentsToGenerate.map')
    expect(step).toContain('preflight.unsupportedDocumentLabels.map')
    // Preflight review is shown in two blocks: missing fields, then errors/warnings
    // (refactored in #297). Both are required before generation is allowed.
    expect(step).toContain('preflight.missing.length > 0 && (')
    expect(step).toContain('preflight.error || preflight.warnings.length > 0')
    expect(step).toContain('disabled={!preflightReady || !preflight?.canGenerate')
  })

  it('lets admins delete recent drafts through the audited document API', () => {
    const review = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/ReviewStep.tsx'), 'utf8')

    expect(review).toContain('deleteDocument')
    expect(review).toContain('getDocumentViewerUrl')
    expect(review).toContain('const handleDelete = async')
    expect(review).toContain('await deleteDocument(doc.id)')
    expect(review).toContain('setDeletedIds')
    expect(review).toContain('<Trash2 className="h-3.5 w-3.5" />')
  })

  it('lets admins approve one recent draft into client review through the audited document API', () => {
    const review = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/ReviewStep.tsx'), 'utf8')

    expect(review).toContain('updateDocumentFolder')
    expect(review).toContain('const [approvingId, setApprovingId] = useState<string | null>(null)')
    expect(review).toContain('const [promotedIds, setPromotedIds] = useState<Set<string>>(() => new Set())')
    expect(review).toContain('const confirmPromotion = async')
    expect(review).toContain("await updateDocumentFolder(doc.id, toFolder, { confirmed: true })")
    expect(review).toContain("logMatterActivity(matterId, 'draft_promoted_to_review'")
    expect(review).toContain('setPromotedIds')
    expect(review).toContain('Share PDF')
    expect(review).toContain('<Send className="h-3.5 w-3.5" />')
  })

  it('requires the shared attorney review dialog before approving a draft to client review', () => {
    const review = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/ReviewStep.tsx'), 'utf8')
    const approveSlice = review.slice(
      review.indexOf('const handleApprove'),
      review.indexOf('const confirmPromotion'),
    )

    expect(review).toContain("import('@/components/documents/PromoteDocumentDialog')")
    expect(review).toContain('const [pendingPromotion, setPendingPromotion] = useState<')
    expect(review).toContain("{ doc: DraftingHubDocument; toFolder: MatterDocument['folder'] } | null")
    expect(approveSlice).toContain("setPendingPromotion({ doc, toFolder: 'review' })")
    expect(approveSlice).not.toContain('window.confirm')
    expect(review).toContain('<PromoteDocumentDialog')
    expect(review).toContain('pending={pendingPromotion}')
    expect(review).toContain('onConfirm={confirmPromotion}')
  })

  it('seeds intake values through design-sheet persistence instead of writing virtual columns', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/page.tsx'), 'utf8')
    const seedSection = page.slice(
      page.indexOf('const seedPayload = buildDesignSheetPersistencePayload'),
      page.indexOf('.update({'),
    )

    expect(page).toContain("import { buildDesignSheetPersistencePayload } from '@/lib/designSheetPersistence'")
    expect(seedSection).toContain('street: intakeSnapshot.address_line1')
    expect(seedSection).toContain('city: intakeSnapshot.city')
    expect(page).toContain('...seedPayload')
  })
})
