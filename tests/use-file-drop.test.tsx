// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useFileDrop } from '@/hooks/useFileDrop'

afterEach(cleanup)

function Harness({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: FileList) => void
  disabled?: boolean
}) {
  const { isDragging, dropProps } = useFileDrop(onFiles, disabled)
  return (
    <div data-testid="zone" {...dropProps}>
      <span data-testid="state">{isDragging ? 'dragging' : 'idle'}</span>
      <span data-testid="child">child</span>
    </div>
  )
}

/** Minimal DataTransfer stand-in — jsdom does not construct real ones. */
function transfer(types: string[], files: File[] = []) {
  return {
    types,
    files: Object.assign(files, { item: (i: number) => files[i] ?? null }) as unknown as FileList,
    dropEffect: 'none',
  }
}

const state = () => screen.getByTestId('state').textContent

describe('useFileDrop', () => {
  it('arms on a file drag and disarms on drop', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const zone = screen.getByTestId('zone')
    const file = new File(['x'], 'scan.pdf', { type: 'application/pdf' })

    fireEvent.dragEnter(zone, { dataTransfer: transfer(['Files']) })
    expect(state()).toBe('dragging')

    fireEvent.drop(zone, { dataTransfer: transfer(['Files'], [file]) })
    expect(state()).toBe('idle')
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0][0].name).toBe('scan.pdf')
  })

  it('ignores drags that carry no files, so dragging text does not arm it', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const zone = screen.getByTestId('zone')

    fireEvent.dragEnter(zone, { dataTransfer: transfer(['text/plain']) })
    expect(state()).toBe('idle')

    fireEvent.drop(zone, { dataTransfer: transfer(['text/plain']) })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('stays armed when the pointer crosses a child element', () => {
    render(<Harness onFiles={vi.fn()} />)
    const zone = screen.getByTestId('zone')
    const child = screen.getByTestId('child')

    fireEvent.dragEnter(zone, { dataTransfer: transfer(['Files']) })
    // Entering the child fires enter on it and leave on the parent. A naive
    // boolean would drop the highlight here.
    fireEvent.dragEnter(child, { dataTransfer: transfer(['Files']) })
    fireEvent.dragLeave(zone, { dataTransfer: transfer(['Files']) })
    expect(state()).toBe('dragging')

    fireEvent.dragLeave(child, { dataTransfer: transfer(['Files']) })
    expect(state()).toBe('idle')
  })

  it('does nothing while disabled', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} disabled />)
    const zone = screen.getByTestId('zone')
    const file = new File(['x'], 'scan.pdf', { type: 'application/pdf' })

    fireEvent.dragEnter(zone, { dataTransfer: transfer(['Files']) })
    expect(state()).toBe('idle')

    fireEvent.drop(zone, { dataTransfer: transfer(['Files'], [file]) })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('passes every dropped file through, not just the first', () => {
    const onFiles = vi.fn()
    render(<Harness onFiles={onFiles} />)
    const zone = screen.getByTestId('zone')
    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
      new File(['c'], 'c.pdf', { type: 'application/pdf' }),
    ]

    act(() => {
      fireEvent.drop(zone, { dataTransfer: transfer(['Files'], files) })
    })
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0]).toHaveLength(3)
  })
})
