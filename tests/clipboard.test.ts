// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from '@/lib/clipboard'

function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

afterEach(() => {
  stubClipboard(undefined)
  Reflect.deleteProperty(globalThis, 'ClipboardItem')
  Reflect.deleteProperty(document, 'execCommand')
  vi.restoreAllMocks()
})

describe('copyToClipboard', () => {
  it('writes a ready string straight through', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    expect(await copyToClipboard('https://portal.test/intake')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://portal.test/intake')
  })

  it('hands a pending value to ClipboardItem so the click gesture survives the fetch', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ write, writeText })
    class FakeClipboardItem {
      constructor(public readonly items: Record<string, unknown>) {}
    }
    Object.defineProperty(globalThis, 'ClipboardItem', { value: FakeClipboardItem, configurable: true })

    const pending = Promise.resolve('https://portal.test/intake')
    expect(await copyToClipboard(pending)).toBe(true)
    // The promise reached the browser rather than being awaited first.
    expect(write).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
    const [[[item]]] = write.mock.calls as [[FakeClipboardItem[]]]
    await expect(item.items['text/plain']).resolves.toBeInstanceOf(Blob)
  })

  it('awaits the value and writes it when ClipboardItem is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    expect(await copyToClipboard(Promise.resolve('https://portal.test/intake'))).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://portal.test/intake')
  })

  it('falls back to execCommand when the async clipboard is refused', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })

    expect(await copyToClipboard('https://portal.test/intake')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    // The scratch textarea does not outlive the copy.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('reports failure rather than throwing when nothing can copy', async () => {
    stubClipboard(undefined)
    expect(await copyToClipboard('https://portal.test/intake')).toBe(false)
  })

  it('rethrows a rejected source so a failed lookup stays distinguishable', async () => {
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })

    await expect(copyToClipboard(Promise.reject(new Error('Lead not found'))))
      .rejects.toThrow('Lead not found')
  })
})
