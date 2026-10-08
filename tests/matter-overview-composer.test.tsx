// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/dynamic', () => ({ default: () => function Email() { return <textarea aria-label="Email draft" /> } }))
import { MatterOverviewComposer } from '@/app/admin/matters/[id]/MatterOverviewComposer'

afterEach(cleanup)
function setup(overrides = {}) {
  const props = { matterId: 'm', clientName: 'Client', clientEmail: 'client@example.com', clientPhone: '555', smsEnabled: true, emailEnabled: true,
    noteText: 'Private note', onNoteChange: vi.fn(), noteSaving: false, onAddNote: vi.fn().mockResolvedValue(undefined),
    portalDraft: 'Portal draft', onPortalChange: vi.fn(), onSend: vi.fn().mockResolvedValue(true),
    smsRecipient: 'client' as const, onSmsRecipientChange: vi.fn(), onLogCall: vi.fn().mockResolvedValue(true), onEmailSent: vi.fn(), ...overrides }
  render(<MatterOverviewComposer {...props} />)
  return props
}
describe('Overview composer', () => {
  it('sends portal messages directly and clears only a successful draft', async () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Portal message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send portal message' }))
    await waitFor(() => expect(props.onPortalChange).toHaveBeenCalledWith(''))
    expect(props.onSend).toHaveBeenCalledWith('portal', 'Portal draft')
  })
  it('retains a failed text and keeps drafts across mode changes', async () => {
    const props = setup({ onSend: vi.fn().mockResolvedValue(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    fireEvent.change(screen.getByLabelText('Text message'), { target: { value: 'Text draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    expect((screen.getByLabelText('Text message') as HTMLTextAreaElement).value).toBe('Text draft')
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }))
    await screen.findByRole('alert')
    expect(props.onSend).toHaveBeenCalledWith('sms', 'Text draft')
    expect((screen.getByLabelText('Text message') as HTMLTextAreaElement).value).toBe('Text draft')
  })
  it('logs calls without sending a message or changing the internal note', async () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Log call' }))
    fireEvent.change(screen.getByLabelText('Call outcome'), { target: { value: 'Left voicemail' } })
    fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: 'Asked for callback' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save call' })))
    expect(props.onLogCall).toHaveBeenCalledWith('Left voicemail', 'Asked for callback')
    expect(props.onSend).not.toHaveBeenCalled()
    expect(props.onNoteChange).not.toHaveBeenCalled()
  })
  it('keeps email mounted when switching composer modes', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    fireEvent.change(screen.getByLabelText('Email draft'), { target: { value: 'Unsent email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    expect((screen.getByLabelText('Email draft') as HTMLTextAreaElement).value).toBe('Unsent email')
  })
  it('disables sending when SMS is unavailable', () => {
    setup({ smsEnabled: false })
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    fireEvent.change(screen.getByLabelText('Text message'), { target: { value: 'Hello' } })
    expect((screen.getByRole('button', { name: 'Send text' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
