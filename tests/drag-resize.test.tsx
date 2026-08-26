// @vitest-environment jsdom

import React, { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DragResizeHandle, ResizableTextarea, useDragResize } from '@/components/ui/drag-resize'

afterEach(cleanup)

/** A field plus its grabber, standing in for any composer that uses the hook. */
function Harness({ edge, minHeight }: { edge?: 'top' | 'bottom'; minHeight?: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const resize = useDragResize(ref, { edge, minHeight })
  return (
    <div>
      <div ref={ref} aria-label="Body" style={resize.height === null ? undefined : { height: resize.height }} />
      <DragResizeHandle controls={resize} label="Resize body" edge={edge} />
    </div>
  )
}

/** jsdom does no layout, so both the capture API and the height are ours to fake. */
function grabbable(handle: HTMLElement, body: HTMLElement, height = 200) {
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()
  body.getBoundingClientRect = () => ({ height }) as DOMRect
}

describe('useDragResize', () => {
  it('leaves the area sizing itself until the first drag', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Body').style.height).toBe('')
  })

  it('grows the area as the bottom edge is dragged down, and resets on double-click', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize body' })
    const body = screen.getByLabelText('Body')
    grabbable(handle, body)

    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 520, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientY: 520, pointerId: 1 })
    expect(body.style.height).toBe('320px')

    fireEvent.doubleClick(handle)
    expect(body.style.height).toBe('')
  })

  it('grows a bottom-anchored composer as its top edge is dragged up', () => {
    render(<Harness edge="top" />)
    const handle = screen.getByRole('separator', { name: 'Resize body' })
    const body = screen.getByLabelText('Body')
    grabbable(handle, body)

    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 })
    expect(body.style.height).toBe('300px')
  })

  it('ignores moves that did not start with a grab', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize body' })
    const body = screen.getByLabelText('Body')
    grabbable(handle, body)

    fireEvent.pointerMove(handle, { clientY: 900, pointerId: 1 })
    expect(body.style.height).toBe('')
  })

  it('never lets a drag collapse the area away entirely', () => {
    render(<Harness minHeight={96} />)
    const handle = screen.getByRole('separator', { name: 'Resize body' })
    const body = screen.getByLabelText('Body')
    grabbable(handle, body)

    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 })
    expect(body.style.height).toBe('96px')
  })

  it('resizes from the keyboard, and hands the height back on Home', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize body' })
    const body = screen.getByLabelText('Body')
    grabbable(handle, body)

    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(body.style.height).toBe('232px')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(body.style.height).toBe('200px')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(body.style.height).toBe('')
  })
})

describe('ResizableTextarea', () => {
  it('takes a dragged height over its own min-height class', () => {
    render(<ResizableTextarea aria-label="Text message" handleLabel="Resize text message" className="min-h-40" />)

    const handle = screen.getByRole('separator', { name: 'Resize text message' })
    const field = screen.getByLabelText('Text message')
    grabbable(handle, field, 160)

    expect(field.style.height).toBe('')

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 340, pointerId: 1 })

    expect(field.style.height).toBe('400px')
    // The class floor would otherwise pin the box at 10rem, so a drag could
    // only ever grow it.
    expect(field.style.minHeight).toBe('0px')
    expect(field.className).toContain('field-sizing-fixed')
  })

  it('freezes the grabber while the field is disabled', () => {
    render(<ResizableTextarea aria-label="Text message" handleLabel="Resize text message" disabled />)

    const handle = screen.getByRole('separator', { name: 'Resize text message' })
    const field = screen.getByLabelText('Text message')
    grabbable(handle, field)

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 })

    expect(field.style.height).toBe('')
  })
})
