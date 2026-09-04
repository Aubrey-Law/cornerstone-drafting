import { describe, expect, it, vi, beforeEach } from 'vitest'
import JSZip from 'jszip'

// vi.mock is hoisted above the imports, so the static import below still gets
// the mocked module — and a static import keeps tsc happy about top-level await.
const mocks = vi.hoisted(() => ({ loadR2Bytes: vi.fn<(key: string) => Promise<Buffer>>() }))
vi.mock('@/lib/documentApiHelpers', () => ({ loadR2Bytes: mocks.loadR2Bytes }))

import { checkDocumentShareable, describeShareBlock } from '@/lib/documents/shareGate'

const loadR2Bytes = mocks.loadR2Bytes

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function docxContaining(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

function candidate(overrides: Partial<Parameters<typeof checkDocumentShareable>[0]> = {}) {
  return {
    r2_key: 'matters/m1/draft/trust.docx',
    name: 'Trust.docx',
    content_type: DOCX,
    source: 'firm',
    missing_count: 0,
    ...overrides,
  }
}

beforeEach(() => {
  loadR2Bytes.mockReset()
})

describe('sharing a document with the client', () => {
  it('allows a clean generated document', async () => {
    loadR2Bytes.mockResolvedValue(await docxContaining('The Trustee shall serve without bond.'))
    expect(await checkDocumentShareable(candidate())).toEqual({ shareable: true })
  })

  /**
   * The case this exists for. A Health Care Proxy with no agent phone numbers
   * is not signable, and until now nothing stopped it reaching a client — the
   * marker scan only ever produced a badge.
   */
  it('blocks a document with unfilled generator fields, naming them', async () => {
    loadR2Bytes.mockResolvedValue(
      await docxContaining(
        'Telephone: [[ MISSING: healthcare.agent.primary.phone ]] and [[ MISSING: client.street_address ]]',
      ),
    )
    const check = await checkDocumentShareable(candidate())
    expect(check.shareable).toBe(false)
    if (check.shareable) return
    if (check.shareable || check.reason !== 'missing_fields') return
    expect(check.missingFields).toEqual([
      'client.street_address',
      'healthcare.agent.primary.phone',
    ])
    expect(describeShareBlock(check)).toContain('healthcare.agent.primary.phone')
  })

  /**
   * Scope. `[TODO:` clause text and leftover `{{ }}` syntax still only warn —
   * the owner's decision was to block on missing fields alone, which are always
   * unintentional.
   */
  it('does not block on TODO clause text or leftover template syntax', async () => {
    loadR2Bytes.mockResolvedValue(
      await docxContaining('[TODO: ATTORNEY-APPROVED CLAUSE] and {{ client.full_name }}'),
    )
    expect(await checkDocumentShareable(candidate())).toEqual({ shareable: true })
  })

  /**
   * The blanks an attorney leaves on purpose are not markers, so the gate must
   * not touch a document that is complete but unsigned.
   */
  it('allows signature and date blanks', async () => {
    loadR2Bytes.mockResolvedValue(
      await docxContaining('I sign this on this ____ day of __________, 20___.'),
    )
    expect(await checkDocumentShareable(candidate())).toEqual({ shareable: true })
  })

  it('never gates a document the client uploaded themselves', async () => {
    expect(await checkDocumentShareable(candidate({ source: 'client' }))).toEqual({
      shareable: true,
    })
    expect(loadR2Bytes).not.toHaveBeenCalled()
  })

  /**
   * scanDocxBufferForMarkers reports clean on a buffer it cannot open — correct
   * for a report that must not throw mid-upload, and exactly wrong for a gate,
   * where it would turn "unreadable" into "nothing wrong with it".
   */
  it('refuses rather than passing a file it cannot open', async () => {
    loadR2Bytes.mockResolvedValue(Buffer.from('not a zip at all'))
    const check = await checkDocumentShareable(candidate())
    expect(check.shareable).toBe(false)
    if (check.shareable) return
    expect(check.reason).toBe('unverifiable')
    expect(describeShareBlock(check)).toContain('could not be checked')
  })

  it('refuses when the bytes cannot be fetched, rather than assuming clean', async () => {
    loadR2Bytes.mockRejectedValue(new Error('NoSuchKey'))
    const check = await checkDocumentShareable(candidate())
    expect(check.shareable).toBe(false)
    if (check.shareable) return
    if (check.shareable || check.reason !== 'unverifiable') return
    expect(check.detail).toContain('NoSuchKey')
  })

  it('recognises a .docx by name when the content type is missing', async () => {
    loadR2Bytes.mockResolvedValue(await docxContaining('[[ MISSING: client.street_address ]]'))
    const check = await checkDocumentShareable(candidate({ content_type: null }))
    expect(check.shareable).toBe(false)
  })

  /**
   * A PDF render of a marked-up document shows the markers just as plainly, so
   * converting to PDF must not be a way around the gate. convert-pdf now copies
   * the source document's count instead of claiming zero.
   */
  it('blocks a converted PDF that inherited a non-zero count', async () => {
    const check = await checkDocumentShareable(
      candidate({ content_type: 'application/pdf', name: 'Trust.pdf', missing_count: 4 }),
    )
    expect(check.shareable).toBe(false)
    if (check.shareable || check.reason !== 'missing_fields') return
    expect(check.missingFields[0]).toContain('4 unfilled fields')
    expect(loadR2Bytes).not.toHaveBeenCalled()
  })

  it('allows a PDF with nothing recorded against it', async () => {
    expect(
      await checkDocumentShareable(
        candidate({ content_type: 'application/pdf', name: 'Trust.pdf', missing_count: null }),
      ),
    ).toEqual({ shareable: true })
  })

  it('speaks about one missing field in the singular', async () => {
    const check = await checkDocumentShareable(
      candidate({ content_type: 'application/pdf', name: 'x.pdf', missing_count: 1 }),
    )
    expect(check.shareable).toBe(false)
    if (check.shareable || check.reason !== 'missing_fields') return
    expect(check.missingFields[0]).toBe('1 unfilled field')
  })
})
