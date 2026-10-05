// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealOnNarrowScreen } from '@/lib/revealOnNarrowScreen'

describe('revealOnNarrowScreen', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does nothing, and does not throw, without matchMedia (jsdom)', () => {
    vi.stubGlobal('matchMedia', undefined)
    const target = vi.fn()
    expect(() => revealOnNarrowScreen(target)).not.toThrow()
    expect(target).not.toHaveBeenCalled()
  })

  it('scrolls the detail into view on a narrow screen only', () => {
    const scrollIntoView = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    revealOnNarrowScreen(() => ({ scrollIntoView }) as unknown as Element)
    expect(scrollIntoView).toHaveBeenCalledOnce()

    scrollIntoView.mockClear()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    revealOnNarrowScreen(() => ({ scrollIntoView }) as unknown as Element)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
