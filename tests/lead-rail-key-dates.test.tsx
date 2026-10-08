// @vitest-environment jsdom
import React from 'react'
import fs from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }))
const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/crm/opportunities/l1',
  useSearchParams: () => searchParams.current,
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))

import { LeadDetailClient } from '@/app/admin/leads/[id]/LeadDetailClient'
import { LeadFieldsRail } from '@/components/leads/LeadFieldsRail'
import { LeadKeyDatesCard } from '@/components/leads/LeadKeyDatesCard'

const lead = {
  id: 'l1', first_name: 'Jane', middle_name: null, last_name: 'Doe', preferred_name: null,
  full_name: 'Jane Doe', email: 'jane@example.com', phone: '617', date_of_birth: null,
  address_line1: '1 Main', address_line2: null, city: 'Boston', state: 'MA', zip: '02108',
  county: 'Suffolk', marital_status: 'married', practice_area: 'EP', lead_source: 'Referral',
  lead_status: 'lead', engagement_fee_quoted: 4500, matter_id: 'm-1',
  created_at: '2026-07-21T12:00:00Z', updated_at: '2026-07-25T10:00:00Z',
  intake_sent_at: null, intake_completed_at: null, lead_next_action_snoozed_until: null,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  toastError.mockReset()
  toastSuccess.mockReset()
})

describe('opportunity rail key dates', () => {
  it('saves a discovery date to the matter that owns the SLA clock', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ anchors: { discoveryCallAt: '2026-08-03', pmpsAt: null }, rescheduled: 4 }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(
      <LeadDetailClient
        lead={lead}
        spouse={null}
        initialActivity={[]}
        initialKeyDates={{ discoveryCallAt: null, pmpsAt: null }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit lead details and dates' }))
    fireEvent.change(screen.getByLabelText('Discovery date'), { target: { value: '2026-08-03' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/matters/m-1/sla-anchors',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ discoveryCallAt: '2026-08-03' }),
      }),
    ))
    // The route re-dates the tasks waiting on the anchor and says how many.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved — 4 tasks scheduled'))
  })

  it('leaves the section out when the opportunity has no matter behind it', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
    render(<LeadDetailClient lead={{ ...lead, matter_id: null }} spouse={null} initialActivity={[]} />)

    expect(screen.queryByLabelText('Discovery date')).toBeNull()
    expect(screen.queryByLabelText('PMPS date')).toBeNull()
  })

  it('offers both anchors, and only saves a date that is complete', async () => {
    const onSaveKeyDate = vi.fn().mockResolvedValue(undefined)
    render(
      <LeadKeyDatesCard
        keyDates={{ discoveryCallAt: null, pmpsAt: '2026-09-01' }}
        onSaveKeyDate={onSaveKeyDate}
      />,
    )

    expect((screen.getByLabelText('PMPS date') as HTMLInputElement).value).toBe('2026-09-01')

    // A date input reads back as "" until every segment is filled — that must
    // not be mistaken for a cleared date mid-entry.
    fireEvent.change(screen.getByLabelText('Discovery date'), { target: { value: '' } })
    expect(onSaveKeyDate).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Discovery date'), { target: { value: '2026-08-03' } })
    expect(onSaveKeyDate).toHaveBeenCalledWith('discoveryCallAt', '2026-08-03')
  })

  it('clears a set anchor when the field is emptied and left', () => {
    const onSaveKeyDate = vi.fn().mockResolvedValue(undefined)
    render(
      <LeadKeyDatesCard
        keyDates={{ discoveryCallAt: null, pmpsAt: '2026-09-01' }}
        onSaveKeyDate={onSaveKeyDate}
      />,
    )

    const pmps = screen.getByLabelText('PMPS date')
    fireEvent.change(pmps, { target: { value: '' } })
    fireEvent.blur(pmps)
    expect(onSaveKeyDate).toHaveBeenCalledWith('pmpsAt', null)
  })

  it('keeps a rail date field open until the whole date is typed', async () => {
    const user = userEvent.setup()
    const onSaveField = vi.fn().mockResolvedValue(undefined)
    let activeField: string | null = null
    function Harness() {
      const [field, setField] = React.useState<string | null>(null)
      activeField = field
      return (
        <LeadFieldsRail
          lead={lead as never}
          spouse={null}
          activeField={field as never}
          onActiveFieldChange={next => setField(next)}
          onSaveField={onSaveField}
          onRemoveSpouse={vi.fn()}
        />
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Add Date of birth' }))
    const input = screen.getByLabelText('Date of birth')
    // Segment-by-segment entry reports "" until the date is whole; the row has
    // to stay open through that.
    fireEvent.change(input, { target: { value: '' } })
    expect(onSaveField).not.toHaveBeenCalled()
    expect(activeField).toBe('dateOfBirth')

    fireEvent.change(input, { target: { value: '1958-04-12' } })
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith('dateOfBirth', '1958-04-12'))
  })
})

