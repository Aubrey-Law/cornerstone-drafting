// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { retryRun, recordFieldAuditDisposition } = vi.hoisted(() => ({
  retryRun: vi.fn(async (_previous: { message: string | null } | null, _form: FormData) => ({ message: null })),
  recordFieldAuditDisposition: vi.fn(async (_previous: { message: string | null } | null, _form: FormData) => ({
    message: null,
  })),
}))
vi.mock('@/app/admin/field-audits/[runId]/actions', () => ({ retryRun, recordFieldAuditDisposition }))

import { FieldAuditRunView } from '@/app/admin/field-audits/[runId]/FieldAuditRunView'
import type { StoredFieldAuditFinding } from '@/lib/fieldAudit/history'

afterEach(() => {
  cleanup()
  retryRun.mockClear()
  recordFieldAuditDisposition.mockClear()
})

const finding = (over: Partial<StoredFieldAuditFinding> = {}): StoredFieldAuditFinding => ({
  findingId: 'f-1',
  checkNumber: '1',
  outcome: 'deviation',
  severity: 'high',
  rationale: 'The trustee named on the sheet does not match the instrument.',
  disposition: 'open',
  dispositionNote: null,
  references: [
    {
      fieldKey: 'trustee_name',
      claimedValue: 'Jane Doe',
      actualValue: 'Jane A. Doe',
      matchedPath: null,
      verification: 'verified',
    },
  ],
  ...over,
})

describe('FieldAuditRunView', () => {
  it('shows a recorded field audit with its findings', () => {
    render(<FieldAuditRunView runId="run-1" findings={[finding()]} steps={[]} />)
    expect(screen.getByText(/does not match the instrument/i)).toBeInTheDocument()
  })

  /**
   * `matchedPath` is what lets a reader of a structured field's reference
   * (say, `children[0].dob`) see which record a value actually came from.
   * Losing it here would make that provenance unrecoverable once the run
   * leaves memory — see lib/fieldAudit/persist.ts.
   */
  it('shows the matched path for a structured field reference', () => {
    render(
      <FieldAuditRunView
        runId="run-1"
        findings={[
          finding({
            references: [
              {
                fieldKey: 'children',
                claimedValue: '2010-01-01',
                actualValue: '2010-01-01',
                matchedPath: 'children[0].dob',
                verification: 'verified',
              },
            ],
          }),
        ]}
        steps={[]}
      />,
    )
    expect(screen.getByTestId('matched-path')).toHaveTextContent('children[0].dob')
  })

  it('names how many checks a retry will re-run', () => {
    render(
      <FieldAuditRunView
        runId="run-1"
        findings={[finding()]}
        steps={[
          { unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null },
          { unitId: '2', status: 'failed', attempts: 1, sequence: 1, lastError: 'overloaded' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: /retry 1 failed check/i })).toBeEnabled()
  })

  it('offers no retry when nothing failed', () => {
    render(
      <FieldAuditRunView
        runId="run-1"
        findings={[finding()]}
        steps={[{ unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })
})

describe('FieldAuditRunView decisions', () => {
  it('records a decision on a finding, and reopens it when the same decision is pressed again', async () => {
    const { rerender } = render(<FieldAuditRunView runId="run-1" findings={[finding()]} steps={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(recordFieldAuditDisposition).toHaveBeenCalledTimes(1))
    const sent = recordFieldAuditDisposition.mock.calls[0][1]
    expect([sent.get('findingId'), sent.get('disposition'), sent.get('runId')]).toEqual(['f-1', 'accepted', 'run-1'])

    // Once the page reloads with the decision recorded, pressing it again reopens.
    rerender(<FieldAuditRunView runId="run-1" findings={[finding({ disposition: 'accepted' })]} steps={[]} />)
    expect(screen.getByRole('button', { name: 'Accept' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(recordFieldAuditDisposition).toHaveBeenCalledTimes(2))
    expect(recordFieldAuditDisposition.mock.calls[1][1].get('disposition')).toBe('open')
  })
})
