// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 't' } } })) } } }))

import { AssistantContextPicker } from '@/app/admin/assistant/components/AssistantContextPicker'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * Every Assistant-page chat was general because nothing let the attorney say
 * which matter it was about. This control does: search the firm's records
 * the same way the assistant's find_matter tool does, pick one, and the chat
 * carries it.
 */
describe('pointing a chat at a matter', () => {
  it('shows the current context and lets the attorney search for a record', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      records: [
        { id: 'm1', type: 'matter', label: 'Chen Family Trust', matter_number: '00-000', client_name: 'Amy Chen', client_email: 'amy@example.com', url: '/admin/matters/m1' },
        { id: 'l1', type: 'lead', label: 'Bob Lee', matter_number: null, client_name: 'Bob Lee', client_email: null, url: '/admin/matters/l1' },
      ],
    }), { headers: { 'Content-Type': 'application/json' } }))
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<AssistantContextPicker context={{ type: 'general' }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /general/i }))
    await user.type(screen.getByPlaceholderText(/search clients/i), 'chen')

    await waitFor(() => expect(screen.getByText('Chen Family Trust')).toBeTruthy())
    expect(screen.getByText('Bob Lee')).toBeTruthy()
    await user.click(screen.getByText('Chen Family Trust'))

    expect(onChange).toHaveBeenCalledWith({ type: 'matter', id: 'm1', label: 'Chen Family Trust' })
  })

  it('names the matter a chat is on and offers to clear it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<AssistantContextPicker context={{ type: 'matter', id: 'm1', label: 'Chen Family Trust' }} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /Chen Family Trust/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Chen Family Trust/ }))
    await user.click(screen.getByRole('button', { name: /general chat/i }))

    expect(onChange).toHaveBeenCalledWith({ type: 'general' })
  })
})

describe('the picker can be opened by the page', () => {
  it('shows the dialog when told to open', () => {
    render(<AssistantContextPicker context={{ type: 'general' }} onChange={() => {}} open onOpenChange={() => {}} />)
    expect(screen.getByPlaceholderText(/search clients/i)).toBeTruthy()
  })
})
