// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

const voiceSdk = vi.hoisted(() => {
  class FakeCall {
    parameters: Record<string, string> = {}
    handlers = new Map<string, Handler[]>()
    mute = vi.fn()
    sendDigits = vi.fn()
    accept = vi.fn(() => this.emit('accept'))
    reject = vi.fn(() => this.emit('reject'))
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
    getLastDevice: () => FakeDevice.latest,
    getLastCall: () => lastCall,
    reset: () => {
      FakeDevice.latest = null
      lastCall = null
    },
  }
})

vi.mock('@twilio/voice-sdk', () => ({
  Device: voiceSdk.FakeDevice,
  Call: {
    Codec: {
      Opus: 'opus',
      PCMU: 'pcmu',
    },
  },
}))

vi.mock('@telnyx/webrtc', () => ({
  TelnyxRTC: class {
    on() {}
    connect() {}
    disconnect() {}
  },
}))

import Softphone from '@/components/softphone/Softphone'

/** Routes the softphone's fetches: token, directory, and wrap-up save. */
function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/api/token')) {
      return { ok: true, json: async () => ({ provider: 'twilio', token: 'voice-token' }) } as Response
    }
    if (url.includes('/api/admin/phone/directory')) {
      return { ok: true, json: async () => ({ entries: [] }) } as Response
    }
    if (url.includes('/api/admin/phone/call-log')) {
      return { ok: true, json: async () => ({ ok: true, callId: 'c1', mode: 'inserted' }) } as Response
    }
    return { ok: false, json: async () => ({}) } as Response
  })
}

describe('Softphone pop-up', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    voiceSdk.reset()
  })

  it('keeps DND from dialing and only allows minimizing active calls', async () => {
    mockFetch()
    const user = userEvent.setup()

    render(<Softphone />)

    await screen.findByText('Ready')
    expect(screen.queryByRole('button', { name: /minimize/i })).toBeNull()

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })
    await user.click(screen.getByRole('button', { name: /do not disturb/i }))

    const callButton = screen.getByRole('button', { name: /^call$/i }) as HTMLButtonElement
    expect(callButton.disabled).toBe(true)
    await user.click(callButton)
    expect(voiceSdk.getLastDevice()?.connect).not.toHaveBeenCalled()
  })

  it('ignores digit keys typed outside the softphone', async () => {
    mockFetch()
    const user = userEvent.setup()

    render(
      <>
        <input aria-label="Matters search" />
        <Softphone />
      </>,
    )

    await screen.findByText('Ready')
    await user.click(screen.getByLabelText('Matters search'))
    await user.keyboard('781555')

    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Matters search') as HTMLInputElement).value).toBe('781555')
  })

  it('sends keypad digits as DTMF during an active call and saves the wrap-up after hangup', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()

    render(<Softphone />)

    await screen.findByText('Ready')
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })
    await user.click(screen.getByRole('button', { name: /^call$/i }))

    await waitFor(() =>
      expect(voiceSdk.getLastDevice()?.connect).toHaveBeenCalledWith({ params: { To: '+17815551212' } }),
    )
    voiceSdk.getLastCall()?.emit('accept')
    await screen.findByText('00:00')

    // minimize collapses to the timer chip; the active-call controls disappear
    await user.click(screen.getByRole('button', { name: /minimize/i }))
    expect(screen.getByText(/00:00 · on call/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^keypad$/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /open active call/i }))

    // DTMF goes through the in-call keypad
    await user.click(screen.getByRole('button', { name: /^keypad$/i }))
    await user.click(within(screen.getByRole('group', { name: 'Dial pad' })).getByRole('button', { name: /5/i }))
    expect(voiceSdk.getLastCall()?.sendDigits).toHaveBeenCalledWith('5')

    await user.click(screen.getByRole('button', { name: /end call/i }))

    // wrap-up replaces the body: outcome buttons instead of a select
    expect(await screen.findByText(/call ended/i)).toBeTruthy()
    const reached = screen.getByRole('button', { name: 'Reached' })
    expect(reached.getAttribute('aria-pressed')).toBe('true')

    fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: 'Discussed the trust draft' } })
    await user.click(screen.getByRole('button', { name: /save call/i }))

    await waitFor(() => {
      const wrapUpPost = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/admin/phone/call-log'))
      expect(wrapUpPost).toBeTruthy()
      const body = JSON.parse(String((wrapUpPost?.[1] as RequestInit).body))
      expect(body.outcome).toBe('Reached')
      expect(body.notes).toBe('Discussed the trust draft')
      expect(body.direction).toBe('outbound')
    })
  })
})
