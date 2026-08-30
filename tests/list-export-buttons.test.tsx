// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LeadRow } from '@/app/admin/leads/LeadsClient'
import type { MatterListRow } from '@/lib/queries/matters'

/**
 * The Export CSV button on each list page.
 *
 * The two pages export differently on purpose — the leads list is paged in the
 * database so its export asks the server for the whole filtered set, while the
 * matters list is filtered in the browser so its export writes the rows already
 * on screen. What both must do is export the *current selection*, not the
 * default one.
 */

const replace = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }),
  usePathname: () => '/admin/leads',
  useSearchParams: () => searchParams,
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token-1' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }))

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
}

import { LeadsClient } from '@/app/admin/leads/LeadsClient'
import MattersClient from '@/app/admin/matters/MattersClient'
import { toast } from 'sonner'

const created: string[] = []
let lastBlob: Blob | null = null
URL.createObjectURL = vi.fn((blob: Blob) => {
  lastBlob = blob
  created.push('blob:url')
  return 'blob:url'
}) as unknown as typeof URL.createObjectURL
URL.revokeObjectURL = vi.fn()

afterEach(() => {
  cleanup()
  created.length = 0
  lastBlob = null
  searchParams = new URLSearchParams()
  vi.unstubAllGlobals()
  vi.mocked(toast.error).mockClear()
})

const SUMMARY = {
  open: 1, lost: 0, declined: 0, all: 1,
  attention: 0, agreements: 0, awaitingIntake: 0, quotedPipeline: 0,
}

function leadRow(id: string): LeadRow {
  return {
    id,
    full_name: 'Jane Doe',
    first_name: null,
    last_name: null,
    email: 'jane@example.com',
    phone: '617-555-0100',
    practice_area: 'EP',
    status: null,
    lead_status: 'lead',
    matter_id: null,
    intake_sent_at: null,
    intake_completed_at: null,
    engagement_status: null,
    engagement_sent_at: null,
    engagement_signed_at: null,
    engagement_fee_quoted: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: null,
    lead_urgency: null,
    taxable_estate: null,
    last_activity_at: null,
  }
}

function matterRow(fields: Partial<MatterListRow> = {}): MatterListRow {
  return {
    matter_id: 'm1',
    matter_name: 'Smith Family Trust',
    stage: 'design',
    status: 'open',
    flags: null,
    matter_created: '2026-06-01T00:00:00.000Z',
    client_name: 'Sam Smith',
    client_email: 'sam@example.com',
    client_phone: '617-555-0100',
    client_dob: null,
    client_address: null,
    spouse_name: null,
    spouse_email: null,
    spouse_phone: null,
    spouse_dob: null,
    spouse_address: null,
    plan_type: null,
    marital_status: null,
    has_minor_children: null,
    taxable_estate: null,
    intake_status: null,
    design_status: null,
    intake_submitted_at: null,
    drafts_sent_at: null,
    signing_date: null,
    documents_executed_at: null,
    next_appointment: null,
    next_appointment_type: null,
    referral_source: null,
    fee_amount: null,
    opened_at: null,
    matter_number: '2026-EP-Smith',
    ...fields,
  }
}

describe('the leads list export button', () => {
  function renderLeads(params: Partial<React.ComponentProps<typeof LeadsClient>['params']> = {}) {
    return render(
      <LeadsClient
        initialLeads={[leadRow('lead-1')]}
        params={{
          status: 'open', card: null, search: '', practice: 'all',
          progress: 'all', sort: 'newest', show: 50, ...params,
        }}
        total={1}
        hasMore={false}
        summary={SUMMARY}
        esignEnabled
      />,
    )
  }

  it('asks the server for the leads matching the filters on screen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['Name,Email,Phone'], { type: 'text/csv' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderLeads({ status: 'lost', search: 'Doe', practice: 'Probate', card: 'attention' })
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const query = new URLSearchParams(url.split('?')[1])
    expect(query.get('status')).toBe('lost')
    expect(query.get('search')).toBe('Doe')
    expect(query.get('practice')).toBe('Probate')
    expect(query.get('card')).toBe('attention')
    // The route is admin-only, so the download carries the session token.
    expect(init.headers).toEqual({ Authorization: 'Bearer token-1' })
    expect(created).toHaveLength(1)
  })

  it('reports a failed export instead of saving an error body as a CSV', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'view missing' }),
    }))

    renderLeads()
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('view missing'))
    expect(created).toHaveLength(0)
  })
})

describe('the matters list export button', () => {
  it('writes the rows currently listed, without a server round trip', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<MattersClient matters={[matterRow(), matterRow({
      matter_id: 'm2',
      client_name: 'Dana Lee',
      client_email: 'dana@example.com',
      matter_number: '2026-EP-Lee',
    })]} loadError={null} />)
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(fetchMock).not.toHaveBeenCalled()
    const csv = await lastBlob!.text()
    expect(csv.split('\n')).toHaveLength(3)
    expect(csv).toContain('Sam Smith')
    expect(csv).toContain('2026-EP-Lee')
  })

  it('exports the narrowed list when a search is filtering it', async () => {
    render(<MattersClient matters={[matterRow(), matterRow({
      matter_id: 'm2',
      client_name: 'Dana Lee',
      matter_name: 'Lee Trust',
      client_email: 'dana@example.com',
      matter_number: '2026-EP-Lee',
    })]} loadError={null} />)

    await userEvent.type(screen.getByRole('searchbox', { name: /Search matters/i }), 'Dana')
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }))

    await waitFor(() => expect(created).toHaveLength(1))
    const csv = await lastBlob!.text()
    expect(csv).toContain('Dana Lee')
    expect(csv).not.toContain('Sam Smith')
  })
})
