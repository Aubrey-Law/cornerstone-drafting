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
  it('opens on the shared portal page header above a framed conversation and composer', () => {
    Element.prototype.scrollIntoView = vi.fn()

    render(
      <MessageThread
        matterId="matter-1"
        clientUserId="client-1"
        messages={[]}
      />,
    )

    const header = screen.getByTestId('portal-page-header')
    const column = screen.getByTestId('message-column')
    // The title sits in the same page header as every other portal page,
    // and the page shares their width.
    expect(header.contains(screen.getByRole('heading', { name: 'Messages' }))).toBe(true)
    expect(header.parentElement?.className).toContain('max-w-4xl')
    expect(column.contains(screen.getByPlaceholderText('Write a message…'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Send message' }).textContent).toContain('Send')
  })
})
