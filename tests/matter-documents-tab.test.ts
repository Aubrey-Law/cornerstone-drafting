import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const matterRoute = path.join(process.cwd(), 'app/admin/matters/[id]')
const tabPath = path.join(matterRoute, 'MatterDocumentsTab.tsx')
const clientPath = path.join(matterRoute, 'MatterDetailClient.tsx')
const workspacePath = path.join(matterRoute, 'MatterDocumentsWorkspace.tsx')

describe('matter documents tab', () => {
  it('is wired into the matter page', () => {
    const client = readFileSync(clientPath, 'utf8')
    const workspace = readFileSync(workspacePath, 'utf8')
    expect(client).toContain('<MatterDocumentsWorkspace')
    expect(workspace).toContain("import { MatterDocumentsTab } from './MatterDocumentsTab'")
    expect(workspace).toContain('<MatterDocumentsTab')
    expect(workspace).toContain('documents={documents}')
    expect(workspace).toContain('onDocumentsChanged={reload}')
  })

  it('shares with a toggle and keeps the surviving document actions', () => {
    const source = readFileSync(tabPath, 'utf8')

    for (const helper of [
      'setDocumentShared',
      'deleteDocument',
      'downloadDocumentsZip',
      'getDocumentAuditEvents',
      'isWordDocument',
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

  it('lists derived and attorney-created folders through one resolver', () => {
    const source = readFileSync(tabPath, 'utf8')

    // Derived folders (provenance + lifecycle) and stored ones
    // (matter_document_folders, 20261002000000) share a single id space, so
    // the tab must never reach for the derived-only key helper directly.
    expect(source).toContain('documentFolderId')
    expect(source).toContain('documentFolderViews')
    expect(source).toContain('resolveFolderLabel')
    expect(source).toContain('setOpenFolder')
    expect(source).not.toContain('documentFolderKey')
    expect(source).not.toContain('DOCUMENT_FOLDERS')
    expect(source).not.toContain('PromoteDocumentDialog')
    expect(source).not.toContain('getDocumentShareEligibility')
    expect(source).not.toContain('visibilityFilter')
  })

  it('creates, renames, deletes folders and moves documents into them', () => {
    const source = readFileSync(tabPath, 'utf8')

    for (const helper of [
      'createDocumentFolder',
      'renameDocumentFolder',
      'deleteDocumentFolder',
      'moveDocumentToFolder',
    ]) {
      expect(source).toContain(helper)
    }

    for (const label of ['New folder', 'Move to folder', 'Rename folder', 'Delete folder']) {
      expect(source).toContain(label)
    }

    // Deleting a folder must never read as deleting what is inside it.
    expect(source).toContain('they move back to All documents')
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
