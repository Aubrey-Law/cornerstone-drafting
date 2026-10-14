import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedRead, invalidateWorkGraphCache } from '@/lib/work/requestCache'

describe('work graph request cache', () => {
  afterEach(() => {
    invalidateWorkGraphCache()
  })

  it('reuses one successful read until the window ends', async () => {
    const load = vi.fn(async () => 'graph')
    await expect(cachedRead('user:default', 20_000, load, 1_000)).resolves.toBe('graph')
    await expect(cachedRead('user:default', 20_000, load, 1_500)).resolves.toBe('graph')
    expect(load).toHaveBeenCalledOnce()

    await expect(cachedRead('user:default', 20_000, load, 21_000)).resolves.toBe('graph')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight read across callers', async () => {
    let resolve: (value: string) => void = () => {}
    const load = vi.fn(() => new Promise<string>(done => { resolve = done }))
    const first = cachedRead('user:default', 20_000, load, 1_000)
    const second = cachedRead('user:default', 20_000, load, 1_000)
    expect(load).toHaveBeenCalledOnce()
    resolve('graph')
    await expect(Promise.all([first, second])).resolves.toEqual(['graph', 'graph'])
  })

  it('does not keep a failed read', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('graph')
    await expect(cachedRead('user:default', 20_000, load, 1_000)).rejects.toThrow('down')
    await expect(cachedRead('user:default', 20_000, load, 1_100)).resolves.toBe('graph')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps a named horizon separate from the default window', async () => {
    const load = vi.fn(async () => 'graph')
    await cachedRead('user:default', 20_000, load, 1_000)
    await cachedRead('user:14', 20_000, load, 1_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('drops the cache when work changes', async () => {
    const load = vi.fn(async () => 'graph')
    await cachedRead('user:default', 20_000, load, 1_000)
    invalidateWorkGraphCache()
    await cachedRead('user:default', 20_000, load, 1_100)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
