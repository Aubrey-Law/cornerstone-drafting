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
      'deleteDocument',
      'downloadDocumentsZip',
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
      'View',
      'Download',
      'Rename',
      'Move',
      'Delete',
      'Client visible',
      'Internal',
      'Reviewed',
      'Markers',
      'Superseded',
    ]) {
      expect(source).toContain(label)
    }

    for (const folder of ['draft', 'review', 'final', 'signed', 'client', 'intake', 'meeting-notes']) {
      expect(source).toContain(`value: '${folder}'`)
    }
  })
})
