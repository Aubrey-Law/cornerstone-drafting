// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CommunicationThread } from '@/components/comms/CommunicationThread'
afterEach(cleanup)

const historicText = [{ id: 'old', channel: 'sms' as const, direction: 'inbound' as const, body: 'Historic text', created_at: '2026-01-01T12:00:00Z' }]

it('replies through the secure portal when texting is off, even after an inbound text', async () => {
  const onSend = vi.fn().mockResolvedValue(true)
  render(<CommunicationThread items={historicText} recordType="matter" recordLabel="Test matter" recipientName="Test client" recipientPhone="+15555550123" smsConfigured={false} onSend={onSend} />)
  expect(screen.getByText('Historic text')).toBeTruthy()
  await userEvent.type(screen.getByRole('textbox'), 'Secure reply')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(onSend).toHaveBeenCalledWith('portal', 'Secure reply')
})

it('answers a text by text when texting is on', async () => {
  const onSend = vi.fn().mockResolvedValue(true)
  render(<CommunicationThread items={historicText} recordType="matter" recordLabel="Test matter" recipientName="Test client" recipientPhone="+15555550123" smsConfigured onSend={onSend} />)
  await userEvent.type(screen.getByRole('textbox', { name: 'Reply by text' }), 'Text reply')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(onSend).toHaveBeenCalledWith('sms', 'Text reply')
})

it('never offers a text composer on the SMS filter while texting is off', () => {
  render(<CommunicationThread items={historicText} recordType="lead" recordLabel="Lead" recipientName="Test client" recipientPhone="+15555550123" smsConfigured={false} channelFilter="sms" onSend={vi.fn()} />)
  expect(screen.getByText(/Texting is turned off/)).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
})
