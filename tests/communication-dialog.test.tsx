// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CommunicationDialog,
  type CommunicationTarget,
} from '@/components/comms/CommunicationDialog'
import { MAX_LEAD_SMS_BODY_LENGTH, MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/contacts' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const draftProps: Array<Record<string, unknown>> = []
vi.mock('@/components/matter/DraftWithAiButton', () => ({
  DraftWithAiButton: (props: Record<string, unknown>) => {
    draftProps.push(props)
    return <button type="button">Draft with AI</button>
  },
}))

const composerProps: Array<Record<string, unknown>> = []
vi.mock('@/components/rail/RailEmailPane', () => ({
  ManualEmailComposer: (props: Record<string, unknown>) => {
    composerProps.push(props)
    return <div data-testid="email-composer" />
  },
}))

let posted: Array<{ url: string; body: unknown }> = []

beforeEach(() => {
  draftProps.length = 0
  composerProps.length = 0
  posted = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    posted.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
    return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(target: CommunicationTarget, channel: 'email' | 'sms' = 'sms') {
  return render(
    <CommunicationDialog
      open
      channel={channel}
      target={target}
      recipientName="Rita Referrer"
      recipientEmail="rita@cpa.example.com"
      recipientPhone="(617) 555-0104"
      token="test-token"
      onOpenChange={() => {}}
      onSent={() => {}}
    />,
  )
}

describe('CommunicationDialog — text', () => {
  it.each([
    ['lead', { type: 'lead', id: 'l1' }, '/api/admin/leads/l1'],
    ['matter', { type: 'matter', id: 'm1' }, '/api/admin/matters/m1'],
    ['contact', { type: 'contact', id: 'c1' }, '/api/admin/contacts/c1'],
  ] as const)('offers AI drafting on the %s route', (_kind, target, base) => {
    renderDialog(target as CommunicationTarget)
    expect(screen.getByRole('button', { name: 'Draft with AI' })).toBeTruthy()
    expect(draftProps[0]).toMatchObject({ apiPath: `${base}/draft-reply`, channel: 'sms' })
  })

  it('sends a lead text to the lead route', async () => {
    const user = userEvent.setup()
    renderDialog({ type: 'lead', id: 'l1' })
    await user.type(screen.getByLabelText('Text message'), 'Following up')
    await user.click(screen.getByRole('button', { name: 'Send text' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toBe('/api/admin/leads/l1/send-sms')
    expect(posted[0].body).toEqual({ body: 'Following up' })
  })

  it('sends a matter text with the recipient role the API expects', async () => {
    const user = userEvent.setup()
    renderDialog({ type: 'matter', id: 'm1', recipient: 'spouse' })
    await user.type(screen.getByLabelText('Text message'), 'Signing Tuesday')
    await user.click(screen.getByRole('button', { name: 'Send text' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toBe('/api/admin/matters/m1/send-sms')
    expect(posted[0].body).toEqual({ recipient: 'spouse', body: 'Signing Tuesday' })
  })

  it('sends a contact text to the contact route', async () => {
    const user = userEvent.setup()
    renderDialog({ type: 'contact', id: 'c1' })
    await user.type(screen.getByLabelText('Text message'), 'Thanks for the referral')
    await user.click(screen.getByRole('button', { name: 'Send text' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toBe('/api/admin/contacts/c1/send-sms')
    expect(posted[0].body).toEqual({ body: 'Thanks for the referral' })
  })

  it('holds leads and contacts to the shorter limit, matters to the full one', () => {
    renderDialog({ type: 'lead', id: 'l1' })
    expect(screen.getByText(`0/${MAX_LEAD_SMS_BODY_LENGTH}`)).toBeTruthy()
    cleanup()

    renderDialog({ type: 'contact', id: 'c1' })
    expect(screen.getByText(`0/${MAX_LEAD_SMS_BODY_LENGTH}`)).toBeTruthy()
    cleanup()

    renderDialog({ type: 'matter', id: 'm1' })
    expect(screen.getByText(`0/${MAX_SMS_BODY_LENGTH}`)).toBeTruthy()
  })

  it('will not send an empty message', () => {
    renderDialog({ type: 'contact', id: 'c1' })
    expect(screen.getByRole('button', { name: 'Send text' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('CommunicationDialog — email', () => {
  it('scopes the composer to the record so the send is attributed', () => {
    renderDialog({ type: 'contact', id: 'c1' }, 'email')
    expect(screen.getByTestId('email-composer')).toBeTruthy()
    expect(composerProps[0]).toMatchObject({
      recordOverride: { type: 'contact', id: 'c1' },
    })
    expect(composerProps[0].initialContext).toMatchObject({
      recordType: 'contact',
      recipientEmail: 'rita@cpa.example.com',
    })
  })

  it('keeps the matter composer on the matter record', () => {
    renderDialog({ type: 'matter', id: 'm1' }, 'email')
    expect(composerProps[0]).toMatchObject({ recordOverride: { type: 'matter', id: 'm1' } })
  })
})
