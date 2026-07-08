import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  applyTrackedEdits,
  extractDocxBodyText,
  extractTrackedChangeIds,
  resolveTrackedChange,
} from '@/lib/docxTrackedChanges'

async function minimalDocx(paragraphText: string): Promise<Buffer> {
  const zip = new JSZip()
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">${paragraphText}</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
  zip.file('word/document.xml', xml)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

describe('docxTrackedChanges', () => {
  it('applies a tracked substitution and accepts it', async () => {
    const input = await minimalDocx('Hello world')
    const applied = await applyTrackedEdits(
      input,
      [
        {
          find: 'world',
          replace: 'universe',
          context_before: 'Hello ',
          context_after: '',
          reason: 'test',
        },
      ],
      { author: 'Cornerstone' },
    )

    expect(applied.changes.length).toBe(1)
    expect(applied.errors.length).toBe(0)

    const ids = await extractTrackedChangeIds(applied.bytes)
    expect(ids.some(i => i.kind === 'ins')).toBe(true)
    expect(ids.some(i => i.kind === 'del')).toBe(true)

    // Accepted view should already show the insertion text
    const accepted = await extractDocxBodyText(applied.bytes)
    expect(accepted).toContain('universe')

    const wIds = ids.map(i => i.w_id)
    const resolved = await resolveTrackedChange(applied.bytes, wIds, 'accept')
    expect(resolved.found).toBeGreaterThan(0)
    const finalText = await extractDocxBodyText(resolved.bytes)
    expect(finalText.replace(/\s+/g, ' ').trim()).toBe('Hello universe')
  })
})
