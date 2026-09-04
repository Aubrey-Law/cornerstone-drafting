// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BlockTextViewer } from '@/app/review/BlockTextViewer'
import type { Citation, TextLayer } from '@aubrey-law/citations/textLayer/types'

afterEach(cleanup)

const FIRST = 'ARTICLE VII. TRUSTEE POWERS'
const SECOND = 'The Trustee shall not be liable except for willful misconduct.'
const TEXT = `${FIRST}\n\n${SECOND}`

const layer: TextLayer = {
  sourceKind: 'docx',
  status: 'ok',
  extractor: 'test',
  extractorVersion: '1',
  sourceSha256: 'a'.repeat(64),
  pageCount: null,
  text: TEXT,
  blocks: [
    { index: 0, charStart: 0, charEnd: FIRST.length, text: FIRST, page: null, bbox: null },
    { index: 1, charStart: FIRST.length + 2, charEnd: TEXT.length, text: SECOND, page: null, bbox: null },
  ],
  spans: [],
}

const quoteAt = (quote: string): Citation => {
  const charStart = TEXT.indexOf(quote)
  return {
    blockIndex: 1,
    charStart,
    charEnd: charStart + quote.length,
    page: null,
    bbox: null,
    quote,
    verification: 'verified',
  }
}

/**
 * This viewer is where the product's central claim becomes visible: the
 * highlight is drawn from the stored offsets and nothing else. No searching the
 * rendered text for the quote — that would be a second, independent way to
 * decide what the citation points at, and a way for the two to disagree.
 */
describe('BlockTextViewer', () => {
  it('renders every block with its paragraph number', () => {
    render(<BlockTextViewer layer={layer} citation={null} />)
    expect(screen.getByText(FIRST)).toBeInTheDocument()
    expect(screen.getByText(SECOND)).toBeInTheDocument()
    expect(screen.getByText('¶ 0')).toBeInTheDocument()
    expect(screen.getByText('¶ 1')).toBeInTheDocument()
  })

  it('highlights exactly the cited characters, and nothing else', () => {
    const citation = quoteAt('except for willful misconduct')
    render(<BlockTextViewer layer={layer} citation={citation} />)
    const marks = screen.getAllByRole('mark')
    expect(marks).toHaveLength(1)
    // The assertion that matters: what is highlighted is what the offsets say,
    // and the offsets slice the canonical text to the stored quote.
    expect(marks[0].textContent).toBe(citation.quote)
    expect(marks[0].textContent).toBe(TEXT.slice(citation.charStart, citation.charEnd))
  })

  it('keeps the text either side of the highlight intact', () => {
    render(<BlockTextViewer layer={layer} citation={quoteAt('willful misconduct')} />)
    // The document text is asserted on its own, apart from the ¶ label: the
    // highlight must not add, drop or reorder a single character.
    expect(screen.getByTestId('block-text-1').textContent).toBe(SECOND)
  })

  it('highlights a quote that starts a block', () => {
    const citation = quoteAt('The Trustee shall not be liable')
    render(<BlockTextViewer layer={layer} citation={citation} />)
    expect(screen.getAllByRole('mark')[0].textContent).toBe(citation.quote)
  })

  it('highlights nothing when there is no citation', () => {
    render(<BlockTextViewer layer={layer} citation={null} />)
    expect(screen.queryAllByRole('mark')).toHaveLength(0)
  })

  it('says so rather than rendering blank when the layer has no text', () => {
    render(
      <BlockTextViewer
        layer={{ ...layer, status: 'no_text', text: '', blocks: [] }}
        citation={null}
      />,
    )
    // An empty document rendered silently reads as a document with nothing in it.
    expect(screen.getByText(/no text/i)).toBeInTheDocument()
  })

  it('marks up each block a citation spans, rather than dropping the overflow', () => {
    // verifyQuote scopes a citation to one block, so this is defensive; a
    // citation that ran past its block would otherwise vanish from the view.
    const spanning: Citation = {
      blockIndex: 0,
      charStart: FIRST.length - 6,
      charEnd: FIRST.length + 2 + 3,
      page: null,
      bbox: null,
      quote: TEXT.slice(FIRST.length - 6, FIRST.length + 5),
      verification: 'verified',
    }
    render(<BlockTextViewer layer={layer} citation={spanning} />)
    const marks = screen.getAllByRole('mark')
    expect(marks).toHaveLength(2)
    expect(marks.map((m) => m.textContent).join('')).toContain('POWERS')
  })
})
