import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Word previews once built a Microsoft Office Online URL around a signed R2
 * link (`view.officeapps.live.com/op/view.aspx?src=<signed url>`) and opened it
 * for the client portal, the matter documents tab, and the drafting review
 * step. That handed a short-lived but public URL for a client's will or trust
 * to a third-party service purely to render it.
 *
 * The replacement is `/api/documents/[id]/preview`, which authenticates the
 * reader, checks `userCanReadDocument`, and converts the DOCX in-process.
 * These tests exist so the external path cannot come back unnoticed.
 */
describe('document preview confidentiality', () => {
  const tracked = () =>
    execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter(file => !file.startsWith('tests/'))

  it('never sends a document URL to an external office viewer', () => {
    const offenders = tracked().filter(file => {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8')
      return /officeapps\.live\.com|view\.officeapps|docs\.google\.com\/viewer|toMicrosoftOfficeViewerUrl/.test(source)
    })

    expect(offenders).toEqual([])
  })

  it('previews Word documents through the authenticated in-app route', () => {
    const documents = readFileSync(path.join(process.cwd(), 'lib/documents.ts'), 'utf8')

    expect(documents).toContain("fetch(`/api/documents/${docId}/preview`")
    expect(documents).toContain('export async function getDocumentPreview')
    // The Word-aware viewer-URL helper is gone; callers take the preview route.
    expect(documents).not.toContain('getDocumentViewerUrl')
  })

  it('routes every Word view action to the in-app preview dialog', () => {
    for (const file of [
      'app/(portal)/documents/PortalDocumentList.tsx',
      'app/admin/matters/[id]/MatterDocumentsTab.tsx',
      'app/admin/drafting/[matterId]/ReviewStep.tsx',
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(source, `${file} must guard the view action on isWordDocument`).toMatch(
        /action === 'view' && isWordDocument\(/,
      )
      expect(source, `${file} must mount the preview dialog`).toContain('DocumentPreviewDialog')
    }
  })

  it('sanitizes converted DOCX markup before it reaches the DOM', () => {
    const dialog = readFileSync(
      path.join(process.cwd(), 'components/documents/DocumentPreviewDialog.tsx'),
      'utf8',
    )

    expect(dialog).toContain('DOMPurify.sanitize')
    expect(dialog).toContain('dangerouslySetInnerHTML={{ __html: safeHtml }}')
    expect(dialog).not.toContain('dangerouslySetInnerHTML={{ __html: html }}')
  })
})
