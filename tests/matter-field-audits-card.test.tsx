// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const actions = vi.hoisted(() => ({
  runAudit: vi.fn(async () => ({ ok: true, message: null, runId: 'run-new' })),
}))
vi.mock('@/app/admin/field-audits/actions', () => actions)

import { MatterFieldAuditsCard } from '@/app/admin/matters/[id]/MatterFieldAuditsCard'

const MATTER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const respond = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  actions.runAudit.mockClear()
})

describe('MatterFieldAuditsCard', () => {
  it('lists the matter’s runs, names an undecided blocker, and runs an audit for this matter', async () => {
    const fetchMock = respond({
      prompts: [{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }],
      hasDesignSheet: true,
      runs: [
        { runId: 'run-1', matterTitle: 'Smith', promptTitle: 'Issue spotter', status: 'completed', findingCount: 3, failedCount: 0, finishedAt: '2026-09-05T12:00:00Z' },
      ],
      unresolvedBlocker: { runId: 'run-1', ruleNumbers: ['2'] },
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MatterFieldAuditsCard matterId={MATTER} />)

    await waitFor(() => expect(screen.getByTestId('matter-field-audit-runs')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/matters/${MATTER}/field-audits`)
    expect(screen.getByRole('link', { name: /issue spotter/i })).toHaveAttribute('href', '/admin/field-audits/run-1')
    expect(screen.getByTestId('matter-unresolved-blocker')).toHaveTextContent('check 2')

    fireEvent.click(screen.getByRole('button', { name: 'Run field audit' }))
    await waitFor(() => expect(actions.runAudit).toHaveBeenCalledTimes(1))
    const form = (actions.runAudit.mock.calls[0] as unknown as [unknown, FormData])[1]
    expect(form.get('matterId')).toBe(MATTER)
    expect(form.get('slug')).toBe('ma-design-sheet-audit')
    await waitFor(() => expect(screen.getByTestId('field-audit-queued')).toBeInTheDocument())
    // Reloaded, so the queued run shows up in the list.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('offers no run without a design sheet to audit', async () => {
    vi.stubGlobal('fetch', respond({ prompts: [{ slug: 'a', title: 'A', checkCount: 1 }], hasDesignSheet: false, runs: [], unresolvedBlocker: null }))
    render(<MatterFieldAuditsCard matterId={MATTER} />)
    await waitFor(() => expect(screen.getByText(/no design sheet yet/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Run field audit' })).not.toBeInTheDocument()
  })
})
