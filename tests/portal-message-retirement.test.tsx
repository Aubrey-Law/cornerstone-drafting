// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CommunicationThread } from '@/components/comms/CommunicationThread'
afterEach(cleanup)
it('replies through the secure portal even when the latest historical message was SMS', async () => {
  const onSend = vi.fn().mockResolvedValue(true)
  render(<CommunicationThread items={[{ id: 'old', channel: 'sms', direction: 'inbound', body: 'Historic text', created_at: '2026-01-01T12:00:00Z' }]} recordType="matter" recordLabel="Test matter" recipientName="Test client" smsConfigured onSend={onSend} />)
  expect(screen.getByText('Historic text')).toBeTruthy()
  await userEvent.type(screen.getByRole('textbox'), 'Secure reply')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(onSend).toHaveBeenCalledWith('portal', 'Secure reply')
})
