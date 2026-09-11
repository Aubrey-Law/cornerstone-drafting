// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/matters/m1',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))

vi.mock('@/app/admin/components/ChatPanel', () => ({
  ChatPanel: ({ open }: { open: boolean }) => <div data-testid="chat-panel">assistant open: {String(open)}</div>,
}))
vi.mock('@/components/rail/RailEmailPane', () => ({
  RailEmailPane: () => <div data-testid="email-pane">compose</div>,
}))
import { AdminRail, useAdminRail } from '@/components/rail/AdminRail'
import { openCornerstoneAssistant } from '@/app/admin/components/adminChatEvents'

function Harness({ voiceEnabled = true }: { voiceEnabled?: boolean }) {
  const rail = useAdminRail({ voiceEnabled })
  return (
    <>
      <button type="button" onClick={rail.toggle}>
        toggle rail
      </button>
      <AdminRail rail={rail} voiceEnabled={voiceEnabled} assistantModelLabel="Claude Opus 4.8" />
    </>
  )
}

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
  window.localStorage.clear()
})

afterEach(cleanup)

describe('admin rail chrome', () => {
  it('starts closed and opens into the assistant tab', async () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /Assistant/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'toggle rail' }))

    expect(screen.getByRole('button', { name: /Assistant/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Phone/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Email/ })).toBeTruthy()
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

  it('opens the email pane with ⌘⇧E and keeps the draft mounted afterwards', async () => {
    render(<Harness />)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', metaKey: true, shiftKey: true }))
    })

    expect(screen.getByRole('button', { name: /Email/ }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByTestId('email-pane')).toBeTruthy()

    // Switching away hides the pane but keeps the unsent draft mounted.
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }))
    expect(screen.getByTestId('email-pane')).toBeTruthy()
  })
})
