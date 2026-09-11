// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MessageThread from '@/app/(portal)/messages/MessageThread'
import { acknowledgeMessages, loadOlderMessages, sendMessage, type Message } from '@/app/(portal)/messages/actions'

vi.mock('@/app/(portal)/messages/actions', () => ({ acknowledgeMessages: vi.fn(), loadOlderMessages: vi.fn(), sendMessage: vi.fn() }))
vi.mock('@/lib/messages/useMessagesRealtime', () => ({ useMessagesRealtime: vi.fn() }))

const message: Message = { id: '11111111-1111-4111-8111-111111111111', matter_id: 'matter', sender_role: 'attorney', sender_id: 'attorney', body: 'Previously saved reply', created_at: '2026-09-11T12:00:00Z', read_at: null }
beforeEach(() => {
  vi.resetAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(acknowledgeMessages).mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('restores a failed-send draft and allows one successful retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(sendMessage).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...message, sender_role: 'client', sender_id: 'client', body: 'Please review this question' })
  render(<MessageThread matterId="matter" clientUserId="client" messages={[]} />)
  const composer = screen.getByPlaceholderText('Write a message…') as HTMLTextAreaElement
  fireEvent.change(composer, { target: { value: 'Please review this question' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })) })
  expect(screen.getByRole('alert').textContent).toContain('Message not sent')
  expect(composer.value).toBe('Please review this question')
  expect(screen.getByText(/No messages yet/)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(composer.value).toBe('')
  expect(screen.getAllByText('Please review this question')).toHaveLength(1)
  expect(sendMessage).toHaveBeenCalledTimes(2)
})

it('keeps current history and draft when loading older messages fails, then retries the same cursor', async () => {
  const cursor = { id: message.id, createdAt: message.created_at }
  vi.mocked(loadOlderMessages).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ messages: [{ ...message, id: 'older', body: 'Older reply', created_at: '2026-09-10T12:00:00Z', read_at: '2026-09-10T12:01:00Z' }], older: null })
  render(<MessageThread matterId="matter" clientUserId="client" messages={[{ ...message, read_at: message.created_at }]} older={cursor} />)
  const composer = screen.getByPlaceholderText('Write a message…') as HTMLTextAreaElement
  fireEvent.change(composer, { target: { value: 'Unsent question' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load older messages' })) })
  expect(screen.getByRole('alert').textContent).toContain('Older messages could not be loaded')
  expect(screen.getByText(message.body)).toBeTruthy()
  expect(composer.value).toBe('Unsent question')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load older messages' })) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('Older reply')).toBeTruthy()
  expect(screen.getByText(message.body)).toBeTruthy()
  expect(composer.value).toBe('Unsent question')
  expect(loadOlderMessages).toHaveBeenNthCalledWith(1, 'matter', cursor)
  expect(loadOlderMessages).toHaveBeenNthCalledWith(2, 'matter', cursor)
})

it('shows a failed read acknowledgement and retries only displayed messages', async () => {
  vi.mocked(acknowledgeMessages).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined)
  render(<MessageThread matterId="matter" clientUserId="client" messages={[message]} older={{ id: message.id, createdAt: message.created_at }} />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Read status could not be saved'))
  expect(screen.getByText(message.body)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(acknowledgeMessages).toHaveBeenNthCalledWith(1, 'matter', [message.id])
  expect(acknowledgeMessages).toHaveBeenNthCalledWith(2, 'matter', [message.id])
  expect(loadOlderMessages).not.toHaveBeenCalled()
})
