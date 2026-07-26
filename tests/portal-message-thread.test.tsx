// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MessageThread from '@/app/(portal)/messages/MessageThread'
import { sendMessage, type Message } from '@/app/(portal)/messages/actions'
import { useMessagesRealtime } from '@/lib/messages/useMessagesRealtime'

vi.mock('@/app/(portal)/messages/actions', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/messages/useMessagesRealtime', () => ({
  useMessagesRealtime: vi.fn(),
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 6, 25, 12, 0))
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('portal message thread', () => {
  it('separates calendar days and keeps bubble timestamps time-only', () => {
    const message = (
      id: string,
      body: string,
      createdAt: Date,
    ): Message => ({
      id,
      matter_id: 'matter-1',
      sender_role: 'client',
      sender_id: 'client-1',
      body,
      created_at: createdAt.toISOString(),
      read_at: createdAt.toISOString(),
    })

    render(
      <MessageThread
        matterId="matter-1"
        clientUserId="client-1"
        messages={[
          message('older', 'Older message', new Date(2026, 6, 23, 9, 5)),
          message('yesterday', 'Yesterday message', new Date(2026, 6, 24, 14, 30)),
          message('today', 'Today message', new Date(2026, 6, 25, 10, 15)),
          message('today-later', 'Later today', new Date(2026, 6, 25, 11, 45)),
        ]}
      />,
    )

    expect(screen.getByText('Jul 23')).toBeTruthy()
    expect(screen.getByText('Yesterday')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getAllByText('Today')).toHaveLength(1)
    expect(screen.getByText('9:05 am')).toBeTruthy()
    expect(screen.getByText('2:30 pm')).toBeTruthy()
    expect(screen.getByText('10:15 am')).toBeTruthy()
    expect(screen.queryByText(/Jul 25, 10:15/i)).toBeNull()
  })

  it('keeps the realtime subscription stable while the client types', () => {
    render(<MessageThread matterId="matter-1" clientUserId="client-1" messages={[]} />)

    const initialHandler = vi.mocked(useMessagesRealtime).mock.calls.at(-1)?.[1]
    const textarea = screen.getByPlaceholderText('Write a message…')

    fireEvent.change(textarea, { target: { value: 'H' } })
    fireEvent.change(textarea, { target: { value: 'He' } })
    fireEvent.change(textarea, { target: { value: 'Hel' } })

    // The hook re-subscribes whenever the handler identity changes. An inline
    // arrow made every keystroke tear down and recreate the websocket channel,
    // dropping any INSERT that arrived in the gap.
    const handlerAfterTyping = vi.mocked(useMessagesRealtime).mock.calls.at(-1)?.[1]
    expect(handlerAfterTyping).toBe(initialHandler)
  })

  it('renders one bubble when the realtime echo beats the send action', async () => {
    const saved: Message = {
      id: 'saved-1',
      matter_id: 'matter-1',
      sender_role: 'client',
      sender_id: 'client-1',
      body: 'Hello from the client',
      created_at: new Date(2026, 6, 25, 12, 0).toISOString(),
      read_at: null,
    }

    let resolveSend: (message: Message) => void = () => {}
    vi.mocked(sendMessage).mockReturnValue(
      new Promise<Message>(resolve => {
        resolveSend = resolve
      }),
    )

    render(<MessageThread matterId="matter-1" clientUserId="client-1" messages={[]} />)

    const textarea = screen.getByPlaceholderText('Write a message…')
    fireEvent.change(textarea, { target: { value: saved.body } })

    const sendButton = screen.getAllByRole('button').at(-1)!
    fireEvent.click(sendButton)

    // Optimistic bubble is on screen while the action is in flight.
    expect(screen.getAllByText(saved.body)).toHaveLength(1)

    // The realtime echo of this same insert commonly lands first: sendMessage
    // also awaits an admin notification email before returning.
    const onInsert = vi.mocked(useMessagesRealtime).mock.calls.at(-1)![1]
    act(() => {
      onInsert(saved as never)
    })

    await act(async () => {
      resolveSend(saved)
    })

    // Previously the optimistic row was mapped onto `saved`, producing a second
    // identical bubble with a duplicate React key.
    expect(screen.getAllByText(saved.body)).toHaveLength(1)
  })
})
