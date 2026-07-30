// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerRefresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn() }),
}))

const voiceSdk = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void

  class FakeCall {
    parameters: Record<string, string> = {}
    handlers = new Map<string, Handler[]>()
    mute = vi.fn()
    sendDigits = vi.fn()
    accept = vi.fn(() => this.emit('accept'))
    disconnect = vi.fn(() => this.emit('disconnect'))
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }
  }

  let lastCall: FakeCall | null = null

  class FakeDevice {
    static latest: FakeDevice | null = null
    handlers = new Map<string, Handler[]>()
    connect = vi.fn(async () => {
      lastCall = new FakeCall()
      return lastCall
    })
    register = vi.fn(async () => this.emit('registered'))
    updateToken = vi.fn()
    destroy = vi.fn()
    constructor() {
      FakeDevice.latest = this
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }
  }

  return {
    FakeDevice,
    getLastCall: () => lastCall,
    reset: () => {
      FakeDevice.latest = null
      lastCall = null
    },
  }
})

vi.mock('@twilio/voice-sdk', () => ({
  Device: voiceSdk.FakeDevice,
  Call: { Codec: { Opus: 'opus', PCMU: 'pcmu' } },
}))
vi.mock('@telnyx/webrtc', () => ({ TelnyxRTC: class {} }))

import Softphone from '@/components/softphone/Softphone'
import { SoftphoneProvider } from '@/components/softphone/SoftphoneProvider'
import { openStaffSoftphone } from '@/app/admin/components/softphoneEvents'

const DIRECTORY = [
  {
    digits: '7815551212',
    name: 'Margaret Whitfield',
    matterId: 'm1',
    matterNumber: '2026-EP-0142',
    leadId: null,
    practiceArea: 'Estate Planning',
    stage: 'drafting',
  },
  {
    digits: '6175559090',
    name: 'Harold Pike',
    matterId: null,
    matterNumber: null,
    leadId: 'l1',
    practiceArea: null,
    stage: 'Lead',
  },
]

const BRIEFING = {
  recordType: 'matter' as const,
  recordId: 'm1',
  name: 'Margaret Whitfield',
  matterNumber: '2026-EP-0142',
  headline: 'Send engagement agreement',
  lines: ['stage drafting', '2 unread messages'],
  openItems: ['Send engagement agreement', '2 unread portal messages'],
  assistPrompts: ['Read me the fee quote'],
  followUps: [
    { id: 'matter_note', label: 'Save this summary as a client communication note', kind: 'matter_note' as const },
  ],
}

