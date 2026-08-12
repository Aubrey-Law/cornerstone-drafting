// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

import { MatterFactsPanel } from '@/app/admin/matters/[id]/facts-panel/MatterFactsPanel'
import type { MatterActivity, PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

const CONTACTS_PAYLOAD = {
  client: {
    id: 'intake-1',
    first_name: 'Margaret',
    middle_name: 'A',
    last_name: 'Chen',
    full_name: 'Margaret A. Chen',
    email: 'margaret.chen@example.com',
    phone: '(617) 555-0184',
    address_line1: '42 Larchmont Rd',
    city: 'Newton',
    state: 'MA',
    zip: '02459',
    date_of_birth: '1958-04-12',
    marital_status: 'married',
    has_minor_children: false,
    additional_emails: [{ label: 'Work', value: 'm.chen@firm.example.com' }],
    additional_phones: [],
  },
  contacts: [
    {
      id: 'contact-spouse',
      relationship_type: 'spouse',
      first_name: 'Robert',
      last_name: 'Chen',
      email: 'robert.chen@example.com',
      phone: '(617) 555-0199',
      date_of_birth: null,
      role_labels: [],
    },
    {
      id: 'contact-child',
      relationship_type: 'child',
      first_name: 'Elise',
      last_name: 'Chen',
      email: null,
      phone: null,
      date_of_birth: '1992-03-02',
      role_labels: [],
    },
  ],
}

const ESTATE = {
  assetCount: 3,
  ownedAssetValue: 3_000_000,
  deathBenefit: 420_000,
  lifeInsuranceFace: 420_000,
  businessInterests: 0,
  anticipatedInheritance: 0,
  grossEstateEstimate: 3_420_000,
  estateExcludingLifeInsurance: 3_000_000,
  totalDebt: 0,
  netInventoryValue: 3_420_000,
  estimatedMaTax: 118_400,
  maTaxWithCreditShelter: 46_800,
  creditShelterSavings: 71_600,
  latestAssetUpdatedAt: '2026-07-09T00:00:00.000Z',
}

const ACTIVITY = [
  {
    id: 'a1',
    matter_id: 'm-1',
    event_type: 'draft_generated',
    title: null,
    detail: null,
    actor_name: 'Scott Aubrey',
    created_at: '2026-07-28T19:12:00.000Z',
    metadata: {
      documentRefs: [
        { id: 'd1', name: 'Trust.docx' },
        { id: 'd2', name: 'Will.docx' },
        { id: 'd3', name: 'POA.docx' },
        { id: 'd4', name: 'HCP.docx' },
      ],
    },
  },
  {
    id: 'a2',
    matter_id: 'm-1',
    event_type: 'matter_created',
    title: 'Matter created',
    detail: null,
    actor_name: null,
    created_at: '2026-06-18T13:02:00.000Z',
    metadata: { origin: 'lead' },
  },
] as unknown as MatterActivity[]

const DETAILS: MatterDetailsRow = {
  practice_area: 'EP',
  plan_type: 'Trust Plan',
  referral_source: 'Referral — Dr. Alvarez',
  flat_fee_amount: 4800,
  fee_payment_status: 'deposit',
  ep_ma_estate_taxable: true,
  urgency: 'high',
  intake_date: '2026-06-18',
  engagement_signed_at: '2026-06-24T00:00:00.000Z',
  design_meeting_date: '2026-07-09',
  scheduled_signing_date: '2026-08-21T12:00:00.000Z',
}

function matter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    matter_id: 'm-1',
    matter_name: 'Chen Trust',
    client_name: 'Margaret A. Chen',
    client_email: 'margaret.chen@example.com',
    client_phone: '(617) 555-0184',
    client_dob: '1958-04-12',
    client_address: '42 Larchmont Rd, Newton, MA 02459',
    spouse_name: 'Robert J. Chen',
    spouse_email: 'robert.chen@example.com',
    spouse_phone: '(617) 555-0199',
    marital_status: 'married',
    has_minor_children: false,
    stage: 'drafting',
    referral_source: 'Referral — Dr. Alvarez',
    fee_amount: 4800,
    ...overrides,
  } as PipelineMatter
}

type PanelProps = React.ComponentProps<typeof MatterFactsPanel>

function renderPanel(props: Partial<PanelProps> = {}) {
  const onSaveField = props.onSaveField ?? vi.fn().mockResolvedValue(undefined)
  const onOpenTab = props.onOpenTab ?? vi.fn()
  render(
    <MatterFactsPanel
      matter={matter()}
      matterId="m-1"
      details={DETAILS}
      designSheetPlanType={null}
      estate={ESTATE}
      readinessItems={[]}
      activity={ACTIVITY}
      noteText=""
      onNoteTextChange={vi.fn()}
      onAddNote={vi.fn()}
      noteSaving={false}
      noteCount={3}
      latestNoteAt="2026-07-09T00:00:00.000Z"
      savingField={null}
      lastSavedAt={null}
      error={null}
      {...props}
      onSaveField={onSaveField}
      onOpenTab={onOpenTab}
    />,
  )
  return { onSaveField, onOpenTab }
}

