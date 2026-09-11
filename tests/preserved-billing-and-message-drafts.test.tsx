// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { CommunicationThread } from '@/components/comms/CommunicationThread'
import { LogPaymentDialog } from '@/components/billing/LogPaymentDialog'
import type { BillingLedgerRow } from '@/lib/billing/types'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('drafts across deferred sections', () => {
  it('preserves an unsent portal reply when the message tab unmounts', () => {
    function Matter() {
      const [open, setOpen] = useState(true), [draft, setDraft] = useState('')
      return <><button onClick={() => setOpen(value => !value)}>Switch tab</button>{open && <CommunicationThread items={[]} recordType="matter" recordLabel="Synthetic matter" recipientName="Client" smsConfigured={false} onSend={async () => false} draft={draft} onDraftChange={setDraft} />}</>
    }
    render(<Matter />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsent reply' } })
    fireEvent.click(screen.getByText('Switch tab'))
    fireEvent.click(screen.getByText('Switch tab'))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unsent reply')
  })
  it('keeps a payment amount entered while bounded charge choices load', async () => {
    let finish!: (value: unknown) => void
    const fetcher = vi.fn((_url: string, _options?: RequestInit) => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const row = { id: 'charge', clientName: 'Synthetic client', balance: 10000 } as BillingLedgerRow
    render(<LogPaymentDialog open onOpenChange={() => {}} rows={[row]} initialItemId="charge" saving={false} returnFocusRef={{ current: null }} onSave={async () => {}} searchAll />)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '25.00' } })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await act(async () => finish({ ok: true, json: async () => ({ rows: [row], total: 121, pageSize: 50 }) }))
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('25.00')
    expect(screen.getByText('121 matching open charges · page 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(String(fetcher.mock.calls[1][0])).toContain('page=2')
  })
})
