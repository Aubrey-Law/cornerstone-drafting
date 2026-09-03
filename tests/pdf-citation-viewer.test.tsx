// @vitest-environment jsdom

import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PdfCitationViewer } from '@/components/documents/PdfCitationViewer'
import { citationIsStale } from '@/lib/textLayer/persist'
import type { Citation, TextLayer } from '@/lib/textLayer/types'

afterEach(cleanup)

/**
 * A two-line paragraph on one page, with the geometry an extractor would
 * record: PDF points, top-left origin, one span per drawn line.
 */
const LAYER: TextLayer = {
  sourceKind: 'pdf',
  status: 'ok',
  extractor: 'pdfjs',
  extractorVersion: '1',
  sourceSha256: 'a'.repeat(64),
  pageCount: 1,
  text: 'No bond or other security\nshall be required of any Trustee',
  blocks: [
    {
      index: 0,
      charStart: 0,
      charEnd: 58,
      text: 'No bond or other security\nshall be required of any Trustee',
      page: 1,
      bbox: { x: 72, y: 60, width: 300, height: 28 },
    },
  ],
  spans: [
    { charStart: 0, charEnd: 25, page: 1, bbox: { x: 72, y: 60, width: 125, height: 12 } },
    { charStart: 26, charEnd: 58, page: 1, bbox: { x: 72, y: 76, width: 155, height: 12 } },
  ],
}

const CITATION: Citation = {
  blockIndex: 0,
  charStart: 0,
  charEnd: 58,
  page: 1,
  bbox: { x: 72, y: 60, width: 300, height: 28 },
  quote: LAYER.text,
  verification: 'verified',
}

describe('PdfCitationViewer', () => {
  /**
   * The component is not yet mounted by any route, so `next build` does not
   * compile it. Rendering it here is what proves it is valid, and keeps a
   * broken viewer from sitting unnoticed until the phase that wires it up.
   */
  it('renders without a document rather than throwing', () => {
    const { container } = render(
      <PdfCitationViewer bytes={null} layer={LAYER} citation={CITATION} />,
    )
    expect(container.querySelector('[data-testid="pdf-citation-viewer"]')).not.toBeNull()
  })

  it('renders nothing to highlight when there is no citation', () => {
    const { container } = render(<PdfCitationViewer bytes={null} layer={LAYER} citation={null} />)
    expect(container.querySelectorAll('[data-page-number]')).toHaveLength(0)
  })
})

describe('citation staleness', () => {
  /**
   * The cheap half of staleness, and the one worth running before an export: if
   * the layer no longer slices to the stored quote, the citation is wrong now
   * whatever the reason.
   */
  it('accepts a citation whose offsets still slice to its quote', () => {
    expect(citationIsStale(LAYER, CITATION)).toBe(false)
  })

  it('rejects a citation whose offsets have drifted', () => {
    expect(citationIsStale(LAYER, { ...CITATION, charStart: 3 })).toBe(true)
  })

  it('rejects a citation against a document that has been rewritten under it', () => {
    const edited: TextLayer = { ...LAYER, text: LAYER.text.replace('No bond', 'No surety bond') }
    expect(citationIsStale(edited, CITATION)).toBe(true)
  })
})
