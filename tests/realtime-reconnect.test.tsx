// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const realtime = vi.hoisted(() => {
  let status: ((value: string) => void) | undefined
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn((callback: (value: string) => void) => { status = callback; return channel }),
  }
  channel.on.mockReturnValue(channel)
  return { channel, getStatus: () => status, removeChannel: vi.fn() }
})

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    channel: () => realtime.channel,
    removeChannel: realtime.removeChannel,
  },
}))

import { useMessagesRealtime } from '@/lib/messages/useMessagesRealtime'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function Harness({ onReconnect }: { onReconnect: () => void }) {
  useMessagesRealtime('matter-1', () => {}, onReconnect)
  return null
}

describe('message realtime reconnect', () => {
  it('requests a history reconciliation after a channel subscribes again', () => {
    const onReconnect = vi.fn()
    render(<Harness onReconnect={onReconnect} />)
    const status = realtime.getStatus()!

    act(() => status('SUBSCRIBED'))
    expect(onReconnect).not.toHaveBeenCalled()
    act(() => status('CHANNEL_ERROR'))
    act(() => status('SUBSCRIBED'))

    expect(onReconnect).toHaveBeenCalledTimes(1)
  })
})
