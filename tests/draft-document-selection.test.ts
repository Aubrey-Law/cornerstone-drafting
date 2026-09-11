import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('draft document selection', () => {
  it('lets the drafting workspace choose which documents to save', () => {
    const step = read('app/admin/drafting/[matterId]/GenerateStep.tsx')

    // Selection state, defaulting to all documents when the preflight loads.
    expect(step).toContain("import { Checkbox } from '@/components/ui/checkbox'")
    expect(step).toContain('const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())')
    expect(step).toContain('setSelectedDocs(new Set(Array.isArray(remembered) ? remembered.filter(name => available.includes(name)) : available))')

    // A checkbox per document plus a select-all/clear toggle.
    expect(step).toContain('onCheckedChange={() => toggleDoc(d.filename)}')
    expect(step).toContain('const toggleAllDocs = ')

    // Only the selected documents are sent to the generation endpoint, and
    // generation is blocked when nothing is selected.
    expect(step).toContain('body: JSON.stringify({ documents: retry?.requested_documents ?? documentsToSave, mode, runId: activeRunId.current, sourceRevision: retry?.source_revision ?? preflight?.sourceRevision })')
    expect(step).toContain('if (documentsToSave.length === 0)')
    expect(step).toContain('selectedCount === 0')
  })

  it('saves only the requested documents in the draft route', () => {
    const route = read('app/api/admin/matters/[id]/draft/route.ts')

    expect(route).toContain('const selectedDocuments = requestedDocuments.length > 0')
    expect(route).toContain('generatedFiles.filter(file => selectedDocuments.has(file.filename))')
    expect(route).toContain('None of the selected documents were available to generate.')
    expect(route).toContain("deliveryMode === 'download'")
    expect(route).toContain('buildDraftDownloadArtifacts')
    expect(route).toContain("'Content-Type': 'application/zip'")
  })

  it('lets the drafting workspace download drafts instead of saving them to the matter', () => {
    const step = read('app/admin/drafting/[matterId]/GenerateStep.tsx')

    expect(step).toContain("type DraftDeliveryMode = 'save' | 'download'")
    expect(step).toContain('const [deliveryMode, setDeliveryMode] = useState<DraftDeliveryMode>(\'save\')')
    expect(step).toContain('Download only')
    expect(step).toContain("body: JSON.stringify({ documents: retry?.requested_documents ?? documentsToSave, mode, runId: activeRunId.current, sourceRevision: retry?.source_revision ?? preflight?.sourceRevision })")
    expect(step).toContain("decodeDraftDownloadMeta")
    expect(step).toContain('anchor.download = filename')
  })
})
