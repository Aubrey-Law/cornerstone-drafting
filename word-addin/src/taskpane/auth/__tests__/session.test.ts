import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signIn } from '../session'

/**
 * `displayDialogAsync` succeeding only means the dialog opened. If it is then
 * blocked, or closed by something that fires no event, neither handler runs —
 * and an unbounded promise there takes down whatever awaited it.
 */

const displayDialogAsync = vi.fn()

function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

/** A dialog that opens and then does nothing at all. */
function silentDialog() {
  displayDialogAsync.mockImplementation((_url: string, _opts: unknown, cb: Function) => {
    cb({ status: 'succeeded', value: { addEventHandler: () => {}, close: vi.fn() } })
  })
}

beforeEach(() => {
  displayDialogAsync.mockReset()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', { location: { origin: 'https://localhost:3100' } })
  vi.stubGlobal('Office', {
    context: { ui: { displayDialogAsync } },
    AsyncResultStatus: { Succeeded: 'succeeded' },
    EventType: { DialogMessageReceived: 'msg', DialogEventReceived: 'evt' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('signIn', () => {
  it('rejects when the dialog never says anything', async () => {
    silentDialog()
    vi.useFakeTimers()

    const pending = signIn()
    // Assert rejection before advancing, or the rejection is unhandled.
    const assertion = expect(pending).rejects.toThrow(/did not respond/i)
    await vi.advanceTimersByTimeAsync(181_000)
    await assertion
  })

  it('resolves and stores the session when the dialog hands one back', async () => {
    const close = vi.fn()
    displayDialogAsync.mockImplementation((_url: string, _opts: unknown, cb: Function) => {
      cb({
        status: 'succeeded',
        value: {
          addEventHandler: (type: string, handler: Function) => {
            if (type === 'msg') {
              handler({
                message: JSON.stringify({
                  type: 'cornerstone-addin-session',
                  accessToken: 'fresh',
                  email: 'scott@aubreylegal.com',
                }),
              })
            }
          },
          close,
        },
      })
    })

    await expect(signIn()).resolves.toMatchObject({ accessToken: 'fresh' })
    expect(close).toHaveBeenCalled()
    expect(localStorage.getItem('cornerstone.addin.session.v1')).toContain('fresh')
  })

  it('ignores a close event that arrives after a successful hand-off', async () => {
    const handlers: Record<string, Function> = {}
    displayDialogAsync.mockImplementation((_url: string, _opts: unknown, cb: Function) => {
      cb({
        status: 'succeeded',
        value: {
          addEventHandler: (type: string, handler: Function) => void (handlers[type] = handler),
          close: vi.fn(),
        },
      })
    })

    const pending = signIn()
    handlers.msg({
      message: JSON.stringify({ type: 'cornerstone-addin-session', accessToken: 'fresh' }),
    })
    // Word fires this as the dialog tears down; it must not reject a promise
    // that already resolved.
    handlers.evt({})

    await expect(pending).resolves.toMatchObject({ accessToken: 'fresh' })
  })
})
