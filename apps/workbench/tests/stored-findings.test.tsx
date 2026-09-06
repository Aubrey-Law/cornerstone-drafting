// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Typed so the submitted form can be read back: vi.fn infers an empty call
// tuple from a zero-argument implementation.
const { recordDisposition, retryRun } = vi.hoisted(() => ({
  recordDisposition: vi.fn(
    async (_previous: { message: string | null } | null, _form: FormData) => ({ message: null }),
  ),
  retryRun: vi.fn(async (_previous: { message: string | null } | null, _form: FormData) => ({ message: null })),
}))
vi.mock('@/app/review/[runId]/actions', () => ({ recordDisposition, retryRun }))

import { StoredFindings } from '@/app/review/[runId]/StoredFindings'
import type { StoredFinding } from '@/lib/review/persist'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'

afterEach(() => {
  cleanup()
  recordDisposition.mockClear()
  retryRun.mockClear()
})

const TEXT = 'The Trustee shall not be liable except for willful misconduct.'
const layer: TextLayer = {
  sourceKind: 'docx',
  status: 'ok',
  extractor: 'docx',
  extractorVersion: '1',
  sourceSha256: 'a'.repeat(64),
  pageCount: null,
  text: TEXT,
  blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: null, bbox: null }],
  spans: [],
}

const finding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  findingId: 'f-1',
  ruleNumber: '1',
  outcome: 'deviation',
  severity: 'high',
  rationale: 'The carve-out is too narrow.',
  proposedLanguage: 'willful misconduct, bad faith, or gross negligence',
  citation: {
    blockIndex: 0,
    charStart: TEXT.indexOf('willful misconduct'),
    charEnd: TEXT.indexOf('willful misconduct') + 18,
    page: null,
    bbox: null,
    quote: 'willful misconduct',
    verification: 'verified',
  },
  citationRefusal: null,
  attemptedQuote: null,
  disposition: 'open',
  dispositionNote: null,
  ...over,
})

// Reused across the tests below, since only `steps` varies between them.
const props = { runId: 'run-1', findings: [finding()], layer }

describe('StoredFindings', () => {
  it('shows a recorded review with its findings', () => {
    render(<StoredFindings runId="run-1" findings={[finding()]} layer={layer} />)
    expect(screen.getByText(/carve-out is too narrow/i)).toBeInTheDocument()
  })

  /**
   * The document is drawn from the run's own stored layer, so a review read
   * back highlights exactly what it highlighted on the day. The offsets and the
   * text they index travelled together.
   */
  it('highlights the cited words from the stored layer', () => {
    render(<StoredFindings runId="run-1" findings={[finding()]} layer={layer} />)
    fireEvent.click(screen.getByRole('button', { name: /show in document/i }))
    expect(screen.getByRole('mark').textContent).toBe('willful misconduct')
  })

  it('shows a decision already recorded as pressed', () => {
    render(<StoredFindings runId="run-1" findings={[finding({ disposition: 'accepted' })]} layer={layer} />)
    expect(screen.getByRole('button', { name: /accept/i })).toHaveAttribute('aria-pressed', 'true')
  })

  /**
   * `open` is the absence of a decision, not a fourth choice, so it reads as no
   * button pressed. A reopened finding must be indistinguishable from an
   * untouched one on screen.
   */
  it('shows an open finding as nothing pressed', () => {
    render(<StoredFindings runId="run-1" findings={[finding()]} layer={layer} />)
    for (const name of [/accept/i, /reject/i, /defer/i]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('records a decision against the finding, not the rule number', () => {
    render(<StoredFindings runId="run-1" findings={[finding()]} layer={layer} />)
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    const form = recordDisposition.mock.calls[0][1]
    // The finding id is the durable identity; a rule number repeats across runs.
    expect(form.get('findingId')).toBe('f-1')
    expect(form.get('disposition')).toBe('accepted')
    expect(form.get('runId')).toBe('run-1')
  })

  it('reopens a finding when its recorded decision is clicked again', () => {
    render(<StoredFindings runId="run-1" findings={[finding({ disposition: 'accepted' })]} layer={layer} />)
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    expect(recordDisposition.mock.calls[0][1].get('disposition')).toBe('open')
  })

  it('shows the decision immediately rather than after the round trip', async () => {
    render(<StoredFindings runId="run-1" findings={[finding()]} layer={layer} />)
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reject/i })).toHaveAttribute('aria-pressed', 'true'),
    )
  })

  /**
   * A run with no stored layer cannot show its citations against the document.
   * Saying so beats highlighting the wrong words.
   */
  it('says it cannot show the document when the run recorded no layer', () => {
    render(<StoredFindings runId="run-1" findings={[finding()]} layer={null} />)
    expect(screen.getByText(/cannot be shown against the document/i)).toBeInTheDocument()
  })

  it('shows what an uncited finding tried to quote', () => {
    render(
      <StoredFindings
        runId="run-1"
        findings={[finding({ citation: null, citationRefusal: 'not_found', attemptedQuote: 'words not present' })]}
        layer={layer}
      />,
    )
    expect(within(screen.getByTestId('finding-1')).getByText(/words not present/)).toBeInTheDocument()
  })

  it('names how many units a retry will re-run, because it costs money', () => {
    // A button that says only "Retry" invites being pressed without that
    // being a decision. It calls the model again.
    render(
      <StoredFindings
        {...props}
        steps={[
          { unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null },
          { unitId: '2', status: 'failed', attempts: 1, sequence: 1, lastError: 'overloaded' },
          { unitId: '3', status: 'failed', attempts: 2, sequence: 2, lastError: 'overloaded' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: /retry 2 failed/i })).toBeEnabled()
  })

  it('offers no retry when nothing failed', () => {
    render(
      <StoredFindings
        {...props}
        steps={[{ unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('shows why a step failed, and how many times it has been tried', () => {
    render(
      <StoredFindings
        {...props}
        steps={[{ unitId: '2', status: 'failed', attempts: 3, sequence: 0, lastError: 'overloaded' }]}
      />,
    )
    expect(screen.getByText(/overloaded/)).toBeInTheDocument()
    expect(screen.getByText(/3/)).toBeInTheDocument()
  })
})
