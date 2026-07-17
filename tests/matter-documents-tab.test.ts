import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const matterRoute = path.join(process.cwd(), 'app/admin/matters/[id]')
const tabPath = path.join(matterRoute, 'MatterDocumentsTab.tsx')
const clientPath = path.join(matterRoute, 'MatterDetailClient.tsx')

describe('matter documents tab', () => {
  it('uses a dedicated functional document workspace on the matter page', () => {
    const client = readFileSync(clientPath, 'utf8')

    expect(client).toContain("import { MatterDocumentsTab } from './MatterDocumentsTab'")
    expect(client).toContain('<MatterDocumentsTab')
    expect(client).toContain('documents={documents}')
    expect(client).toContain('onDocumentsChanged={loadDocuments}')
  })

  it('exposes document actions, filters, upload folders, and status badges', () => {
    const source = readFileSync(tabPath, 'utf8')

    for (const helper of [
      'buildSelectedDocumentEligibility',
      'deleteDocument',
      'downloadDocumentsZip',
      'getDocumentAuditEvents',
      'getDocumentViewerUrl',
      'getDocumentUrl',
      'renameDocument',
      'updateDocumentFolder',
      'uploadDocument',
    ]) {
      expect(source).toContain(helper)
    }

    for (const label of [
      'Upload',
      'Download selected',
      'Bulk move',
      'Share PDFs',
      'Unshare',
      'Combine Word documents',
      'Preview PDF',
      'View',
      'Download',
      'Rename',
      'Move',
      'Share PDF',
      'Audit',
      'Delete',
      'Internal drafts',
      'Firm-shared PDFs',
      'Client uploads',
      'Portal uploads need review',
      'Marker issues',
      'Superseded',
      'Versioned',
    ]) {
      expect(source).toContain(label)
    }

    expect(source).toContain('DocumentStatusBadges')
    expect(source).toContain('DocumentPreviewDialog')
    expect(source).toContain('PromoteDocumentDialog')
    expect(source).toContain('CombineWordDraftsDialog')
    expect(source).toContain('unreviewedUploadCounts')
    expect(source).toContain('onReviewPortalUploads')
    expect(source).not.toContain('function statusBadges')
    expect(source).not.toContain('const INTERNAL_FOLDERS')
  })

  it('shows folders as the primary workspace instead of an all-folder document filter', () => {
    const source = readFileSync(tabPath, 'utf8')

    expect(source).toContain('activeFolder')
    expect(source).toContain('folderSummaries')
    expect(source).toContain('Select a folder to see its documents')
    expect(source).toContain('No documents in this folder')
    expect(source).toContain('Selected folder')
    expect(source).not.toContain('<SelectItem value="all">All folders</SelectItem>')
  })
})
