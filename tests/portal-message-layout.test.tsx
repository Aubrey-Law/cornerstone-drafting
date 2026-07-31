// @vitest-environment jsdom

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MessageThread from '@/app/(portal)/messages/MessageThread'

vi.mock('@/app/(portal)/messages/actions', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/messages/useMessagesRealtime', () => ({
  useMessagesRealtime: vi.fn(),
}))

describe('portal message layout', () => {
  it('keeps the header, conversation, and composer in the shared portal content column', () => {
    Element.prototype.scrollIntoView = vi.fn()

    render(
      <MessageThread
        matterId="matter-1"
        clientUserId="client-1"
        messages={[]}
      />,
    )

    const column = screen.getByTestId('message-column')
    expect(column.className).toContain('max-w-3xl')
    expect(column.contains(screen.getByRole('heading', { name: 'Messages' }))).toBe(true)
    expect(column.contains(screen.getByPlaceholderText('Write a message…'))).toBe(true)
  })
})
