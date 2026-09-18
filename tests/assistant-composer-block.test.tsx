// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AssistantComposer } from '@/app/admin/assistant/components/AssistantComposer'

afterEach(cleanup)

/**
 * A matter-scoped workflow attached to a general chat used to send anyway,
 * and the model then asked the attorney to retype the matter. The composer
 * now holds the message until a matter is picked.
 */
describe('the composer blocks a send the server would refuse', () => {
  it('disables Send and offers the fix while a matter-scoped workflow has no matter', async () => {
    const onPickMatter = vi.fn()
    render(
      <AssistantComposer
        value="Run it"
        onChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        streaming={false}
        workflow={{ id: 'wf', title: 'Matter Next Steps', matterScoped: true }}
        onWorkflowChange={() => {}}
        sendBlocked={{ reason: '“Matter Next Steps” works from a matter.', actionLabel: 'Pick a matter', onAction: onPickMatter }}
      />,
    )

    expect((screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/works from a matter/)).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: /pick a matter/i }))
    expect(onPickMatter).toHaveBeenCalled()
  })

  it('does not send on Enter while blocked', async () => {
    const onSend = vi.fn()
    render(
      <AssistantComposer
        value="Run it"
        onChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
        streaming={false}
        workflow={{ id: 'wf', title: 'Matter Next Steps', matterScoped: true }}
        onWorkflowChange={() => {}}
        sendBlocked={{ reason: 'Needs a matter.' }}
      />,
    )
    const box = screen.getByPlaceholderText(/ask anything/i)
    await userEvent.setup().type(box, '{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })
})