function patchCalls() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/contacts')) {
        return { ok: true, json: async () => CONTACTS_PAYLOAD } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('MatterFactsPanel', () => {
  it('renders every section', async () => {
    renderPanel()
    for (const label of ['Contact', 'Spouse', 'Matter details', 'Dates', 'Notes', 'Activity']) {
      expect(await screen.findByRole('button', { name: new RegExp(label, 'i') })).toBeTruthy()
    }
  })

  it('renders the contact and matter field labels', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('margaret.chen@example.com')
    for (const label of ['Email', 'Phone', 'Address', 'Date of birth', 'Minor children', 'Consent']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    for (const label of ['Practice area', 'Plan', 'Lead source', 'Flat fee']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // Dates ships collapsed by default, so open it before asserting its rows.
    await user.click(screen.getByRole('button', { name: /^dates/i }))
    for (const label of ['Engagement signed', 'Target signing', 'Design meeting']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('hides rows with no value until empty fields are shown', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('margaret.chen@example.com')
    // County is unset on this matter, so it starts out of the rail entirely.
    expect(screen.queryByText('County')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show empty fields' }))
    expect(screen.getAllByText('County').length).toBeGreaterThan(0)
    // Dates the matter has not reached come back with it.
    await user.click(screen.getByRole('button', { name: /^dates/i }))
    for (const label of ['Drafts due', 'Drafts review', 'Revisions', 'Plan signed']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }

    await user.click(screen.getByRole('button', { name: 'Hide empty fields' }))
    expect(screen.queryByText('County')).toBeNull()
  })

  it('lists the extra emails a client carries and saves an added one', async () => {
    const user = userEvent.setup()
    renderPanel()
    // The recorded second address reads in the Contact section…
    expect(await screen.findByText('Work · m.chen@firm.example.com')).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'Edit Other emails' })[0])
    await user.click(screen.getByRole('button', { name: 'Add another' }))
    await user.type(screen.getByLabelText('Other emails 2'), 'margaret@personal.example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0))
    const [, init] = patchCalls()[patchCalls().length - 1]
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      target: 'client',
      patch: {
        additional_emails: [
          { label: 'Work', value: 'm.chen@firm.example.com' },
          { label: '', value: 'margaret@personal.example.com' },
        ],
      },
    })
  })

  it('refuses to save an additional email that is not an address', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click((await screen.findAllByRole('button', { name: 'Edit Other emails' }))[0])
    await user.click(screen.getByRole('button', { name: 'Add another' }))
    await user.type(screen.getByLabelText('Other emails 2'), 'not-an-address')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(patchCalls()).toHaveLength(0)
  })

  it('keeps rows that carry a value while empty ones are hidden', async () => {
    renderPanel({ details: { ...DETAILS, jurisdiction_county: 'Middlesex' } })
    expect(await screen.findByText('Middlesex')).toBeTruthy()
    expect(screen.getAllByText('County').length).toBeGreaterThan(0)
  })

  it('hides the Spouse section when the client is not married', async () => {
    renderPanel({ matter: matter({ marital_status: 'single' }) })
    await screen.findByRole('button', { name: /contact/i })
    expect(screen.queryByRole('button', { name: /^spouse$/i })).toBeNull()
  })

  it('shows the date of birth with the age', async () => {
    renderPanel()
    expect(await screen.findByText(/Apr 12, 1958/)).toBeTruthy()
  })

  it('shows the gross estate and estimated MA tax read-only', async () => {
    renderPanel()
    expect(await screen.findByText('Gross estate est.')).toBeTruthy()
    expect(screen.getByText('Estimated MA tax')).toBeTruthy()
  })

  it('offers exactly the three fee statuses and saves the stored value', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel()
    const select = await screen.findByLabelText('Fee status')
    expect([...select.querySelectorAll('option')].map(option => option.textContent)).toEqual([
      'Unpaid',
      'Deposit',
      'Paid in full',
    ])
    expect([...select.querySelectorAll('option')].map(option => option.getAttribute('value'))).toEqual([
      'unpaid',
      'deposit',
      'paid_in_full',
    ])
    await user.selectOptions(select, 'paid_in_full')
    expect(onSaveField).toHaveBeenCalledWith('fee_payment_status', 'paid_in_full')
  })

  it('maps the attorney decision select onto the boolean column', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel()
    const select = await screen.findByLabelText('Attorney decision')
    await user.selectOptions(select, 'not-tax-sensitive')
    expect(onSaveField).toHaveBeenCalledWith('ep_ma_estate_taxable', false)
    await user.selectOptions(select, 'not-reviewed')
    expect(onSaveField).toHaveBeenCalledWith('ep_ma_estate_taxable', null)
  })

  it('saves a matter details field through onSaveField', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Show empty fields' }))
    await user.click(await screen.findByRole('button', { name: /County/ }))
    const input = screen.getByLabelText('County')
    await user.clear(input)
    await user.type(input, 'Middlesex{Enter}')
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith('jurisdiction_county', 'Middlesex'))
  })

  it('picks the lead source from the enum rather than free text', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel()
    const select = await screen.findByLabelText('Lead source')
    await user.selectOptions(select, 'seminar')
    expect(onSaveField).toHaveBeenCalledWith('referral_source', 'seminar')
  })

  it('offers an Other detail field only when the source is Other', async () => {
    const user = userEvent.setup()
    renderPanel({ details: { ...DETAILS, referral_source: 'other', referral_source_other: 'Rotary breakfast' } })
    expect(await screen.findByText('Lead source detail')).toBeTruthy()
    cleanup()
    renderPanel({ details: { ...DETAILS, referral_source: 'google' } })
    await screen.findByLabelText('Lead source')
    expect(screen.queryByText('Lead source detail')).toBeNull()
    await user.click(document.body)
  })

  it('reverts on Escape without saving', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel({
      details: { ...DETAILS, jurisdiction_county: 'Middlesex' },
    })
    await user.click(await screen.findByRole('button', { name: /County/ }))
    const input = screen.getByLabelText('County')
    await user.clear(input)
    await user.type(input, 'Nope{Escape}')
    expect(onSaveField).not.toHaveBeenCalled()
    // County reads twice: editable in Contact, echoed read-only under Plan flags.
    expect((await screen.findAllByText('Middlesex')).length).toBe(2)
  })

  it('saves a client contact field through the contacts route', async () => {
    const user = userEvent.setup()
    renderPanel()
    // Client email first, spouse email second.
    const rows = await screen.findAllByRole('button', { name: /Email/ })
    await user.click(rows[0])
    const input = screen.getAllByLabelText('Email')[0]
    await user.clear(input)
    await user.type(input, 'new@example.com{Enter}')

    await waitFor(() => {
      const patch = patchCalls()[0]
      expect(patch).toBeTruthy()
      expect(JSON.parse(String((patch[1] as RequestInit).body))).toMatchObject({
        target: 'client',
        patch: { email: 'new@example.com' },
      })
    })
  })

  it('saves a spouse field against the spouse contact id', async () => {
    const user = userEvent.setup()
    renderPanel()
    const rows = await screen.findAllByRole('button', { name: /Phone/ })
    // Client phone first, spouse phone second.
    await user.click(rows[1])
    const inputs = screen.getAllByLabelText('Phone')
    await user.clear(inputs[0])
    await user.type(inputs[0], '6175550000{Enter}')

    await waitFor(() => {
      const patch = patchCalls()[0]
      expect(patch).toBeTruthy()
      expect(JSON.parse(String((patch[1] as RequestInit).body))).toMatchObject({
        target: 'contact',
        contactId: 'contact-spouse',
      })
    })
  })

  it('saves the marital status from the identity header', async () => {
    const user = userEvent.setup()
    renderPanel()
    const select = await screen.findByLabelText('Marital status')
    await user.selectOptions(select, 'widowed')

    await waitFor(() => {
      const patch = patchCalls()[0]
      expect(JSON.parse(String((patch[1] as RequestInit).body))).toMatchObject({
        target: 'client',
        patch: { marital_status: 'widowed' },
      })
    })
  })

  it('renders activity with the shared labels and the From lead pill', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /activity/i }))
    expect(await screen.findByText('Generated 4 drafts')).toBeTruthy()
    expect(screen.getByText('Matter created')).toBeTruthy()
    expect(screen.getByText('From lead')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Draft generated activity' })).toBeTruthy()
  })

  it('collapses every section from Collapse all', async () => {
    const user = userEvent.setup()
    renderPanel()
    const contact = await screen.findByRole('button', { name: /contact/i })
    expect(contact.getAttribute('aria-expanded')).toBe('true')
    await user.click(screen.getByRole('button', { name: /collapse all/i }))
    expect(contact.getAttribute('aria-expanded')).toBe('false')
  })

  it('surfaces the save status line', async () => {
    renderPanel({ savingField: 'referral_source' })
    expect(await screen.findByText('Saving…')).toBeTruthy()
  })

  it('reports a save error with an alert role', async () => {
    renderPanel({ error: 'Failed to save referral_source' })
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to save')
  })
})
