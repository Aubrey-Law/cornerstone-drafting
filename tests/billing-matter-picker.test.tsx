// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { BillingMatterPicker } from '@/components/billing/BillingMatterPicker'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('BillingMatterPicker', () => {
  it('loads the initial choices on demand when the page did not preload them', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      matters: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Synthetic matter' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)

    render(<BillingMatterPicker id="matter" value="" onChange={() => {}} initialOptions={[]} />)

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1), { timeout: 1_000 })
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/billing/matters?q=')
  })
})
