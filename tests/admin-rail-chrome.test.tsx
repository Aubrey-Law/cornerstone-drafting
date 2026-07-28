// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/matters/m1',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))

const callActive = vi.hoisted(() => ({ value: false }))
const hangUpSpy = vi.hoisted(() => ({ mute: vi.fn(), hangUp: vi.fn() }))
vi.mock('@/app/admin/components/ChatPanel', () => ({
  ChatPanel: ({ open }: { open: boolean }) => <div data-testid="chat-panel">assistant open: {String(open)}</div>,
}))
// A stand-in dialer that publishes a live call through the real provider hook,
// so the rail's call bar is exercised without the Twilio/Telnyx SDKs.
vi.mock('@/components/softphone/Softphone', async () => {
  const React = await import('react')
  const { usePublishSoftphoneCall } = await import('@/components/softphone/SoftphoneProvider')
  return {
    default: function FakeSoftphone() {
      const snapshot = React.useMemo(
        () => ({
          active: callActive.value,
          connected: callActive.value,
          muted: false,
          held: false,
          seconds: 42,
          name: 'Margaret Whitfield',
          statusLabel: 'On call',
          wrapUpPending: false,
        }),
        [],
      )
      usePublishSoftphoneCall(snapshot, { toggleMute: hangUpSpy.mute, hangUp: hangUpSpy.hangUp })
      return React.createElement('div', { 'data-testid': 'softphone' }, 'dialer')
    },
  }
})

import { AdminRail, useAdminRail } from '@/components/rail/AdminRail'
import { SoftphoneProvider } from '@/components/softphone/SoftphoneProvider'
import { openCornerstoneAssistant } from '@/app/admin/components/adminChatEvents'

function Harness({ voiceEnabled = true }: { voiceEnabled?: boolean }) {
  const rail = useAdminRail({ voiceEnabled })
  return (
    <SoftphoneProvider voiceEnabled={voiceEnabled}>
      <button type="button" onClick={rail.toggle}>
        toggle rail
      </button>
      <AdminRail rail={rail} voiceEnabled={voiceEnabled} assistantModelLabel="Claude Opus 4.8" />
    </SoftphoneProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  callActive.value = false
  hangUpSpy.mute.mockClear()
  hangUpSpy.hangUp.mockClear()
})

afterEach(cleanup)

describe('admin rail chrome', () => {
  it('starts closed and opens into the assistant tab', async () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /Assistant/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'toggle rail' }))

    expect(screen.getByRole('button', { name: /Assistant/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Phone/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Activity/ })).toBeTruthy()
    expect((await screen.findByTestId('chat-panel')).textContent).toContain('assistant open: true')
  })

  it('hides the phone tab when voice is not configured', async () => {
    render(<Harness voiceEnabled={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'toggle rail' }))
    expect(screen.queryByRole('button', { name: /Phone/ })).toBeNull()
  })

  it('keeps the assistant mounted when minimized so the thread survives', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'toggle rail' }))
    await screen.findByTestId('chat-panel')

    await userEvent.click(screen.getByRole('button', { name: 'Minimize rail' }))

    expect(screen.queryByRole('button', { name: 'Minimize rail' })).toBeNull()
    expect(screen.getByTestId('chat-panel').textContent).toContain('assistant open: false')
  })

  it('persists open state and tab across a remount', async () => {
    const first = render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'toggle rail' }))
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }))
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem('cornerstone.admin.rail')!)).toMatchObject({
        open: true,
        tab: 'activity',
      }),
    )
    first.unmount()

    render(<Harness />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Activity/ }).getAttribute('aria-current')).toBe('page'),
    )
  })

  it('opens the assistant tab when an entry point dispatches the chat event', async () => {
    render(<Harness />)
    await act(async () => {
      openCornerstoneAssistant({ prompt: 'Analyze MA estate tax exposure', send: true })
    })

    expect(screen.getByRole('button', { name: /Assistant/ }).getAttribute('aria-current')).toBe('page')
    expect((await screen.findByTestId('chat-panel')).textContent).toContain('assistant open: true')
  })

  it('toggles the rail with ⌘J', async () => {
    render(<Harness />)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }))
    })
    expect(screen.getByRole('button', { name: /Assistant/ })).toBeTruthy()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }))
    })
    expect(screen.queryByRole('button', { name: /Assistant/ })).toBeNull()
  })

  it('shows no call bar while nothing is live', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'toggle rail' }))
    expect(screen.queryByRole('group', { name: 'Active call' })).toBeNull()
  })

  it('shows the call bar with mute, hang up and expand while the phone is not docked', async () => {
    callActive.value = true
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'toggle rail' }))

    const bar = await screen.findByRole('group', { name: 'Active call' })
    expect(bar.textContent).toContain('Margaret Whitfield')
    expect(bar.textContent).toContain('00:42')

    await userEvent.click(within(bar).getByRole('button', { name: 'Mute call' }))
    expect(hangUpSpy.mute).toHaveBeenCalled()
    await userEvent.click(within(bar).getByRole('button', { name: 'Hang up' }))
    expect(hangUpSpy.hangUp).toHaveBeenCalled()

    // Expanding docks the dialer, which retires the bar.
    await userEvent.click(within(bar).getByRole('button', { name: 'Open active call' }))
    expect(screen.getByRole('button', { name: /Phone/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('group', { name: 'Active call' })).toBeNull()
  })
})
