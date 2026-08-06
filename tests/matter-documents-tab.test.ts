import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const matterRoute = path.join(process.cwd(), 'app/admin/matters/[id]')
const tabPath = path.join(matterRoute, 'MatterDocumentsTab.tsx')
const clientPath = path.join(matterRoute, 'MatterDetailClient.tsx')

describe('matter documents tab', () => {
  it('is wired into the matter page', () => {
    const client = readFileSync(clientPath, 'utf8')
    expect(client).toContain("import { MatterDocumentsTab } from './MatterDocumentsTab'")
    expect(client).toContain('<MatterDocumentsTab')
    expect(client).toContain('documents={documents}')
    expect(client).toContain('onDocumentsChanged={loadDocuments}')
  })

  it('shares with a toggle and keeps the surviving document actions', () => {
    const source = readFileSync(tabPath, 'utf8')

    for (const helper of [
      'setDocumentShared',
      'deleteDocument',
      'downloadDocumentsZip',
      'getDocumentAuditEvents',
      'getDocumentViewerUrl',
      'getDocumentUrl',
      'renameDocument',
      'uploadDocument',
    ]) {
      expect(source).toContain(helper)
    }

    for (const label of [
      'Upload',
      'Download selected',
      'Share',
      'Unshare',
      'Combine Word documents',
      'View',
      'Download',
      'Rename',
      'History',
      'Delete',
      'From client',
    ]) {
      expect(source).toContain(label)
    }

    expect(source).toContain('DocumentStatusBadges')
    expect(source).toContain('DocumentPreviewDialog')
    expect(source).toContain('CombineWordDraftsDialog')
    expect(source).toContain('unreviewedUploadCounts')
    expect(source).toContain('onReviewPortalUploads')
  })

  it('groups into folders without writing a folder anywhere', () => {
    const source = readFileSync(tabPath, 'utf8')

    // Folders are derived from provenance and lifecycle. The stored folder
    // column is gone (20260806135231_drop_document_folders), so nothing here
    // may move, promote, or persist one.
    expect(source).toContain('documentFolderKey')
    expect(source).toContain('DOCUMENT_FOLDERS')
    expect(source).toContain('setOpenFolder')
    expect(source).not.toContain('PromoteDocumentDialog')
    expect(source).not.toContain('Bulk move')
    expect(source).not.toContain('updateDocumentFolder')
    expect(source).not.toContain('doc.folder')
    expect(source).not.toContain('getDocumentShareEligibility')
    expect(source).not.toContain('visibilityFilter')
  })

  it('carries the file-manager toolbar: search, filter, and sort', () => {
    const source = readFileSync(tabPath, 'utf8')
    expect(source).toContain('Search for files and folders')
    expect(source).toContain('Sort:')
    expect(source).toContain('setSortKey')
    expect(source).toContain('Select all listed documents')
    expect(source).toContain('Folder breadcrumb')
  })
})
