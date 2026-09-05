// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The PDF viewer is exercised by its own test in the package. Stubbed here so
 * this test can assert the thing the workspace is actually responsible for:
 * that clicking a finding hands the viewer that finding's citation.
 */
const { viewerCalls } = vi.hoisted(() => ({ viewerCalls: [] as Array<unknown> }))
vi.mock('@aubrey-law/citations/react/PdfCitationViewer', () => ({
  PdfCitationViewer: (props: { citation: unknown }) => {
    viewerCalls.push(props.citation)
    return <div data-testid="pdf-viewer" />
  },
}))

import { ReviewWorkspace } from '@/app/review/ReviewWorkspace'

const PLAYBOOK = {
  title: 'Massachusetts revocable trust — reviewing a draft prepared elsewhere',
  version: 1,
  rules: [{ number: '1', risk: 'high', statement: 'Exculpation must carve out gross negligence.' }],
}

const TEXT = 'The Trustee shall not be liable except for willful misconduct.'
const PAYLOAD = {
  filename: 'smith-trust.pdf',
  playbook: { slug: 'ma-trust-firm-qa', title: PLAYBOOK.title, version: 1 },
  layer: {
    sourceKind: 'pdf',
    status: 'ok',
    extractor: 'pdfjs',
    extractorVersion: '1',
    sourceSha256: 'a'.repeat(64),
    pageCount: 2,
    text: TEXT,
    blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: 1, bbox: null }],
    spans: [],
  },
  result: {
    playbookSlug: 'ma-trust-firm-qa',
    playbookVersion: 1,
    findings: [
      {
        ruleNumber: '1',
        outcome: 'deviation',
        severity: 'high',
        rationale: 'Liability is carved out only for willful misconduct.',
        proposedLanguage: 'willful misconduct, bad faith, or gross negligence',
        citation: {
          blockIndex: 0,
          charStart: TEXT.indexOf('willful misconduct'),
          charEnd: TEXT.indexOf('willful misconduct') + 18,
          page: 1,
          bbox: { x: 10, y: 20, width: 100, height: 12 },
          quote: 'willful misconduct',
          verification: 'verified',
        },
        citationRefusal: null,
        attemptedQuote: null,
      },
    ],
    failures: [{ ruleNumber: '2', reason: 'overloaded' }],
  },
}

const upload = async () => {
  const input = screen.getByLabelText(/document to review/i) as HTMLInputElement
  const file = new File([new Uint8Array(64)], 'smith-trust.pdf', { type: 'application/pdf' })
  // jsdom's File has no arrayBuffer in some versions; the component needs one.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(64) })
  Object.defineProperty(input, 'files', { value: [file] })
  fireEvent.change(input)
  fireEvent.click(screen.getByRole('button', { name: /run review/i }))
}

beforeEach(() => {
  viewerCalls.length = 0
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReviewWorkspace', () => {
  it('names the rules before anything is uploaded', () => {
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={[]} />)
    // The attorney should know what is about to be checked, not only what came back.
    expect(screen.getByText(PLAYBOOK.rules[0].statement)).toBeInTheDocument()
    expect(screen.getByText(/nothing is saved/i)).toBeInTheDocument()
  })

  it('shows the findings and the document side by side after a run', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })))
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={[]} />)
    await upload()

    expect(await screen.findByText(/1 findings/)).toBeInTheDocument()
    expect(screen.getByText(/1 cited/)).toBeInTheDocument()
    expect(screen.getByText('smith-trust.pdf')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument()
  })

  it('hands the viewer the citation of the finding that was selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })))
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={[]} />)
    await upload()
    await screen.findByTestId('pdf-viewer')

    expect(viewerCalls.at(-1)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /show in document/i }))
    await waitFor(() => expect(viewerCalls.at(-1)).toMatchObject({ quote: 'willful misconduct', page: 1 }))
  })

  it('names the rules that never ran, rather than folding them into the count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })))
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={[]} />)
    await upload()
    // A rule that failed is not a rule that found nothing.
    expect(await screen.findByText(/rules that did not run/i)).toBeInTheDocument()
    expect(screen.getByText(/Rule 2 — overloaded/)).toBeInTheDocument()
  })

  it('shows the server’s reason when a review is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'This document has no text layer — it is most likely a scan.' }), { status: 422 })),
    )
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={[]} />)
    await upload()
    expect(await screen.findByRole('alert')).toHaveTextContent(/no text layer/i)
  })

  it('lets a disposition be recorded and taken back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })))
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={[]} />)
    await upload()
    const accept = await screen.findByRole('button', { name: /accept/i })
    fireEvent.click(accept)
    await waitFor(() => expect(accept).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(accept)
    await waitFor(() => expect(accept).toHaveAttribute('aria-pressed', 'false'))
  })
})

const MATTERS = [
  {
    matterId: 'm-1',
    title: 'Smith Revocable Trust',
    documents: [
      { versionId: 'v-1', name: 'Smith Trust.docx', kind: 'docx' as const },
      { versionId: 'v-2', name: 'Smith Pour-Over Will.docx', kind: 'docx' as const },
    ],
  },
  {
    matterId: 'm-2',
    title: 'Jones Trust',
    documents: [{ versionId: 'v-9', name: 'Jones Trust.docx', kind: 'docx' as const }],
  },
]

/**
 * Reviewing a document already filed on a matter is the normal path now: every
 * draft is the firm's own, so it exists before the review does — and only a
 * filed document carries the version id a citation can be anchored to.
 */
describe('ReviewWorkspace, choosing a filed document', () => {
  it('offers the matters and their citable documents', () => {
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={MATTERS} />)
    expect(screen.getByLabelText('Matter')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Smith Trust.docx' })).toBeInTheDocument()
  })

  it('shows only the chosen matter\u2019s documents', () => {
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={MATTERS} />)
    expect(screen.getByRole('option', { name: 'Smith Trust.docx' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Jones Trust.docx' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Matter'), { target: { value: 'm-2' } })
    expect(screen.getByRole('option', { name: 'Jones Trust.docx' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Smith Trust.docx' })).not.toBeInTheDocument()
  })

  /**
   * The id travels, never the storage key. A key from the browser would be an
   * arbitrary read against the bucket holding every client's documents.
   */
  it('sends the version id and no file', async () => {
    // Typed so the request body can be read back; vi.fn's inferred call tuple
    // is empty for a zero-argument implementation.
    const fetchMock = vi.fn(
      async (_url: string, init: { body: FormData }) => {
        void init
        return new Response(JSON.stringify(PAYLOAD), { status: 200 })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={MATTERS} />)

    fireEvent.change(screen.getByLabelText('Document'), { target: { value: 'v-2' } })
    fireEvent.click(screen.getByRole('button', { name: /run review/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = fetchMock.mock.calls[0][1].body
    expect(body.get('documentVersionId')).toBe('v-2')
    expect(body.get('document')).toBeNull()
  })

  it('does not ask for a document when none is chosen and none uploaded', async () => {
    render(<ReviewWorkspace playbook={PLAYBOOK} matters={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /run review/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a document/i)
  })
})
