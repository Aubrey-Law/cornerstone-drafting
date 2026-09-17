'use client'

import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

import { Textarea } from './textarea'
import { cn } from './utils'

/** Floor for a dragged height, in px — a drag can shrink an area but not erase it. */
export const MIN_DRAG_HEIGHT = 96

/** How far one arrow key nudges a dragged height, in px. */
const KEYBOARD_STEP = 32

export interface UseDragResizeOptions {
  /** Smallest height a drag may leave behind. Defaults to {@link MIN_DRAG_HEIGHT}. */
  minHeight?: number
  /** Freeze the handle (mirrors the disabled state of the field it resizes). */
  disabled?: boolean
  /**
   * Which edge the grabber sits on. A box pinned to the bottom of its pane — a
   * chat composer — grows upward, so dragging *up* has to make it taller;
   * everywhere else the grabber is on the bottom edge and down means taller.
   */
  edge?: 'top' | 'bottom'
}

export interface DragResize {
  /**
   * Height the operator dragged to, or null while the area still sizes itself.
   * Null is the resting state: the area grows with its content and whatever
   * pane it sits in does the scrolling.
   */
  height: number | null
  /** Hand the height back so the area sizes itself again. */
  reset: () => void
  /** Spread onto {@link DragResizeHandle} — pointer, keyboard and ARIA wiring. */
  handleProps: DragResizeHandleProps
}

interface DragResizeHandleProps {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  'aria-valuenow'?: number
  'aria-valuemin': number
}

/**
 * Drag-to-resize for a text area, a message body, or a whole composer pane.
 *
 * The element keeps sizing itself until the first drag: only then does it take
 * a height of its own. That way a long message shows in full — and the pane
 * around it scrolls — rather than every message living inside a nested scroll
 * area, while an operator who wants a taller (or shorter) box can still say so.
 */
export function useDragResize(
  targetRef: RefObject<HTMLElement | null>,
  { minHeight = MIN_DRAG_HEIGHT, disabled = false, edge = 'bottom' }: UseDragResizeOptions = {},
): DragResize {
  /** +1 when dragging down grows the box, -1 when dragging up does. */
  const direction = edge === 'top' ? -1 : 1
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  /** Height to measure a change against: the dragged one, else what's rendered. */
  function currentHeight(): number {
    return height ?? targetRef.current?.getBoundingClientRect().height ?? minHeight
  }

  return {
    height,
    reset: () => setHeight(null),
    handleProps: {
      // Pointer capture keeps the moves coming while the cursor is over the
      // text below the handle, and the floor stops a stray drag from
      // collapsing the area to nothing.
      onPointerDown(event) {
        if (disabled) return
        event.preventDefault()
        dragRef.current = { startY: event.clientY, startHeight: currentHeight() }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove(event) {
        const drag = dragRef.current
        if (!drag) return
        setHeight(Math.max(minHeight, drag.startHeight + direction * (event.clientY - drag.startY)))
      },
      onPointerUp(event) {
        if (!dragRef.current) return
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      },
      onPointerCancel(event) {
        if (!dragRef.current) return
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      },
      onDoubleClick() {
        if (disabled) return
        setHeight(null)
      },
      // Same reach without a pointer: arrows nudge, Home hands the height back.
      onKeyDown(event) {
        if (disabled) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const step = (event.key === 'ArrowDown' ? KEYBOARD_STEP : -KEYBOARD_STEP) * direction
          setHeight(Math.max(minHeight, currentHeight() + step))
        } else if (event.key === 'Home') {
          event.preventDefault()
          setHeight(null)
        }
      },
      'aria-valuenow': height ?? undefined,
      'aria-valuemin': minHeight,
    },
  }
}

/**
 * The grabber itself: a thin bar with a grip, sitting on the bottom edge of
 * whatever it resizes.
 */
export function DragResizeHandle({
  controls,
  label,
  disabled,
  edge = 'bottom',
  className,
}: {
  controls: DragResize
  /** Names the area being resized, e.g. "Resize message area". */
  label: string
  disabled?: boolean
  /** Which edge of the field it hugs — matches the hook's `edge` option. */
  edge?: 'top' | 'bottom'
  className?: string
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      tabIndex={disabled ? -1 : 0}
      {...controls.handleProps}
      className={cn(
        'flex h-3 shrink-0 cursor-ns-resize items-center justify-center bg-muted hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        edge === 'top' ? 'border-b border-border/60' : 'border-t border-border/60',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <span aria-hidden className="h-0.5 w-8 rounded-full bg-border" />
    </div>
  )
}

export interface ResizableTextareaProps extends React.ComponentProps<typeof Textarea> {
  /** Names the area being resized, e.g. "Resize text message". */
  handleLabel: string
  /** Smallest height a drag may leave behind. Defaults to {@link MIN_DRAG_HEIGHT}. */
  minDragHeight?: number
  /** Classes for the wrapper that holds the field and its handle. */
  containerClassName?: string
  /** Classes for the grabber, for fields whose own border it should match. */
  handleClassName?: string
  /** Which edge the grabber sits on. See {@link UseDragResizeOptions.edge}. */
  handleEdge?: 'top' | 'bottom'
}

/**
 * A {@link Textarea} an operator can drag taller. Until they do, it behaves
 * exactly as it did before — including growing with its content.
 */
export function ResizableTextarea({
  handleLabel,
  minDragHeight,
  containerClassName,
  handleClassName,
  handleEdge = 'bottom',
  className,
  disabled,
  style,
  ref,
  ...props
}: ResizableTextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)
  const resize = useDragResize(innerRef, {
    minHeight: minDragHeight,
    disabled: Boolean(disabled),
    edge: handleEdge,
  })

  const handle = (
    <DragResizeHandle
      controls={resize}
      label={handleLabel}
      disabled={disabled}
      edge={handleEdge}
      className={cn(
        'border-x border-input bg-muted',
        handleEdge === 'top' ? 'rounded-t-md border-t' : 'rounded-b-md border-b',
        handleClassName,
      )}
    />
  )

  return (
    <div className={cn('flex min-w-0 flex-col', containerClassName)}>
      {handleEdge === 'top' && handle}
      <Textarea
        {...props}
        disabled={disabled}
        ref={node => {
          innerRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        // A dragged height outranks the field's own sizing — including any
        // min-height class the caller set, so the box can shrink as well as grow.
        style={
          resize.height === null
            ? style
            : { ...style, height: resize.height, minHeight: 0, maxHeight: 'none' }
        }
        className={cn(
          handleEdge === 'top' ? 'rounded-t-none' : 'rounded-b-none',
          resize.height !== null && 'field-sizing-fixed resize-none overflow-y-auto',
          className,
        )}
      />
      {handleEdge === 'bottom' && handle}
    </div>
  )
}
