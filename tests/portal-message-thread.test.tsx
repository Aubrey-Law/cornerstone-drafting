// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MessageThread from '@/app/(portal)/messages/MessageThread'
import type { Message } from '@/app/(portal)/messages/actions'

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
})