describe('the anchors the rail writes', () => {
  it('goes through the route that also re-dates the waiting tasks', () => {
    const route = fs.readFileSync('app/api/admin/matters/[id]/sla-anchors/route.ts', 'utf8')
    expect(route).toContain("discoveryCallAt: { column: 'discovery_call_at', anchor: 'discovery_call'")
    expect(route).toContain("pmpsAt: { column: 'pmps_at', anchor: 'pmps'")
    expect(route).toContain('applySlaAnchor(admin, matterId, anchor, date)')
  })
})

describe('opportunity rail extra addresses', () => {
  it('saves a second client email through the channels route', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ value: [{ label: 'Work', value: 'jane@firm.example.com' }] }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<LeadDetailClient lead={lead} spouse={null} initialActivity={[]} />)

    await user.click(screen.getByRole('tab', { name: 'People' }))
    await user.click(screen.getByRole('button', { name: 'Add Client emails' }))
    await user.type(screen.getByLabelText('Client emails label 1'), 'Work')
    await user.type(screen.getByLabelText('Client emails 1'), 'jane@firm.example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/leads/l1/channels',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          target: 'client',
          field: 'additional_emails',
          value: [{ label: 'Work', value: 'jane@firm.example.com' }],
        }),
      }),
    ))
    // The saved list reads back in the rail without a page refresh.
    expect(await screen.findByText('Work · jane@firm.example.com')).toBeTruthy()
  })

  it('offers the spouse lists only when there is a spouse on file', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
    render(<LeadDetailClient lead={lead} spouse={null} initialActivity={[]} />)
    await user.click(screen.getByRole('tab', { name: 'People' }))
    expect(screen.queryByRole('button', { name: 'Add Spouse emails' })).toBeNull()

    cleanup()
    render(
      <LeadDetailClient
        lead={lead}
        spouse={{ first_name: 'John', last_name: 'Doe', email: 'john@example.com' }}
        initialActivity={[]}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'People' }))
    expect(screen.getByRole('button', { name: 'Add Spouse emails' })).toBeTruthy()
  })
})

describe('the opportunity rail stage control', () => {
  it('moves the lead through the mutable stages from the rail', async () => {
    const user = userEvent.setup()
    const onStageChange = vi.fn()
    render(
      <LeadFieldsRail
        lead={lead as never}
        spouse={null}
        onStageChange={onStageChange}
        activeField={null}
        onActiveFieldChange={vi.fn()}
        onSaveField={vi.fn()}
        onRemoveSpouse={vi.fn()}
      />,
    )

    await user.selectOptions(screen.getByLabelText('Stage'), 'lost')
    expect(onStageChange).toHaveBeenCalledWith('lost')
  })

  it('shows a hired opportunity read-only, since hiring runs through convert', () => {
    render(
      <LeadFieldsRail
        lead={{ ...lead, lead_status: 'hired' } as never}
        spouse={null}
        onStageChange={vi.fn()}
        activeField={null}
        onActiveFieldChange={vi.fn()}
        onSaveField={vi.fn()}
        onRemoveSpouse={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('Stage')).toBeNull()
    expect(screen.getByText('Hired')).toBeTruthy()
  })
})

describe('the opportunity rail estate tax read', () => {
  it('measures the estate against the MA threshold beside the fields', () => {
    render(
      <LeadFieldsRail
        lead={{ ...lead, taxable_estate: 3_000_000 } as never}
        spouse={null}
        activeField={null}
        onActiveFieldChange={vi.fn()}
        onSaveField={vi.fn()}
        onRemoveSpouse={vi.fn()}
      />,
    )

    const card = screen.getByLabelText('Estate tax at a glance')
    expect(within(card).getByText('$3,000,000')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Run tax worksheet' })).toBeTruthy()
  })

  it('offers the estate value field when the lead has no estimate yet', async () => {
    const user = userEvent.setup()
    const onActiveFieldChange = vi.fn()
    render(
      <LeadFieldsRail
        lead={{ ...lead, taxable_estate: null } as never}
        spouse={null}
        activeField={null}
        onActiveFieldChange={onActiveFieldChange}
        onSaveField={vi.fn()}
        onRemoveSpouse={vi.fn()}
      />,
    )

    const card = screen.getByLabelText('Estate tax at a glance')
    expect(within(card).getByText('Unknown')).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: 'Add estate value' }))
    expect(onActiveFieldChange).toHaveBeenCalledWith('estimatedEstateValue')
  })
})
