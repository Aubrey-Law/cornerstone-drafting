// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CommunicationThread } from '@/components/comms/CommunicationThread'
import type { CommunicationItem } from '@/lib/comms/thread'

afterEach(cleanup)

const items: CommunicationItem[] = [
  { id: 'in', channel: 'sms', direction: 'inbound', body: 'From the client', created_at: '2026-09-10T12:00:00Z' },
  { id: 'out', channel: 'sms', direction: 'outbound', body: 'From the firm', created_at: '2026-09-10T13:00:00Z' },
]

function renderThread(props: Partial<Parameters<typeof CommunicationThread>[0]> = {}) {
  return render(
    <CommunicationThread
      items={items}
      recordType="matter"
      recordLabel="EP-1"
      recipientName="Jordan"
      recipientPhone="+16175550100"
      smsConfigured
      onSend={vi.fn(async () => true)}
      {...props}
    />,
  )
}

it('sets sent and received messages on opposite sides', () => {
  renderThread()
  const received = screen.getByText('From the client').closest('li')!
  const sent = screen.getByText('From the firm').closest('li')!
  expect(received.className).toContain('mr-6')
  expect(sent.className).toContain('ml-6')
})

it('names the Text filter in words, not the channel key', () => {
  renderThread({ items: [], channelFilter: 'sms' })
  expect(screen.getByText('No text messages yet.')).toBeTruthy()
})

it('drops the "Reply by text" line when texting is off and nothing can be sent', () => {
  renderThread({ channelFilter: 'sms', smsConfigured: false })
  expect(screen.getByText(/Texting is turned off/)).toBeTruthy()
  expect(screen.queryByText(/Reply by text/)).toBeNull()
})

it('keeps the reply line and the secure-portal note on the portal composer', () => {
  renderThread({ items: [], channelFilter: 'portal' })
  expect(screen.getByText('Reply by portal')).toBeTruthy()
  expect(screen.getByText('Secure client portal')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Send/ })).toBeTruthy()
})
