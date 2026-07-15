// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))

import { LeadDetailClient } from '@/app/admin/leads/[id]/LeadDetailClient'

const lead = { id:'l1', first_name:'Jane', middle_name:null, last_name:'Doe', preferred_name:null, full_name:'Jane Doe', email:'jane@example.com', phone:'617', date_of_birth:null, address_line1:'1 Main', address_line2:null, city:'Boston', state:'MA', zip:'02108', county:'Suffolk', marital_status:'married', practice_area:'EP', lead_source:'Referral', lead_status:'lead', engagement_fee_quoted:4500 }
const spouse = { first_name:'John', middle_name:null, last_name:'Doe', preferred_name:null, email:'john@example.com', phone:null, date_of_birth:null }

afterEach(() => { cleanup(); vi.restoreAllMocks(); router.push.mockReset(); router.refresh.mockReset() })

describe('lead detail page', () => {
  it('renders the lead-stage intake workspace', () => {
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    expect(screen.getByRole('region', { name: 'Lead intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Summarize intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Analyze MA estate tax' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Send intake' }).length).toBeGreaterThan(0)
  })

  it('keeps the returned intake link available to copy after sending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      return { ok: true, json: async () => ({ url: 'https://example.test/intake?invite=abc' }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getAllByRole('button', { name: 'Send intake' })[0])
    expect(await screen.findByRole('button', { name: 'Copy intake link' })).toBeTruthy()
    expect(screen.getByText('https://example.test/intake?invite=abc')).toBeTruthy()
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

  it('refreshes visible activity after a successful details mutation', async () => {
    const user=userEvent.setup()
    vi.spyOn(globalThis,'fetch')
      .mockImplementation(async input => {
        const url = String(input)
        if (url.endsWith('/calls?limit=50')) return {ok:true,json:async()=>({calls:[]})} as Response
        if (url.endsWith('/activity')) return {ok:true,json:async()=>({activity:[{id:'x',title:'Lead details updated',created_at:'2026-07-12T12:00:00Z'}]})} as Response
        return {ok:true,json:async()=>({lead,spouse})} as Response
      })
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Edit'})); await user.click(screen.getByRole('button',{name:'Save'}))
    expect(await screen.findByText('Lead details updated')).toBeTruthy()
  })

  it('starts read-only and Edit reveals every editable field', async () => {
    const user = userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    expect(screen.queryByLabelText('First name')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    for (const name of ['First name','Middle name','Last name','Preferred name','Email','Phone','Date of birth','Address line 1','Address line 2','City','State','ZIP','County','Marital status','Practice area','Lead source','Matter Status','Fee','Estimated estate value','Urgency','Minor children','Qualification notes','Spouse first name','Spouse middle name','Spouse last name','Spouse preferred name','Spouse email','Spouse phone','Spouse date of birth']) expect(screen.getByLabelText(name)).toBeTruthy()
  })

  it('Cancel restores the server snapshot', async () => {
    const user=userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Edit'})); const input=screen.getByLabelText('First name') as HTMLInputElement
    await user.clear(input); await user.type(input,'Changed'); await user.click(screen.getByRole('button',{name:'Cancel'})); await user.click(screen.getByRole('button',{name:'Edit'}))
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Jane')
  })

  it('blocks Save for an invalid email', async () => {
    const fetchMock=vi.spyOn(globalThis,'fetch'); const user=userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Edit'})); const input=screen.getByLabelText('Email'); await user.clear(input); await user.type(input,'bad'); await user.click(screen.getByRole('button',{name:'Save'}))
    expect((await screen.findAllByText('Invalid email')).length).toBeGreaterThan(0)
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/admin/leads/l1' && init?.method === 'PATCH')).toBe(false)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('textbox',{name:/^Email/}).getAttribute('aria-describedby')).toBe('lead-email-error')
  })

  it('confirms removal of a newly entered spouse and preserves values when declined', async () => {
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false); const user=userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={null} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Edit'})); await user.click(screen.getByRole('button',{name:'Add spouse'})); await user.type(screen.getByLabelText('Spouse first name'),'John'); await user.click(screen.getByRole('button',{name:'Remove spouse'}))
    expect(confirm).toHaveBeenCalled(); expect((screen.getByLabelText('Spouse first name') as HTMLInputElement).value).toBe('John')
  })

  it('removes an entirely blank new spouse without confirmation', async () => {
    const confirm=vi.spyOn(window,'confirm'); const user=userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={null} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Edit'})); await user.click(screen.getByRole('button',{name:'Add spouse'})); await user.click(screen.getByRole('button',{name:'Remove spouse'})); expect(confirm).not.toHaveBeenCalled(); expect(screen.getByRole('button',{name:'Add spouse'})).toBeTruthy()
  })

  it('uses supported selects and retains fields after an announced server error', async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,json:async()=>({error:'Save failed'})} as Response); const user=userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Edit'})); expect(screen.getByRole('combobox',{name:'Matter Status'})).toBeTruthy(); expect(screen.getByRole('combobox',{name:'Marital status'})).toBeTruthy(); expect(screen.getByRole('combobox',{name:'Practice area'})).toBeTruthy(); const first=screen.getByLabelText('First name'); await user.clear(first); await user.type(first,'Edited'); await user.click(screen.getByRole('button',{name:'Save'})); expect((await screen.findByRole('alert')).textContent).toContain('Save failed'); expect((first as HTMLInputElement).value).toBe('Edited')
  })

  it('submits the edit form from the keyboard', async () => {
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({lead,spouse})} as Response); const user=userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button',{name:'Edit'})); await user.type(screen.getByLabelText('First name'),'{Enter}'); expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1',expect.objectContaining({method:'PATCH'}))
  })
})
