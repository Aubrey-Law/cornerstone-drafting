import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, readReviewUpload } from '@/lib/review/upload'

const form = (file?: File) => {
  const data = new FormData()
  if (file) data.set('document', file)
  return data
}

const pdf = (name = 'draft.pdf', size = 1024) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' })

describe('readReviewUpload', () => {
  it('reads the document and its name', async () => {
    const result = await readReviewUpload(form(pdf()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.filename).toBe('draft.pdf')
    expect(result.bytes.byteLength).toBe(1024)
  })

  it('reports a request with no document', async () => {
    const result = await readReviewUpload(form())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/choose a document|no document/i)
  })

  it('names the formats a citation can be anchored in', async () => {
    const result = await readReviewUpload(form(new File(['x'], 'scan.jpg', { type: 'image/jpeg' })))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/PDF|DOCX/)
  })

  it('rejects an empty file rather than reviewing nothing', async () => {
    const result = await readReviewUpload(form(pdf('draft.pdf', 0)))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/empty/i)
  })

  /**
   * Extraction holds the whole document in memory and the text layer goes into
   * a JSON response, so an unbounded upload is a way to exhaust the function's
   * memory. The limit is stated in the message because a silent rejection reads
   * as a broken form.
   */
  it('rejects a document past the size limit, saying what the limit is', async () => {
    const result = await readReviewUpload(form(pdf('huge.pdf', MAX_UPLOAD_BYTES + 1)))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/\b25\b|too large/i)
  })

  it('trusts the extension rather than the browser-supplied MIME type', async () => {
    // Browsers disagree about the DOCX type, and some send an empty string;
    // the extension is what the extractor is chosen by anyway.
    const docx = new File([new Uint8Array(16)], 'smith trust.docx', { type: '' })
    expect((await readReviewUpload(form(docx))).ok).toBe(true)
  })
})
