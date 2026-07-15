import JSZip from 'jszip'

// Combine several .docx files into one by embedding every document after the
// first as an OOXML altChunk (the mechanism behind Word's "Insert > Text from
// File"). Word merges the chunks when the file opens, keeping each source
// document's own styles, numbering, and section layout — a plain body-XML
// splice would instead re-style every document with the host's definitions.

const ALT_CHUNK_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk'
const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PAGE_BREAK_XML = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

async function requireFile(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`Invalid .docx file: missing ${path}`)
  return file.async('string')
}

function addDocxDefaultContentType(contentTypesXml: string): string {
  if (/<Default[^>]*Extension="docx"/i.test(contentTypesXml)) return contentTypesXml
  return contentTypesXml.replace(
    '</Types>',
    `<Default Extension="docx" ContentType="${DOCX_CONTENT_TYPE}"/></Types>`,
  )
}

function nextRelationshipIdBase(relsXml: string): (index: number) => string {
  const usedIds = new Set(Array.from(relsXml.matchAll(/Id="([^"]+)"/g), match => match[1]))
  return (index: number) => {
    let candidate = `rIdAltChunk${index + 1}`
    while (usedIds.has(candidate)) candidate = `${candidate}x`
    usedIds.add(candidate)
    return candidate
  }
}

/**
 * Merge the given .docx files, in order, into a single document. The first
 * file is the host; each subsequent file starts on a new page and renders with
 * its own formatting. Requires at least one file; a single file is returned
 * unchanged.
 */
export async function combineDocxFiles(buffers: Uint8Array[]): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('No documents to combine')
  if (buffers.length === 1) return Buffer.from(buffers[0])

  const host = await JSZip.loadAsync(buffers[0])
  const contentTypes = await requireFile(host, '[Content_Types].xml')
  const rels = await requireFile(host, 'word/_rels/document.xml.rels')
  const documentXml = await requireFile(host, 'word/document.xml')

  const relIdFor = nextRelationshipIdBase(rels)
  let relEntries = ''
  let bodyEntries = ''

  for (let index = 1; index < buffers.length; index += 1) {
    // Validate the chunk is a well-formed docx before embedding it — Word
    // refuses to open the whole combined file over one bad chunk.
    const chunkZip = await JSZip.loadAsync(buffers[index])
    if (!chunkZip.file('word/document.xml')) {
      throw new Error(`Document ${index + 1} is not a valid .docx file`)
    }
    const relId = relIdFor(index - 1)
    const target = `altChunks/chunk${index}.docx`
    host.file(`word/${target}`, buffers[index])
    relEntries += `<Relationship Id="${relId}" Type="${ALT_CHUNK_REL_TYPE}" Target="${target}"/>`
    bodyEntries += `${PAGE_BREAK_XML}<w:altChunk r:id="${relId}"/>`
  }

  host.file('[Content_Types].xml', addDocxDefaultContentType(contentTypes))
  host.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', `${relEntries}</Relationships>`))

  // Append the chunks at the end of the host body, ahead of the body-level
  // sectPr (always the last one in document.xml) so the host's final section
  // properties still close the document.
  const bodySectPrIndex = documentXml.lastIndexOf('<w:sectPr')
  const insertAt = bodySectPrIndex !== -1 ? bodySectPrIndex : documentXml.lastIndexOf('</w:body>')
  if (insertAt === -1) throw new Error('Host document has no body to append to')
  host.file(
    'word/document.xml',
    documentXml.slice(0, insertAt) + bodyEntries + documentXml.slice(insertAt),
  )

  return host.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
