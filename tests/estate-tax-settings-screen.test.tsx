// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EstateTaxSchedulesClient } from '@/app/admin/settings/estate-tax/EstateTaxSchedulesClient'
import { FEDERAL_SCHEDULE_2025, MA_SCHEDULE_2023 } from '@/lib/estateTaxSchedules'

afterEach(cleanup)

const BASE = {
  configured: [],
  bundled: { massachusetts: [MA_SCHEDULE_2023], federal: [FEDERAL_SCHEDULE_2025] },
  errors: [],
  effective: {
    asOf: '2026-09-03',
    massachusetts: { ok: true as const, schedule: MA_SCHEDULE_2023 },
    federal: {
      ok: false as const,
      reason: 'none_on_file' as const,
      asOf: '2026-09-03',
      mostRecent: FEDERAL_SCHEDULE_2025,
    },
  },
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('estate tax settings screen', () => {
  /**
   * The page exists to answer "does the app have a current figure?", so the
   * missing year is the first thing on it — not something to infer from a table.
   */
  it('leads with the year that has no figure, and says what that means', () => {
    render(<EstateTaxSchedulesClient initial={BASE} />)
    expect(screen.getByText('Not on file for 2026')).toBeTruthy()
    expect(screen.getByText(/most recent figure on file is 2025/)).toBeTruthy()
    expect(screen.getByText(/will not quote last year/)).toBeTruthy()
  })

  it('shows the Massachusetts schedule that is in force', () => {
    render(<EstateTaxSchedulesClient initial={BASE} />)
    expect(screen.getByText('$2,000,000')).toBeTruthy()
    expect(screen.getByText(/21 brackets/)).toBeTruthy()
    // The citation, not the prose below it that also names the act.
    expect(screen.getByText(/MGL Ch. 65C/)).toBeTruthy()
  })

  it('marks bundled figures apart from the firm’s own', () => {
    render(<EstateTaxSchedulesClient initial={BASE} />)
    expect(screen.getByText('built-in')).toBeTruthy()
  })

  /**
   * A rate typed as "40" must reach the API as 0.4. Asking for a fraction is
   * how someone stores a 4000% estate tax.
   */
  it('sends the rate as a fraction when it was typed as a percentage', async () => {
    // Typed with the arguments fetch actually receives: an untyped mock infers
    // a zero-arg signature, and then reading calls[n][1] is unsound rather than
    // merely ugly.
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(BASE), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<EstateTaxSchedulesClient initial={BASE} />)
    fireEvent.click(screen.getByRole('button', { name: /add a year/i }))
    fireEvent.change(screen.getByLabelText('Exclusion amount'), { target: { value: '15,000,000' } })
    fireEvent.change(screen.getByLabelText('Rate above it (%)'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Rev. Proc. 2025-32' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const put = fetchMock.mock.calls.find(call => call[1]?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(put![1]!.body as string) as {
      schedules: Array<Record<string, unknown>>
    }
    expect(body.schedules[0]).toMatchObject({
      jurisdiction: 'US',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      exemption: 15_000_000,
      rate: 0.4,
    })
  })

  it('strips currency punctuation from the amount', async () => {
    // Typed with the arguments fetch actually receives: an untyped mock infers
    // a zero-arg signature, and then reading calls[n][1] is unsound rather than
    // merely ugly.
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(BASE), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<EstateTaxSchedulesClient initial={BASE} />)
    fireEvent.click(screen.getByRole('button', { name: /add a year/i }))
    fireEvent.change(screen.getByLabelText('Exclusion amount'), { target: { value: '$15,000,000' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Rev. Proc.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const put = fetchMock.mock.calls.find(call => call[1]?.method === 'PUT')
    const body = JSON.parse(put![1]!.body as string) as {
      schedules: Array<Record<string, unknown>>
    }
    expect(body.schedules[0].exemption).toBe(15_000_000)
  })

  /**
   * The source is what makes a figure checkable, so it is refused locally
   * rather than round-tripping to the server to be told the same thing.
   */
  it('refuses to save without a source, and does not call the API', async () => {
    // Typed with the arguments fetch actually receives: an untyped mock infers
    // a zero-arg signature, and then reading calls[n][1] is unsound rather than
    // merely ugly.
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(BASE), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<EstateTaxSchedulesClient initial={BASE} />)
    fireEvent.click(screen.getByRole('button', { name: /add a year/i }))
    fireEvent.change(screen.getByLabelText('Exclusion amount'), { target: { value: '15000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Record the authority/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an exclusion that is not a number', async () => {
    // Typed with the arguments fetch actually receives: an untyped mock infers
    // a zero-arg signature, and then reading calls[n][1] is unsound rather than
    // merely ugly.
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(BASE), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<EstateTaxSchedulesClient initial={BASE} />)
    fireEvent.click(screen.getByRole('button', { name: /add a year/i }))
    fireEvent.change(screen.getByLabelText('Exclusion amount'), { target: { value: 'lots' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Rev. Proc.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/exclusion amount in dollars/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The write has already landed by the time the page refreshes, so a body it
   * cannot read must leave the previous state alone rather than blank the page.
   */
  it('survives a refresh response that is not a payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    )

    render(<EstateTaxSchedulesClient initial={BASE} />)
    fireEvent.click(screen.getByRole('button', { name: /add a year/i }))
    fireEvent.change(screen.getByLabelText('Exclusion amount'), { target: { value: '15000000' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Rev. Proc.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Still rendering, still showing what it knew before the refresh.
    expect(await screen.findByText(/21 brackets/)).toBeTruthy()
  })

  it('surfaces the server’s complaint when a save is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ errors: ['Two US schedules cover 2026-01-01'] }), {
          status: 400,
        }),
      ),
    )

    render(<EstateTaxSchedulesClient initial={BASE} />)
    fireEvent.click(screen.getByRole('button', { name: /add a year/i }))
    fireEvent.change(screen.getByLabelText('Exclusion amount'), { target: { value: '15000000' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Rev. Proc.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Two US schedules cover 2026-01-01')).toBeTruthy()
  })

  it('shows a figure the firm entered instead of the bundled one for that year', () => {
    render(
      <EstateTaxSchedulesClient
        initial={{
          ...BASE,
          configured: [{ ...FEDERAL_SCHEDULE_2025, exemption: 13_610_000, source: 'corrected' }],
        }}
      />,
    )
    expect(screen.getByText('$13,610,000')).toBeTruthy()
    expect(screen.queryByText('$13,990,000')).toBeNull()
    expect(screen.getByText('firm')).toBeTruthy()
  })
})
