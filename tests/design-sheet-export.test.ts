import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('design sheet Word export', () => {
  it('adds an authenticated admin route that exports the design summary via the estate generator', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/matters/[id]/design-sheet/export/route.ts'), 'utf8')

    expect(route).toContain('requireAdmin(req)')
    expect(route).toContain('buildDraftPayload')
    expect(route).toContain('generateNodeEstatePackage')
    expect(route).toContain("'design-summary'")
    expect(route).toContain('payload.design_sheet_id')
    expect(route).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(route).toContain('application/zip')
    expect(route).toContain('Content-Disposition')
  })

  it('exports the two-settlor interview worksheet for a separate-trusts matter', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/matters/[id]/design-sheet/export/route.ts'), 'utf8')

    expect(route).toContain("'design-summary-separate'")
    expect(route).toContain('payload.trust?.separate_trusts')

    const manifest = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'tools/aubreylaw-docgeneration/packages/design-summary-separate.json'),
      'utf8',
    )) as { documents: Array<{ template: string }> }
    expect(manifest.documents.map(document => document.template)).toContain(
      'templates/design-summary-worksheet-separate.docx',
    )
  })

  it('wires the design sheet screen button to save first and then download the Word export', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'), 'utf8')
    const state = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/useDesignSheetState.ts'), 'utf8')

    expect(shell).toContain('onExport={handleExportDesignSheet}')
    expect(shell).toContain('DesignToolbarActions')
    expect(state).toContain('const handleExportDesignSheet = useCallback(async () =>')
    expect(state).toContain('const saved = await persistSheet()')
    expect(state).toContain('/api/admin/matters/${matterId}/design-sheet/export')
  })
})
