import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'

// Build a minimal DOCX (a zip with word/document.xml) the scanner can read.
function docxBuffer(documentXml: string): Buffer {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>')
  zip.file('word/document.xml', documentXml)
  return zip.generate({ type: 'nodebuffer' }) as Buffer
}

function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
}

function paragraph(...runs: string[]): string {
  return `<w:p>${runs.join('')}</w:p>`
}

function body(...paras: string[]): string {
  return `<?xml version="1.0"?><w:document><w:body>${paras.join('')}</w:body></w:document>`
}

describe('scanDocxBufferForMarkers', () => {
  it('detects each marker type in a generated document', () => {
    const xml = body(
      paragraph(run('Successor Trustee: '), run('[[ MISSING: client.county ]]')),
      paragraph(run('[TODO: ATTORNEY-APPROVED NO-CONTEST CLAUSE — confirm [SPOUSE FULL NAME] ]')),
      paragraph(run('{{ leftover.tag }}')),
      paragraph(run('[ALT PERSONAL REPRESENTATIVE]')),
    )

    const scan = scanDocxBufferForMarkers(docxBuffer(xml))

    expect(scan.todoCount).toBe(1)
    expect(scan.missingFields).toEqual(['client.county'])
    expect(scan.unresolved).toContain('{{ leftover.tag }}')
    expect(scan.unresolved).toContain('[ALT PERSONAL REPRESENTATIVE]')
    // markerCount is internally consistent and loud.
    expect(scan.markerCount).toBe(scan.todoCount + scan.unresolved.length + scan.missingFields.length)
    expect(scan.markerCount).toBeGreaterThan(0)
  })

  it('catches a marker split across multiple runs', () => {
    const xml = body(paragraph(run('intro '), run('[[ MISS'), run('ING: trust.name ]] tail')))

    const scan = scanDocxBufferForMarkers(docxBuffer(xml))

    expect(scan.missingFields).toEqual(['trust.name'])
  })

  it('reports a clean document as having no markers', () => {
    const xml = body(paragraph(run('The Grantor hereby establishes the Smith Family Trust.')))

    const scan = scanDocxBufferForMarkers(docxBuffer(xml))

    expect(scan.markerCount).toBe(0)
    expect(scan.todoCount).toBe(0)
    expect(scan.unresolved).toEqual([])
    expect(scan.missingFields).toEqual([])
  })

  it('counts repeated TODO markers and dedupes identical missing fields', () => {
    const xml = body(
      paragraph(run('[TODO: bond language]'), run(' and '), run('[TODO: simultaneous death]')),
      paragraph(run('[[ MISSING: client.full_name ]]'), run('[[ MISSING: client.full_name ]]')),
    )

    const scan = scanDocxBufferForMarkers(docxBuffer(xml))

    expect(scan.todoCount).toBe(2)
    expect(scan.missingFields).toEqual(['client.full_name'])
  })

  it('reports clean rather than throwing on a non-DOCX buffer', () => {
    const scan = scanDocxBufferForMarkers(Buffer.from('not a zip at all'))

    expect(scan).toEqual({ todoCount: 0, unresolved: [], missingFields: [], markerCount: 0 })
  })
})

describe('draft route marker scan wiring', () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'app/api/admin/matters/[id]/draft/route.ts'),
    'utf8',
  )

  it('imports the scanner and scans each buffer before uploading to R2', () => {
    expect(routeSource).toContain("import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'")
    expect(routeSource).toContain('scanDocxBufferForMarkers(file.buffer)')
    expect(routeSource.indexOf('scanDocxBufferForMarkers(file.buffer)')).toBeLessThan(
      routeSource.indexOf('new PutObjectCommand'),
    )
  })

  it('returns per-document reports and a blocking-marker flag', () => {
    expect(routeSource).toContain('documentReports')
    expect(routeSource).toContain('hasBlockingMarkers')
    expect(routeSource).toContain('report.markerCount > 0')
  })
})
