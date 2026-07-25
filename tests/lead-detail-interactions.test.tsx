// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))

import { LeadDetailClient } from '@/app/admin/leads/[id]/LeadDetailClient'
import { LeadIntakeCard } from '@/app/admin/leads/[id]/LeadIntakeCard'

const lead = { id:'l1', first_name:'Jane', middle_name:null, last_name:'Doe', preferred_name:null, full_name:'Jane Doe', email:'jane@example.com', phone:'617', date_of_birth:null, address_line1:'1 Main', address_line2:null, city:'Boston', state:'MA', zip:'02108', county:'Suffolk', marital_status:'married', practice_area:'EP', lead_source:'Referral', lead_status:'lead', engagement_fee_quoted:4500 }
const spouse = { first_name:'John', middle_name:null, last_name:'Doe', preferred_name:null, email:'john@example.com', phone:null, date_of_birth:null }

afterEach(() => { cleanup(); vi.restoreAllMocks(); router.push.mockReset(); router.refresh.mockReset(); toastError.mockReset() })

describe('lead detail page', () => {
  it('renders the intake status strip without duplicate next actions', () => {
    render(<LeadIntakeCard intake={{}} intakeUrl={null} onOpen={vi.fn()} onCopy={vi.fn()} />)

    expect(screen.getByText('Never sent · nothing submitted · 0 of 7 sections')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open intake' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Copy link' }).getAttribute('aria-describedby')).toBe('intake-link-unavailable')
    expect(screen.getAllByLabelText(/incomplete$/i)).toHaveLength(7)
    for (const duplicate of ['Send intake', 'Resend intake', 'Import intake', 'Summarize intake', 'Analyze MA estate tax']) {
      expect(screen.queryByRole('button', { name: duplicate })).toBeNull()
    }
  })

  it('renders the lead-stage intake workspace', () => {
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    expect(screen.getByRole('region', { name: 'Lead intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open intake' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Send intake' }).length).toBeGreaterThan(0)
  })

  it('refreshes intake progress when the server supplies a newer intake record', () => {
    const { rerender } = render(
      <LeadDetailClient lead={{ ...lead, updated_at: '2026-07-25T00:00:00Z', status: 'draft' }} spouse={spouse} initialActivity={[]} />,
    )
    expect(screen.getByText('Never sent · nothing submitted · 0 of 7 sections')).toBeTruthy()

    rerender(
      <LeadDetailClient lead={{ ...lead, updated_at: '2026-07-25T00:01:00Z', status: 'submitted' }} spouse={spouse} initialActivity={[]} />,
    )

    expect(screen.getByText('Sent · submitted · 1 of 7 sections')).toBeTruthy()
  })

  it('keeps the returned intake link available to copy after sending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      return { ok: true, json: async () => ({ url: 'https://example.test/intake?invite=abc' }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getAllByRole('button', { name: 'Send intake' })[0])
    expect((await screen.findByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('places actions first and cards in Details, Notes, Activity order', () => {
    const { container } = render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    const text = container.textContent ?? ''
    expect(text.indexOf('Send intake')).toBeLessThan(text.indexOf('Lead details'))
    expect(text.indexOf('Lead details')).toBeLessThan(text.indexOf('Notes'))
    expect(text.indexOf('Notes')).toBeLessThan(text.indexOf('Activity'))
  })

  it('keeps the activity timeline compact until older events are requested', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      id: `a${index}`,
      event_type: 'details_updated',
      title: `Event ${index + 1}`,
      detail: null,
      created_at: `2026-07-${String(13 - index).padStart(2, '0')}T12:00:00Z`,
    }))
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={rows} />)
    expect(screen.queryByText('Event 9')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }))
    expect(screen.getByText('Event 9')).toBeTruthy()
  })

  it('offers a top-row status control and resumes an active agreement', () => {
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} activeAgreement={{id:'a1'}} />)
    expect(screen.getByRole('combobox',{name:'Matter status'}).textContent).toContain('Lead')
    expect(screen.getByRole('button',{name:'Resume engagement'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'Hire matter'})).toBeTruthy()
  })

  it('converts from the top row and navigates to the returned matter', async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({matterId:'m1'})} as Response)
    const user=userEvent.setup();render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Hire matter'}))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/admin/leads/l1/convert',expect.objectContaining({method:'POST'}))
    expect(router.push).toHaveBeenCalledWith('/admin/matters/m1')
  })

  it('announces a conversion error and remains on the lead', async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,json:async()=>({error:'Conversion failed'})} as Response)
    const user=userEvent.setup();render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Hire matter'}))
    expect((await screen.findByRole('alert')).textContent).toContain('Conversion failed')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('renders populated values, all missing chips, the exact meter, and no whole-card controls or placeholders', () => {
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    expect(screen.getByText('9 of 14 complete')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Lead details completeness' }).getAttribute('aria-valuenow')).toBe('9')
    expect(screen.getByRole('button', { name: 'Edit Phone' }).textContent).toContain('617')
    expect(screen.queryByText('Date of birth')).toBeNull()
    expect(screen.queryByText('Matter status')).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
    for (const control of ['Edit', 'Save', 'Cancel']) {
      expect(screen.queryByRole('button', { name: control })).toBeNull()
    }

    expect(screen.getAllByRole('button', { name: /^\+ Add / }).map(button => button.textContent)).toEqual([
      '+ Add Estate value',
      '+ Add Minor children',
      '+ Add Urgency',
      '+ Add DOB',
      '+ Add Qualification notes',
    ])
    expect(screen.getByText('Intake answers land here automatically — you rarely need to type these.')).toBeTruthy()
    for (const prompt of ['Summarize intake', 'Analyze MA estate tax', 'Draft a pre-call email']) {
      expect(screen.getByRole('button', { name: prompt })).toBeTruthy()
    }
  })

  it('orders priority chips before remaining incomplete fields and renders each incomplete unit once', () => {
    const sparseLead = {
      ...lead,
      phone: null,
      address_line1: null,
      city: null,
      state: null,
      zip: null,
      practice_area: null,
      lead_source: null,
      engagement_fee_quoted: null,
      lead_urgency: null,
      taxable_estate: null,
      has_minor_children: null,
      qualification_notes: null,
    }
    render(<LeadDetailClient lead={sparseLead} spouse={null} initialActivity={[]} />)

    expect(screen.getAllByRole('button', { name: /^\+ Add / }).map(button => button.textContent)).toEqual([
      '+ Add Address',
      '+ Add Spouse',
      '+ Add Estate value',
      '+ Add Minor children',
      '+ Add Quoted fee',
      '+ Add Urgency',
      '+ Add DOB',
      '+ Add Phone',
      '+ Add Practice area',
      '+ Add Lead source',
      '+ Add Qualification notes',
    ])
  })

  it('repairs a missing last name through the existing lastName partial field', async () => {
    const missingLastNameLead = { ...lead, last_name: null, full_name: 'Jane' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...missingLastNameLead, last_name: 'Doe' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={missingLastNameLead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: '+ Add Name' }))
    const lastName = screen.getByRole('textbox', { name: 'Last name' })
    await user.type(lastName, 'Doe{Enter}')

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'lastName', value: 'Doe' }),
    }))
  })

  it('provides separate edit affordances for every populated name component', () => {
    render(
      <LeadDetailClient
        lead={{ ...lead, middle_name: 'Q', preferred_name: 'Janie' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )

    for (const label of ['First name', 'Middle name', 'Last name', 'Preferred name']) {
      expect(screen.getByRole('button', { name: `Edit ${label}` })).toBeTruthy()
    }
  })

  it('adds a blank middle name through its scalar partial field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, middle_name: 'Quincy' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    expect(screen.queryByText('—')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add Middle name' }))
    await user.type(screen.getByRole('textbox', { name: 'Middle name' }), 'Quincy{Enter}')

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'middleName', value: 'Quincy' }),
    }))
  })

  it('adds a blank preferred name through its scalar partial field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, preferred_name: 'Janie' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    expect(screen.queryByText('—')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add Preferred name' }))
    await user.type(screen.getByRole('textbox', { name: 'Preferred name' }), 'Janie{Enter}')

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'preferredName', value: 'Janie' }),
    }))
  })

  it('opens a populated phone in one click and Enter PATCHes only that field while announcing save state', async () => {
    let resolvePatch!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { resolvePatch = resolve })
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '617-555-0111{Enter}')

    expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saving')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'phone', value: '617-555-0111' }),
    }))

    resolvePatch({ ok: true, json: async () => ({ lead: { ...lead, phone: '617-555-0111' }, spouse }) } as Response)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saved'))
    expect(screen.getByRole('button', { name: 'Edit Phone' }).textContent).toContain('617-555-0111')
  })

  it('commits a changed scalar field on blur', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead: { ...lead, phone: '781' }, spouse }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '781')
    await user.click(screen.getByRole('button', { name: 'Summarize intake' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'phone', value: '781' }),
    })))
  })

  it('Escape restores the persisted value without sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, 'changed{Escape}')

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    expect(screen.queryByRole('textbox', { name: 'Phone' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Phone' }).textContent).toContain('617')
  })

  it('disables other detail triggers and chips while a dirty editor is active', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse }) } as Response
      return { ok: true, json: async () => ({ calls: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '999')

    const emailTrigger = screen.getByRole('button', { name: 'Edit Email' }) as HTMLButtonElement
    const dobChip = screen.getByRole('button', { name: '+ Add DOB' }) as HTMLButtonElement
    expect(emailTrigger.disabled).toBe(true)
    expect(dobChip.disabled).toBe(true)
    await user.click(emailTrigger)
    await user.click(dobChip)

    expect((screen.getByRole('textbox', { name: 'Phone' }) as HTMLInputElement).value).toBe('999')
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  })

  it('commits on a later outside blur after a disabled handoff attempt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, phone: '999' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '999')
    await user.click(screen.getByRole('button', { name: 'Edit Email' }))
    await user.click(screen.getByRole('button', { name: 'Summarize intake' }))

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patches).toHaveLength(1)
      expect(patches[0]?.[1]?.body).toBe(JSON.stringify({ field: 'phone', value: '999' }))
    })
  })

  it('disables status and top actions during an active edit and its pending save', async () => {
    let resolvePatch!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { resolvePatch = resolve })
      return { ok: true, json: async () => ({ calls: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const topControls = [
      screen.getByRole('combobox', { name: 'Matter status' }),
      screen.getByRole('button', { name: 'Send intake' }),
      screen.getByRole('button', { name: 'Draft engagement' }),
      screen.getByRole('button', { name: 'Hire matter' }),
    ] as HTMLButtonElement[]
    for (const control of topControls) expect(control.disabled).toBe(true)

    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '617-555-0111{Enter}')
    expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saving')
    for (const control of topControls) expect(control.disabled).toBe(true)

    resolvePatch({ ok: true, json: async () => ({ lead: { ...lead, phone: '617-555-0111' }, spouse }) } as Response)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saved'))
  })

  it('rolls back, closes, restores trigger focus, and toasts when the server rejects a field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Phone is invalid' }),
    } as Response)
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, 'bad{Enter}')

    const trigger = await screen.findByRole('button', { name: 'Edit Phone' })
    expect(trigger.textContent).toContain('617')
    await waitFor(() => expect(trigger).toBe(document.activeElement))
    const alert = screen.getByRole('alert')
    expect(alert.id).toBe('lead-phone-error')
    expect(alert.textContent).toBe('Phone is invalid')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe('lead-phone-error')
    expect(toastError).toHaveBeenCalledWith('Phone is invalid')
  })

  it('keeps address editing atomic and commits only after focus leaves the compound editor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, address_line1: '2 Main' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Address' }))
    const street = screen.getByRole('textbox', { name: 'Address line 1' })
    await user.clear(street)
    await user.type(street, '2 Main')
    await user.click(screen.getByRole('textbox', { name: 'City' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Summarize intake' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        field: 'address',
        value: {
          addressLine1: '2 Main',
          addressLine2: null,
          city: 'Boston',
          state: 'MA',
          zip: '02108',
          county: 'Suffolk',
        },
      }),
    })))
  })

  it('cancels spouse removal without blur-saving or discarding the editor draft', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/calls?limit=50')) return { ok: true, json: async () => ({ calls: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse }) } as Response
      return { ok: true, json: async () => ({ activity: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect((screen.getByRole('textbox', { name: 'Spouse first name' }) as HTMLInputElement).value).toBe('Jonathan')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  })

  it('retains spouse removal confirmation and persists only null after confirmation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse: null }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Remove spouse' }))
    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patchCalls).toHaveLength(1)
      expect(patchCalls[0]).toEqual([
        '/api/admin/leads/l1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ field: 'spouse', value: null }),
        }),
      ])
    })
  })

  it('keyboard spouse removal never blur-saves a draft before cancel or null confirmation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse: null }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')

    const removeTrigger = screen.getByRole('button', { name: 'Remove spouse' })
    removeTrigger.focus()
    await user.keyboard('{Enter}')
    let dialog = await screen.findByRole('alertdialog')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect((screen.getByRole('textbox', { name: 'Spouse first name' }) as HTMLInputElement).value).toBe('Jonathan')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    screen.getByRole('button', { name: 'Remove spouse' }).focus()
    await user.keyboard('{Enter}')
    dialog = await screen.findByRole('alertdialog')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    within(dialog).getByRole('button', { name: 'Remove spouse' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patches).toHaveLength(1)
      expect(patches[0]?.[1]?.body).toBe(JSON.stringify({ field: 'spouse', value: null }))
    })
  })

  it('retains the spouse draft and links a focused removal error when null persistence fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: false, json: async () => ({ error: 'Could not remove spouse' }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove spouse' }))

    const removeTrigger = await screen.findByRole('button', { name: 'Remove spouse' })
    expect((screen.getByRole('textbox', { name: 'Spouse first name' }) as HTMLInputElement).value).toBe('Jonathan')
    const alert = screen.getByRole('alert')
    expect(alert.id).toBe('lead-spouse-error')
    expect(alert.textContent).toBe('Could not remove spouse')
    expect(removeTrigger.getAttribute('aria-invalid')).toBe('true')
    expect(removeTrigger.getAttribute('aria-describedby')).toBe('lead-spouse-error')
    await waitFor(() => expect(removeTrigger).toBe(document.activeElement))
    expect(toastError).toHaveBeenCalledWith('Could not remove spouse')
  })

  it('clears a failed removal error after spouse recovery so later field errors remain visible', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method !== 'PATCH') return { ok: true, json: async () => ({}) } as Response

      const body = JSON.parse(String(init.body)) as { field: string; value: unknown }
      if (body.field === 'spouse' && body.value === null) {
        return { ok: false, json: async () => ({ error: 'Could not remove spouse' }) } as Response
      }
      if (body.field === 'spouse') {
        return {
          ok: true,
          json: async () => ({ lead, spouse: { ...spouse, first_name: 'Jonathan' } }),
        } as Response
      }
      return { ok: false, json: async () => ({ error: 'Phone is invalid' }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove spouse' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not remove spouse')

    await user.click(screen.getByRole('button', { name: 'Save spouse' }))
    const spouseTrigger = await screen.findByRole('button', { name: 'Edit Spouse' })
    expect(screen.queryByText('Could not remove spouse')).toBeNull()
    expect(spouseTrigger.getAttribute('aria-invalid')).toBeNull()
    expect(spouseTrigger.getAttribute('aria-describedby')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, 'bad{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert.id).toBe('lead-phone-error')
    expect(alert.textContent).toBe('Phone is invalid')
  })
})
