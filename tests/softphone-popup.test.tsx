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

import Softphone from '@/components/softphone/Softphone'

describe('Softphone pop-up', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    voiceSdk.reset()
  })

  it('keeps DND from dialing and only allows minimizing active calls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'voice-token' }),
    } as Response)
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

  it('sends keypad digits as DTMF during an active call and reopens to wrap-up after hangup', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'voice-token' }),
    } as Response)
    const user = userEvent.setup()

    render(<Softphone />)

    await screen.findByText('Ready')
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '7815551212' } })
    await user.click(screen.getByRole('button', { name: /^call$/i }))

    await waitFor(() => expect(voiceSdk.getLastDevice()?.connect).toHaveBeenCalledWith({ params: { To: '+17815551212' } }))
    voiceSdk.getLastCall()?.emit('accept')
    await screen.findByText('00:00')

    await user.click(screen.getByRole('button', { name: /minimize/i }))
    expect(screen.queryByRole('group', { name: 'Dial pad' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /open active call/i }))

    const readout = screen.getByText('(781) 555-1212')
    await user.click(within(screen.getByRole('group', { name: 'Dial pad' })).getByRole('button', { name: /5/i }))

    expect(voiceSdk.getLastCall()?.sendDigits).toHaveBeenCalledWith('5')
    expect(readout.textContent).toBe('(781) 555-1212')

    await user.click(screen.getByRole('button', { name: /^end$/i }))

    expect(await screen.findByText('Call wrap-up')).toBeTruthy()
    expect((screen.getByLabelText('Outcome') as HTMLSelectElement).value).toBe('Reached')
    expect(screen.getByLabelText('Call notes')).toBeTruthy()
  })
})
