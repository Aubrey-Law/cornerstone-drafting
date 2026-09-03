// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetPortfolioSummary } from '@/components/assets/AssetPortfolioSummary'
import type { AssetAggregates } from '@/lib/assets/aggregates'

afterEach(cleanup)

const aggregates = {
  grossValue: 20_000_000,
  netValue: 20_000_000,
  valuedAssetCount: 3,
  documentRecordCount: 0,
} as AssetAggregates

describe('portfolio estate tax display', () => {
  /**
   * The failure this guards against is subtle and expensive: `formatAssetCurrency`
   * turns null into "$0", so a federal exclusion the firm has not recorded would
   * render as "$0" of federal tax on a $20M estate — a confident number that is
   * false. Typecheck cannot catch it, because the formatter accepts null by
   * design. Only an assertion on what the page says can.
   */
  it('says the federal figure is not on file rather than showing $0', () => {
    render(<AssetPortfolioSummary aggregates={aggregates} />)
    expect(screen.getByText('Not on file')).toBeTruthy()
    expect(screen.queryByText('$0')).toBeNull()
  })

  it('names the year that is missing and the newest one on file', () => {
    render(<AssetPortfolioSummary aggregates={aggregates} />)
    const note = screen.getByText(/No federal exclusion recorded for/)
    expect(note.textContent).toContain('2025')
    expect(note.textContent).toContain('firm settings')
  })

  /**
   * Massachusetts is open-ended in law and still resolves, so it must keep
   * showing a real number — the miss is specific to the indexed federal figure,
   * not a blanket refusal.
   */
  it('still shows the Massachusetts figure', () => {
    render(<AssetPortfolioSummary aggregates={aggregates} />)
    const label = screen.getByText('Estimated Massachusetts Estate Tax')
    const value = label.parentElement?.querySelector('p:nth-of-type(2)')
    expect(value?.textContent).toMatch(/^\$[\d,]+$/)
    expect(value?.textContent).not.toBe('$0')
  })
})
