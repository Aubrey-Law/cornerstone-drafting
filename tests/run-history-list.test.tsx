// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { RunHistoryList, runSummaryLine } from '@/app/admin/review/components/RunHistoryList'

afterEach(cleanup)

it('summarises a finished review in words a person would write', () => {
  expect(runSummaryLine({ findingCount: 1, failedCount: 2, status: 'partial', finishedAt: '2026-09-06T02:00:00Z' }, 'rule'))
    .toBe('1 finding · 2 rules failed · partial · Sep 5, 2026')
  expect(runSummaryLine({ findingCount: 3, failedCount: 1, status: 'completed', finishedAt: null }, 'check'))
    .toBe('3 findings · 1 check failed')
})

it('shows a queued review as in progress rather than "0 findings"', () => {
  render(<RunHistoryList showMatter={false} runs={[{
    runId: 'r1', matterTitle: 'Smith', documentName: 'Trust.docx', status: 'queued',
    ruleTotal: 5, findingCount: 0, failedCount: 0, finishedAt: null,
  }]} />)
  expect(screen.getByRole('link', { name: /Trust\.docx/ }).textContent).toContain('In progress')
  expect(screen.queryByText(/0 findings/)).toBeNull()
})

it('stacks the summary under the name below sm, so a phone list does not read ragged', () => {
  render(<RunHistoryList showMatter={false} runs={[{
    runId: 'r1', matterTitle: 'Smith', documentName: 'Trust.docx', status: 'completed',
    ruleTotal: 5, findingCount: 0, failedCount: 0, finishedAt: null,
  }]} />)
  // jsdom applies no media queries; these are the classes the browser keys on.
  const row = screen.getByRole('link', { name: /Trust\.docx/ })
  expect(row.className).toContain('flex-col')
  expect(row.className).toContain('sm:flex-row')
})
