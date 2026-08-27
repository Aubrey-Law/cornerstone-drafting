import { describe, expect, it } from 'vitest'
import PizZip from 'pizzip'
import { applyStyleSetToDocxBuffer } from '@/lib/styleSets/applyToDocx'
import { AUBREY_HOUSE_STYLE_SET } from '@/lib/styleSets/defaults'
import { PRESERVE_ALL_SETTINGS } from '@/lib/styleSets/schema'

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="56"/></w:rPr></w:style>
</w:styles>`

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p>
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`

function buildDocx(): Buffer {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>')
  zip.file('word/document.xml', DOCUMENT_XML)
  zip.file('word/styles.xml', STYLES_XML)
  // A non-word/ part and a binary part: neither carries formatting.
  zip.file('docProps/app.xml', '<?xml version="1.0"?><Properties/>')
  zip.file('word/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return Buffer.from(zip.generate({ type: 'uint8array', compression: 'DEFLATE' }))
}

describe('applyStyleSetToDocxBuffer', () => {
  it('changes nothing when every setting is "preserve"', () => {
    const { changedParts } = applyStyleSetToDocxBuffer(buildDocx(), PRESERVE_ALL_SETTINGS)
    expect(changedParts).toEqual([])
  })

  it('applies the house style to styles.xml and reports which parts moved', () => {
    const { buffer, changedParts } = applyStyleSetToDocxBuffer(buildDocx(), AUBREY_HOUSE_STYLE_SET)
    expect(changedParts).toContain('word/styles.xml')

    const styles = new PizZip(buffer).file('word/styles.xml')!.asText()
    expect(styles).toContain('Garamond')
    // The house style caps titles at 14pt; OOXML stores half-points.
    expect(styles).toMatch(/w:styleId="Title"[\s\S]*?<w:sz w:val="28"/)
  })

  it('leaves non-word parts and binary media untouched', () => {
    const { buffer, changedParts } = applyStyleSetToDocxBuffer(buildDocx(), AUBREY_HOUSE_STYLE_SET)
    expect(changedParts).not.toContain('docProps/app.xml')

    const zip = new PizZip(buffer)
    expect(zip.file('docProps/app.xml')!.asText()).toBe('<?xml version="1.0"?><Properties/>')
    expect(Array.from(zip.file('word/media/image1.png')!.asUint8Array())).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ])
  })

  it('produces an archive that reopens cleanly', () => {
    const { buffer } = applyStyleSetToDocxBuffer(buildDocx(), AUBREY_HOUSE_STYLE_SET)
    const reopened = new PizZip(buffer)
    expect(Object.keys(reopened.files).sort()).toEqual([
      '[Content_Types].xml',
      'docProps/app.xml',
      'word/document.xml',
      'word/media/image1.png',
      'word/styles.xml',
    ])
  })

  it('is idempotent — running it twice is the same as running it once', () => {
    const once = applyStyleSetToDocxBuffer(buildDocx(), AUBREY_HOUSE_STYLE_SET)
    const twice = applyStyleSetToDocxBuffer(once.buffer, AUBREY_HOUSE_STYLE_SET)
    expect(twice.changedParts).toEqual([])
  })
})
