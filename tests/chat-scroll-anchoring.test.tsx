// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useStickToBottom } from '@/hooks/useStickToBottom'

/**
 * Scrolling back during a long stream used to yank the reader to the bottom on
 * every delta, because each thread called scrollIntoView unconditionally.
 */
function Harness({ count, geometry }: { count: number; geometry: { scrollHeight: number; scrollTop: number; clientHeight: number } }) {
  const { containerRef, bottomRef, pinned, onScroll } = useStickToBottom<HTMLDivElement>([count])
  return (
    <div
      ref={element => {
        containerRef.current = element
        // jsdom gives every element zero geometry and read-only accessors.
        if (element) {
          for (const [key, value] of Object.entries(geometry)) {
            Object.defineProperty(element, key, { configurable: true, get: () => value })
          }
        }
      }}
      data-testid="thread"
      data-pinned={String(pinned)}
      onScroll={onScroll}
    >
      <div ref={bottomRef} />
    </div>
  )
}

afterEach(cleanup)

describe('a chat thread follows new messages only when the reader is at the bottom', () => {
  it('stays pinned while the reader is at the bottom', () => {
    const { getByTestId } = render(
      <Harness count={1} geometry={{ scrollHeight: 500, scrollTop: 400, clientHeight: 100 }} />,
    )
    const thread = getByTestId('thread')

    act(() => { thread.dispatchEvent(new Event('scroll', { bubbles: true })) })

    expect(thread.getAttribute('data-pinned')).toBe('true')
  })

  it('releases the pin once the reader scrolls up', () => {
    const { getByTestId } = render(
      <Harness count={1} geometry={{ scrollHeight: 500, scrollTop: 50, clientHeight: 100 }} />,
    )
    const thread = getByTestId('thread')

    act(() => { thread.dispatchEvent(new Event('scroll', { bubbles: true })) })

    expect(thread.getAttribute('data-pinned')).toBe('false')
  })
})
