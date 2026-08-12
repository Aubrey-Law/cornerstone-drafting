// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RichTextEmailEditor } from '@/components/admin/RichTextEmailEditor'

afterEach(cleanup)

describe('RichTextEmailEditor links', () => {
  it('exposes underline, clear formatting, undo, and redo controls', async () => {
    const user = userEvent.setup()
    const execCommand = vi.fn()
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    render(<RichTextEmailEditor ariaLabel="Message" valueHtml="<p>Formatted</p>" onChange={vi.fn()} />)

    await user.click(screen.getByTitle('Underline (Cmd+U)'))
    await user.click(screen.getByTitle('Clear formatting'))
    await user.click(screen.getByTitle('Undo (Cmd+Z)'))
    await user.click(screen.getByTitle('Redo (Cmd+Shift+Z)'))

    expect(execCommand.mock.calls.map(call => call[0])).toEqual(['underline', 'removeFormat', 'undo', 'redo'])
  })

  it('populates and edits both fields when an existing link is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RichTextEmailEditor
        ariaLabel="Message"
        valueHtml='<p>Complete your <a href="https://old.example.com">intake form</a>.</p>'
        onChange={onChange}
      />,
    )

    const anchor = screen.getByRole('link', { name: 'intake form' })
    fireEvent.click(anchor)

    const textInput = screen.getByLabelText('Link text')
    const urlInput = screen.getByLabelText('Link URL')
    expect((textInput as HTMLInputElement).value).toBe('intake form')
    expect((urlInput as HTMLInputElement).value).toBe('https://old.example.com')

    await user.clear(textInput)
    await user.type(textInput, 'start your intake')
    await user.clear(urlInput)
    await user.type(urlInput, 'portal.example.com/intake')
    await user.click(screen.getByRole('button', { name: 'Save link' }))

    expect(anchor.textContent).toBe('start your intake')
    expect(anchor.getAttribute('href')).toBe('https://portal.example.com/intake')
    expect(onChange).toHaveBeenLastCalledWith(
      '<p>Complete your <a href="https://portal.example.com/intake" target="_blank" rel="noopener noreferrer">start your intake</a>.</p>',
    )
  })

  it('uses selected text when inserting a new link', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<RichTextEmailEditor ariaLabel="Message" valueHtml="<p>Open the portal</p>" onChange={onChange} />)

    const editor = screen.getByLabelText('Message')
    const textNode = editor.querySelector('p')?.firstChild
    expect(textNode).toBeTruthy()
    const range = document.createRange()
    range.setStart(textNode!, 9)
    range.setEnd(textNode!, 15)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    await user.click(screen.getByRole('button', { name: 'Insert or edit link' }))
    expect((screen.getByLabelText('Link text') as HTMLInputElement).value).toBe('portal')
    await user.type(screen.getByLabelText('Link URL'), 'https://example.com/portal')
    await user.click(screen.getByRole('button', { name: 'Insert link' }))

    expect(screen.getByRole('link', { name: 'portal' }).getAttribute('href')).toBe('https://example.com/portal')
    expect(onChange).toHaveBeenCalled()
  })

  it('removes an existing link without deleting its visible text', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RichTextEmailEditor
        ariaLabel="Message"
        valueHtml='<p>Open the <a href="https://example.com">client portal</a>.</p>'
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('link', { name: 'client portal' }))
    await user.click(screen.getByRole('button', { name: 'Remove link' }))

    expect(screen.queryByRole('link', { name: 'client portal' })).toBeNull()
    expect(screen.getByLabelText('Message').textContent).toContain('Open the client portal.')
    expect(onChange).toHaveBeenLastCalledWith('<p>Open the client portal.</p>')
  })
})

describe('RichTextEmailEditor message area', () => {
  it('grows with the message instead of capping it inside a nested scroll area', () => {
    render(<RichTextEmailEditor ariaLabel="Message" valueHtml="<p>A long note</p>" onChange={vi.fn()} />)

    const body = screen.getByLabelText('Message')
    // No max height and no inner scrollbar: a long message shows in full and the
    // surrounding pane is what scrolls.
    expect(body.className).not.toMatch(/max-h-/)
    expect(body.className).not.toContain('overflow-y-auto')
    expect(body.className).toContain('min-h-[9rem]')
  })

  it('takes a dragged height and hands it back on a double-click', () => {
    render(<RichTextEmailEditor ariaLabel="Message" valueHtml="<p>Note</p>" onChange={vi.fn()} />)

    const handle = screen.getByRole('separator', { name: 'Resize message area' })
    const body = screen.getByLabelText('Message')
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => true)
    handle.releasePointerCapture = vi.fn()
    body.getBoundingClientRect = () => ({ height: 200 }) as DOMRect

    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 520, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientY: 520, pointerId: 1 })

    expect(body.style.height).toBe('320px')
    // Once it has a height of its own, overflow is its own business again.
    expect(body.className).toContain('overflow-y-auto')

    fireEvent.doubleClick(handle)
    expect(body.style.height).toBe('')
  })

  it('never lets a drag collapse the body away entirely', () => {
    render(<RichTextEmailEditor ariaLabel="Message" valueHtml="<p>Note</p>" onChange={vi.fn()} />)

    const handle = screen.getByRole('separator', { name: 'Resize message area' })
    const body = screen.getByLabelText('Message')
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn(() => true)
    handle.releasePointerCapture = vi.fn()
    body.getBoundingClientRect = () => ({ height: 200 }) as DOMRect

    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 })

    expect(body.style.height).toBe('96px')
  })
})
