import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { combineDocxFiles } from '@/lib/docx/combineDocx'
import { docxAttachmentDisposition } from '@/lib/docx/contentDisposition'

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>'

const DOCUMENT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

async function makeDocx(bodyText: string, { withSectPr = true } = {}): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  zip.file(
    'word/document.xml',
    '<w:document><w:body>' +
    `<w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p>` +
    (withSectPr ? '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>' : '') +
    '</w:body></w:document>',
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function readEntry(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const file = zip.file(path)
  if (!file) throw new Error(`missing ${path}`)
  return file.async('string')
}

describe('combineDocxFiles', () => {
  it('embeds every document after the first as an ordered altChunk', async () => {
    const combined = await combineDocxFiles([
      await makeDocx('Revocable Trust'),
      await makeDocx('Pour-Over Will'),
      await makeDocx('Durable Power of Attorney'),
    ])

    const documentXml = await readEntry(combined, 'word/document.xml')
    // Host content is untouched; chunks are appended before the body sectPr.
    expect(documentXml).toContain('Revocable Trust')
    const firstChunk = documentXml.indexOf('<w:altChunk r:id="rIdAltChunk1"/>')
    const secondChunk = documentXml.indexOf('<w:altChunk r:id="rIdAltChunk2"/>')
    const bodySectPr = documentXml.indexOf('<w:sectPr')
    expect(firstChunk).toBeGreaterThan(-1)
    expect(secondChunk).toBeGreaterThan(firstChunk)
    expect(bodySectPr).toBeGreaterThan(secondChunk)
    // Each appended document starts on a new page.
    expect(documentXml.match(/<w:br w:type="page"\/>/g)).toHaveLength(2)

    const rels = await readEntry(combined, 'word/_rels/document.xml.rels')
    expect(rels).toContain('Id="rIdAltChunk1"')
    expect(rels).toContain('Target="altChunks/chunk1.docx"')
    expect(rels).toContain('Target="altChunks/chunk2.docx"')
    expect(rels).toContain('relationships/aFChunk')

    const contentTypes = await readEntry(combined, '[Content_Types].xml')
    expect(contentTypes).toContain('Extension="docx"')

    // The embedded chunks are the original files, byte-identical content.
    const chunk1 = await JSZip.loadAsync(
      await (await JSZip.loadAsync(combined)).file('word/altChunks/chunk1.docx')!.async('nodebuffer'),
    )
    expect(await chunk1.file('word/document.xml')!.async('string')).toContain('Pour-Over Will')
  })

  it('appends before </w:body> when the host has no section properties', async () => {
    const combined = await combineDocxFiles([
      await makeDocx('Host', { withSectPr: false }),
      await makeDocx('Chunk'),
    ])
    const documentXml = await readEntry(combined, 'word/document.xml')
    expect(documentXml.indexOf('<w:altChunk')).toBeGreaterThan(documentXml.indexOf('Host'))
    expect(documentXml.indexOf('<w:altChunk')).toBeLessThan(documentXml.indexOf('</w:body>'))
  })

  it('avoids relationship id collisions with existing host relationships', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
    zip.file(
      'word/_rels/document.xml.rels',
      DOCUMENT_RELS_XML.replace('rId1', 'rIdAltChunk1'),
    )
    zip.file('word/document.xml', '<w:document><w:body><w:p/></w:body></w:document>')
    const host = await zip.generateAsync({ type: 'nodebuffer' })

    const combined = await combineDocxFiles([host, await makeDocx('Chunk')])
    const rels = await readEntry(combined, 'word/_rels/document.xml.rels')
    expect(rels).toContain('Id="rIdAltChunk1x"')
    const documentXml = await readEntry(combined, 'word/document.xml')
    expect(documentXml).toContain('<w:altChunk r:id="rIdAltChunk1x"/>')
  })

  it('returns a single document unchanged', async () => {
    const original = await makeDocx('Only one')
    const combined = await combineDocxFiles([original])
    expect(Buffer.compare(combined, original)).toBe(0)
  })

  it('rejects an empty document list and non-docx chunks', async () => {
    await expect(combineDocxFiles([])).rejects.toThrow('No documents to combine')
    const notDocx = await new JSZip().file('hello.txt', 'hi').generateAsync({ type: 'nodebuffer' })
    await expect(combineDocxFiles([await makeDocx('Host'), notDocx]))
      .rejects.toThrow('Document 2 is not a valid .docx file')
  })
})

describe('docxAttachmentDisposition', () => {
  it('keeps plain ASCII names intact', () => {
    expect(docxAttachmentDisposition('Cheng Zhang - Combined Drafts')).toBe(
      'attachment; filename="Cheng Zhang - Combined Drafts.docx"; filename*=UTF-8\'\'Cheng%20Zhang%20-%20Combined%20Drafts.docx',
    )
  })

  it('produces a ByteString-safe header for names with em dashes and accents', () => {
    const header = docxAttachmentDisposition('Cheng — Zhang – Décès')
    // Every code point must fit in Latin-1 or the Response constructor throws.
    for (const ch of header) expect(ch.codePointAt(0)!).toBeLessThan(256)
    expect(header).toContain('filename="Cheng - Zhang - D_c_s.docx"')
    expect(header).toContain("filename*=UTF-8''Cheng%20%E2%80%94%20Zhang%20%E2%80%93%20D%C3%A9c%C3%A8s.docx")
  })

  it('escapes quotes and RFC 5987 special characters', () => {
    const header = docxAttachmentDisposition(`Smith "Family" Plan's (v2)`)
    expect(header).toContain('filename="Smith _Family_ Plan\'s (v2).docx"')
    expect(header).toContain("filename*=UTF-8''Smith%20%22Family%22%20Plan%27s%20%28v2%29.docx")
  })

  it('falls back to a generic name when empty', () => {
    expect(docxAttachmentDisposition('  ')).toContain('filename="document.docx"')
  })
})
