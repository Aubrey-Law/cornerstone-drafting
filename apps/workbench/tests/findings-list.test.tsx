// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FindingsList } from '@/app/review/FindingsList'
import type { ReviewFinding } from '@aubrey-law/citations/review/types'

afterEach(cleanup)

const cited: ReviewFinding = {
  ruleNumber: '1',
  outcome: 'deviation',
  severity: 'high',
  rationale: 'Liability is limited to willful misconduct alone.',
  proposedLanguage: 'except for willful misconduct, bad faith, or gross negligence',
  citation: {
    blockIndex: 1,
    charStart: 10,
    charEnd: 39,
    page: 2,
    bbox: null,
    quote: 'except for willful misconduct',
    verification: 'verified',
  },
  citationRefusal: null,
  attemptedQuote: null,
}

const uncited: ReviewFinding = {
  ruleNumber: '2',
  outcome: 'deviation',
  severity: 'blocker',
  rationale: 'The distribution standard is silent on other resources.',
  proposedLanguage: null,
  citation: null,
  citationRefusal: 'not_found',
  attemptedQuote: 'the trustee is not liable for anything at all',
}

const absent: ReviewFinding = {
  ruleNumber: '3',
  outcome: 'absent',
  severity: 'medium',
  rationale: 'The instrument does not address the bond waiver.',
  proposedLanguage: null,
  citation: null,
  citationRefusal: null,
  attemptedQuote: null,
}

const noop = () => {}

describe('FindingsList', () => {
  it('shows the rule number, outcome and rationale for each finding', () => {
    render(<FindingsList findings={[cited]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    expect(screen.getByText(/Rule 1/)).toBeInTheDocument()
    expect(screen.getByText(/deviation/i)).toBeInTheDocument()
    expect(screen.getByText(cited.rationale)).toBeInTheDocument()
  })

  it('shows a verified citation with its quote and where it sits', () => {
    render(<FindingsList findings={[cited]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    // Scoped to the blockquote: the same words also appear in the proposed
    // replacement, and a loose matcher would pass on the wrong element.
    const quote = screen.getByTestId('finding-1').querySelector('blockquote')!
    expect(quote.textContent).toContain('“except for willful misconduct”')
    expect(quote.textContent).toContain('p2 · ¶ 1')
  })

  /**
   * The distinction the product rests on. An uncited finding is not hidden —
   * the rationale may still deserve attention — but it must never look like a
   * checkable claim, and it must say that it cannot be exported.
   */
  it('marks an unsupported finding as not citable and excluded from export', () => {
    render(<FindingsList findings={[uncited]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    const item = screen.getByTestId('finding-2')
    expect(item.textContent).toMatch(/not citable/i)
    expect(item.textContent).toMatch(/excluded from (the )?export/i)
  })

  /**
   * Showing the words the model reached for is what lets the attorney tell a
   * paraphrase from a verifier that is being too strict. Without them the
   * finding is an assertion with nothing to check.
   */
  it('shows what the model tried to quote, so the refusal can be judged', () => {
    render(<FindingsList findings={[uncited]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    expect(screen.getByTestId('finding-2').textContent).toContain('the trustee is not liable for anything at all')
  })

  it('does not offer to point at the document for an uncited finding', () => {
    render(<FindingsList findings={[uncited]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    expect(screen.getByTestId('finding-2').querySelector('button[data-action="show"]')).toBeNull()
  })

  it('says an absence is an absence, not a missing citation', () => {
    render(<FindingsList findings={[absent]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    const item = screen.getByTestId('finding-3')
    expect(item.textContent).toMatch(/absent|silent|does not/i)
    // Nothing to quote by definition, so no failed-citation warning.
    expect(item.textContent).not.toMatch(/not citable/i)
  })

  it('selects a finding when its citation is shown', () => {
    const onSelect = vi.fn()
    render(<FindingsList findings={[cited]} selected={null} onSelect={onSelect} dispositions={{}} onDispose={noop} />)
    fireEvent.click(screen.getByRole('button', { name: /show in document/i }))
    expect(onSelect).toHaveBeenCalledWith('1')
  })

  it('marks the selected finding for assistive technology', () => {
    render(<FindingsList findings={[cited, absent]} selected="1" onSelect={noop} dispositions={{}} onDispose={noop} />)
    expect(screen.getByTestId('finding-1')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('finding-3')).not.toHaveAttribute('aria-current')
  })

  it('records a disposition against the rule', () => {
    const onDispose = vi.fn()
    render(<FindingsList findings={[cited]} selected={null} onSelect={noop} dispositions={{}} onDispose={onDispose} />)
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    expect(onDispose).toHaveBeenCalledWith('1', 'accepted')
  })

  it('shows the disposition already recorded', () => {
    render(
      <FindingsList findings={[cited]} selected={null} onSelect={noop} dispositions={{ '1': 'rejected' }} onDispose={noop} />,
    )
    expect(screen.getByRole('button', { name: /reject/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /accept/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('orders blockers above lesser findings', () => {
    render(<FindingsList findings={[cited, uncited, absent]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    const order = screen.getAllByTestId(/^finding-/).map((el) => el.getAttribute('data-testid'))
    expect(order).toEqual(['finding-2', 'finding-1', 'finding-3'])
  })

  it('says plainly when a review produced nothing', () => {
    render(<FindingsList findings={[]} selected={null} onSelect={noop} dispositions={{}} onDispose={noop} />)
    expect(screen.getByText(/no findings/i)).toBeInTheDocument()
  })
})
