// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let pathname = '/admin/today'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'test-token' }))

const draftProps: Array<Record<string, unknown>> = []
vi.mock('@/components/matter/DraftWithAiButton', () => ({
  DraftWithAiButton: (props: Record<string, unknown>) => {
    draftProps.push(props)
    return <button type="button">Draft with AI</button>
  },
}))

const DIRECTORY = [
  {
    digits: '7815551212', name: 'Margaret Whitfield', detail: '2026-EP-0142',
    matterId: 'm1', matterNumber: '2026-EP-0142', leadId: null, contactId: null,
    practiceArea: null, stage: null,
  },
  {
    digits: '6175559090', name: 'Harold Pike', detail: 'Lead',
    matterId: null, matterNumber: null, leadId: 'l1', contactId: null,
    practiceArea: null, stage: null,
  },
  {
    digits: '6175557070', name: 'Rita Referrer', detail: 'Referring CPA',
    matterId: null, matterNumber: null, leadId: null, contactId: 'c1',
    practiceArea: null, stage: null,
  },
]

vi.mock('@/components/softphone/usePhoneDirectory', () => ({
  usePhoneDirectory: () => ({ entries: DIRECTORY, lookup: () => null }),
}))

import { RailSmsPane } from '@/components/rail/RailSmsPane'

let posted: Array<{ url: string; body: unknown }> = []

beforeEach(() => {
  pathname = '/admin/today'
  draftProps.length = 0
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

const renderPane = (smsConfigured = true) =>
  render(<RailSmsPane smsConfigured={smsConfigured} />)

async function pick(user: ReturnType<typeof userEvent.setup>, query: string, option: string) {
  await user.type(screen.getByLabelText('Search people to text'), query)
  await user.click(await screen.findByRole('option', { name: new RegExp(option) }))
}

describe('RailSmsPane', () => {
  it('asks who to text when the page is not about a record', () => {
    renderPane()
    expect(screen.getByText(/Search for whoever you want to text/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send text' }).hasAttribute('disabled')).toBe(true)
  })

  it('defaults to the record the current page is about', async () => {
    pathname = '/admin/matters/m1'
    renderPane()
    await waitFor(() => expect(screen.getByText('Margaret Whitfield')).toBeTruthy())
  })

  it('texts a contact picked from the directory', async () => {
    const user = userEvent.setup()
    renderPane()
    await pick(user, 'rita', 'Rita Referrer')
    await user.type(screen.getByLabelText('Text message'), 'Thanks for the referral')
    await user.click(screen.getByRole('button', { name: 'Send text' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toBe('/api/admin/contacts/c1/send-sms')
    expect(posted[0].body).toEqual({ body: 'Thanks for the referral' })
  })

  it('texts a lead through the lead route', async () => {
    const user = userEvent.setup()
    renderPane()
    await pick(user, 'harold', 'Harold Pike')
    await user.type(screen.getByLabelText('Text message'), 'Checking in')
    await user.click(screen.getByRole('button', { name: 'Send text' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toBe('/api/admin/leads/l1/send-sms')
  })

  it('sends a matter text with the recipient role the API expects', async () => {
    const user = userEvent.setup()
    renderPane()
    await pick(user, 'whitfield', 'Margaret Whitfield')
    await user.type(screen.getByLabelText('Text message'), 'Signing Tuesday')
    await user.click(screen.getByRole('button', { name: 'Send text' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toBe('/api/admin/matters/m1/send-sms')
    expect(posted[0].body).toEqual({ recipient: 'client', body: 'Signing Tuesday' })
  })

  it('points AI drafting at the recipient’s own record', async () => {
    const user = userEvent.setup()
    renderPane()
    await pick(user, 'rita', 'Rita Referrer')
    await waitFor(() => expect(draftProps.length).toBeGreaterThan(0))
    expect(draftProps.at(-1)).toMatchObject({
      apiPath: '/api/admin/contacts/c1/draft-reply',
      channel: 'sms',
    })
  })

  it('finds people by role, not just by name', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(screen.getByLabelText('Search people to text'), 'referring')
    expect(await screen.findByRole('option', { name: /Rita Referrer/ })).toBeTruthy()
  })

  it('explains itself instead of composing when SMS is unconfigured', () => {
    renderPane(false)
    expect(screen.getByText(/Texting is not configured yet/i)).toBeTruthy()
    expect(screen.queryByLabelText('Text message')).toBeNull()
  })
})
