// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLightThemeToDocument, applyThemeToDocument } from '../lib/theme/apply-theme'

describe('theme transition suppression', () => {
  let frames: FrameRequestCallback[]
  beforeEach(() => {
    document.documentElement.className = 'light'
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
  })
  afterEach(() => {
    document.head.querySelectorAll('[data-theme-transition-guard]').forEach(node => node.remove())
    document.documentElement.removeAttribute('data-theme')
    vi.unstubAllGlobals()
  })

  it('suppresses transitions during a palette change and restores them after paint', () => {
    applyThemeToDocument('dark', 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
    const guard = document.head.querySelector('[data-theme-transition-guard]')
    expect(guard?.textContent).toContain('transition:none !important')
    frames.shift()!(0)
    expect(guard?.isConnected).toBe(true)
    frames.shift()!(16)
    expect(guard?.isConnected).toBe(false)
  })

  it('does not suppress interactions when the palette is already applied', () => {
    applyThemeToDocument('system', 'light')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(frames).toHaveLength(0)
    expect(document.head.querySelector('[data-theme-transition-guard]')).toBeNull()
  })

  it('forces client routes to light and cleans up guards from rapid changes', () => {
    applyThemeToDocument('system', 'dark')
    applyLightThemeToDocument()
    expect(document.documentElement.className).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    while (frames.length) frames.shift()!(0)
    expect(document.head.querySelector('[data-theme-transition-guard]')).toBeNull()
  })
})
