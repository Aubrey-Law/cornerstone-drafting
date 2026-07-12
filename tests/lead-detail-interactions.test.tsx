// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))

import { LeadDetailClient } from '@/app/admin/leads/[id]/LeadDetailClient'

const lead = { id:'l1', first_name:'Jane', middle_name:null, last_name:'Doe', preferred_name:null, full_name:'Jane Doe', email:'jane@example.com', phone:'617', date_of_birth:null, address_line1:'1 Main', address_line2:null, city:'Boston', state:'MA', zip:'02108', county:'Suffolk', marital_status:'married', practice_area:'EP', lead_source:'Referral', lead_status:'lead', engagement_fee_quoted:4500 }
const spouse = { first_name:'John', middle_name:null, last_name:'Doe', preferred_name:null, email:'john@example.com', phone:null, date_of_birth:null }

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('lead detail page', () => {
  it('places actions first and cards in Details, Notes, Activity order', () => {
    const { container } = render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    const text = container.textContent ?? ''
    expect(text.indexOf('Send intake')).toBeLessThan(text.indexOf('Details'))
    expect(text.indexOf('Details')).toBeLessThan(text.indexOf('Notes'))
    expect(text.indexOf('Notes')).toBeLessThan(text.indexOf('Activity'))
  })

  it('starts read-only and Edit reveals every editable field', async () => {
    const user = userEvent.setup(); render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    expect(screen.queryByLabelText('First name')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    for (const name of ['First name','Middle name','Last name','Preferred name','Email','Phone','Date of birth','Address line 1','Address line 2','City','State','ZIP','County','Marital status','Practice area','Lead source','Status','Fee','Spouse first name','Spouse middle name','Spouse last name','Spouse preferred name','Spouse email','Spouse phone','Spouse date of birth']) expect(screen.getByLabelText(name)).toBeTruthy()
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
    expect(await screen.findByText('Invalid email')).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled()
  })
})
