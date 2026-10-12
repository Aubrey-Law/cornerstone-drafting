// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatterLogCallDialog, MatterTextDialog } from '@/app/admin/matters/[id]/MatterCommDialogs'
import { MatterOverviewComposer } from '@/app/admin/matters/[id]/MatterOverviewComposer'

afterEach(cleanup)
function setup(overrides = {}) {
  const props = {
    clientName: 'Client',
    noteText: 'Private note',
    onNoteChange: vi.fn(),
    noteSaving: false,
    onAddNote: vi.fn().mockResolvedValue(undefined),
    portalDraft: 'Portal draft',
    onPortalChange: vi.fn(),
    onSend: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  render(<MatterOverviewComposer {...props} />)
  return props
}
describe('Overview composer', () => {
  it('keeps Note and Portal message, and leaves text and calls to the header', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Note' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Portal message' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Email' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log call' })).toBeNull()
  })

  it('sends portal messages directly and clears only a successful draft', async () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Portal message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send portal message' }))
    await waitFor(() => expect(props.onPortalChange).toHaveBeenCalledWith(''))
    expect(props.onSend).toHaveBeenCalledWith('portal', 'Portal draft')
  })
})

describe('header communication dialogs', () => {
  it('retains a failed text', async () => {
    const onSend = vi.fn().mockResolvedValue(false)
    render(
      <MatterTextDialog
        open
        onOpenChange={vi.fn()}
        clientName="Client"
        clientPhone="555"
        smsEnabled
        smsRecipient="client"
        onSmsRecipientChange={vi.fn()}
        onSend={onSend}
      />,
    )
    fireEvent.change(screen.getByLabelText('Text message'), { target: { value: 'Text draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }))
    await screen.findByRole('alert')
    expect(onSend).toHaveBeenCalledWith('sms', 'Text draft')
    expect((screen.getByLabelText('Text message') as HTMLTextAreaElement).value).toBe('Text draft')
  })

  it('logs calls without sending a message', async () => {
    const onLogCall = vi.fn().mockResolvedValue(true)
    render(<MatterLogCallDialog open onOpenChange={vi.fn()} onLogCall={onLogCall} />)
    fireEvent.change(screen.getByLabelText('Call outcome'), { target: { value: 'Left voicemail' } })
    fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: 'Asked for callback' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save call' })))
    expect(onLogCall).toHaveBeenCalledWith('Left voicemail', 'Asked for callback')
  })

  it('disables sending when SMS is unavailable', () => {
    render(
      <MatterTextDialog
        open
        onOpenChange={vi.fn()}
        clientName="Client"
        clientPhone="555"
        smsEnabled={false}
        smsRecipient="client"
        onSmsRecipientChange={vi.fn()}
        onSend={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Text message'), { target: { value: 'Hello' } })
    expect((screen.getByRole('button', { name: 'Send text' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