function mockFetch(overrides: { summary?: string | null } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/token')) {
      return { ok: true, json: async () => ({ provider: 'twilio', token: 't', callerNumber: '+17815550000' }) } as Response
    }
    if (url.includes('/api/admin/phone/directory')) {
      return { ok: true, json: async () => ({ entries: DIRECTORY }) } as Response
    }
    if (url.includes('/api/admin/phone/context')) {
      return { ok: true, json: async () => ({ briefing: BRIEFING }) } as Response
    }
    if (url.includes('/api/admin/phone/call-summary')) {
      if (overrides.summary === null) return { ok: false, json: async () => ({ error: 'nope' }) } as Response
      return {
        ok: true,
        json: async () => ({ draft: overrides.summary ?? 'Discussed the engagement agreement and next steps.' }),
      } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPhone() {
  return render(
    <SoftphoneProvider voiceEnabled>
      <Softphone />
    </SoftphoneProvider>,
  )
}

beforeEach(() => {
  routerRefresh.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  voiceSdk.reset()
})

describe('softphone rail pane', () => {
  it('shows the line status and outbound number in the footer', async () => {
    mockFetch()
    renderPhone()

    expect(await screen.findByText('Ready')).toBeTruthy()
    expect(screen.getByText('· (781) 555-0000')).toBeTruthy()
    expect(screen.getByRole('button', { name: /do not disturb/i })).toBeTruthy()
  })

  it('searches the directory by name, matter number and digits', async () => {
    mockFetch()
    const user = userEvent.setup()
    renderPhone()
    await screen.findByText('Ready')

    const search = screen.getByLabelText('Search the firm directory')
    await user.type(search, 'whitfield')
    expect(screen.getByText('Margaret Whitfield')).toBeTruthy()
    expect(screen.getByText('2026-EP-0142')).toBeTruthy()

    await user.clear(search)
    await user.type(search, '2026-EP')
    expect(screen.getByText('Margaret Whitfield')).toBeTruthy()

    await user.clear(search)
    await user.type(search, '6175559090')
    expect(screen.getByText('Harold Pike')).toBeTruthy()
    expect(screen.getByText('Lead')).toBeTruthy()
  })

  it('fills the dialer from a directory result', async () => {
    mockFetch()
    const user = userEvent.setup()
    renderPhone()
    await screen.findByText('Ready')

    await user.type(screen.getByLabelText('Search the firm directory'), 'whitfield')
    await user.click(screen.getByRole('option', { name: /Margaret Whitfield/ }))

    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('(781) 555-1212')
  })

  it('opens the matched matter SMS composer from the dialer', async () => {
    mockFetch()
    renderPhone()
    await screen.findByText('Ready')

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })

    expect(screen.getByRole('link', { name: 'SMS' }).getAttribute('href')).toBe(
      '/admin/matters/m1?tab=communications&channel=sms',
    )
  })

  it('prefills the dialer from a click-to-call event', async () => {
    mockFetch()
    renderPhone()
    await screen.findByText('Ready')

    await waitFor(() => {
      openStaffSoftphone({ number: '+16175559090' })
      expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('(617) 555-9090')
    })
  })

  it('shows the live-assist block during a call and drops it when the call ends', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderPhone()
    await screen.findByText('Ready')

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })
    await user.click(screen.getByRole('button', { name: /^call$/i }))
    voiceSdk.getLastCall()?.emit('accept')

    expect(await screen.findByText('Live assist')).toBeTruthy()
    expect(
      screen.getByText('Send engagement agreement and 2 unread portal messages.'),
    ).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('matterId=m1'))).toBe(true)

    await user.click(screen.getByRole('button', { name: /end call/i }))
    expect(await screen.findByText(/call ended/i)).toBeTruthy()
    expect(screen.queryByText('Live assist')).toBeNull()
  })

  it('seeds the wrap-up notes with the assistant draft and runs only checked follow-ups', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderPhone()
    await screen.findByText('Ready')

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })
    await user.click(screen.getByRole('button', { name: /^call$/i }))
    voiceSdk.getLastCall()?.emit('accept')
    await screen.findByText('Live assist')
    await user.click(screen.getByRole('button', { name: /end call/i }))

    expect(await screen.findByText('Drafted by the assistant — edit before saving')).toBeTruthy()
    await waitFor(() =>
      expect((screen.getByLabelText('Call notes') as HTMLTextAreaElement).value).toBe(
        'Discussed the engagement agreement and next steps.',
      ),
    )

    // Unchecked: saving posts the call log but no note.
    await user.click(screen.getByRole('button', { name: /save to matter/i }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/phone/call-log'))).toBe(true),
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/chat/save-note'))).toBe(false)
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('posts the follow-up note when its box is checked', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderPhone()
    await screen.findByText('Ready')

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })
    await user.click(screen.getByRole('button', { name: /^call$/i }))
    voiceSdk.getLastCall()?.emit('accept')
    await screen.findByText('Live assist')
    await user.click(screen.getByRole('button', { name: /end call/i }))
    await screen.findByText('Drafted by the assistant — edit before saving')

    await user.click(screen.getByRole('checkbox', { name: /client communication note/i }))
    await user.click(screen.getByRole('button', { name: /save to matter/i }))

    await waitFor(() => {
      const note = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/admin/chat/save-note'))
      expect(note).toBeTruthy()
      const body = JSON.parse(String(note![1]?.body))
      expect(body).toMatchObject({ context_type: 'matter', context_id: 'm1', note_type: 'client_comm' })
    })
  })

  it('degrades silently when the assistant draft fails', async () => {
    mockFetch({ summary: null })
    const user = userEvent.setup()
    renderPhone()
    await screen.findByText('Ready')

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })
    await user.click(screen.getByRole('button', { name: /^call$/i }))
    voiceSdk.getLastCall()?.emit('accept')
    await user.click(await screen.findByRole('button', { name: /end call/i }))

    expect(await screen.findByText(/call ended/i)).toBeTruthy()
    expect(screen.queryByText('Drafted by the assistant — edit before saving')).toBeNull()
    expect((screen.getByLabelText('Call notes') as HTMLTextAreaElement).value).toBe('')
  })
})
