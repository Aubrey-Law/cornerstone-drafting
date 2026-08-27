import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NotSignedInError, apiGet, postStyleSweep } from '../client'

/**
 * The startup probe hanging the whole pane is the bug these exist for.
 *
 * A stale token made the probe 401, the shared retry answered a 401 by opening
 * the Office sign-in dialog, and the pane then waited on a modal nobody had
 * asked for — showing "Checking your session…" until Word was restarted.
 */

const STORAGE_KEY = 'cornerstone.addin.session.v1'
const displayDialogAsync = vi.fn()

/**
 * The add-in's suite runs in node — it has no DOM dependencies and adding jsdom
 * for one Map would be a poor trade. This is the whole surface `session.ts`
 * touches.
 */
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

function storeToken() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ accessToken: 'stale', refreshToken: null, expiresAt: null, email: null }),
  )
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    json: async () => body,
  } as Response
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  displayDialogAsync.mockReset()
  vi.stubGlobal('Office', {
    context: { ui: { displayDialogAsync } },
    AsyncResultStatus: { Succeeded: 'succeeded' },
    EventType: { DialogMessageReceived: 'msg', DialogEventReceived: 'evt' },
  })
  vi.stubGlobal('window', { location: { origin: 'https://localhost:3100' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the session probe', () => {
  it('reports a rejected token without opening a dialog', async () => {
    storeToken()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' })))

    await expect(apiGet('/api/addin/session')).rejects.toMatchObject({ status: 401 })

    // The whole point: a background probe must never put a modal on screen.
    expect(displayDialogAsync).not.toHaveBeenCalled()
  })

  it('reports no stored session distinctly, and never retries it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGet('/api/addin/session')).rejects.toBeInstanceOf(NotSignedInError)

    // No token means nothing to refresh — not worth a request or a dialog.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(displayDialogAsync).not.toHaveBeenCalled()
  })

  it('passes a deadline signal on every request', async () => {
    storeToken()
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    await apiGet('/api/addin/session')

    // Without a signal there is no ceiling, and a stalled dev server parks the
    // pane indefinitely with nothing on screen to explain it.
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns a timed-out request into an error that names the cause', async () => {
    storeToken()
    // What AbortSignal.timeout throws when it fires. Faking the timer itself is
    // testing Node; the mapping is what this file owns.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      }),
    )

    await expect(apiGet('/api/addin/session')).rejects.toMatchObject({
      status: 504,
      message: expect.stringContaining('https://localhost:3100'),
    })
  })

  it('returns the payload when the token is good', async () => {
    storeToken()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { userId: 'u1', role: 'attorney' })))

    await expect(apiGet('/api/addin/session')).resolves.toEqual({ userId: 'u1', role: 'attorney' })
  })
})

describe('a call the attorney is waiting on', () => {
  it('does re-authenticate once on a 401', async () => {
    storeToken()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, { noOp: true, changedParts: [] }))
    vi.stubGlobal('fetch', fetchMock)

    // Resolve the dialog immediately with a fresh token.
    displayDialogAsync.mockImplementation((_url: string, _opts: unknown, cb: Function) => {
      cb({
        status: 'succeeded',
        value: {
          addEventHandler: (type: string, handler: Function) => {
            if (type === 'msg') {
              setTimeout(
                () =>
                  handler({
                    message: JSON.stringify({
                      type: 'cornerstone-addin-session',
                      accessToken: 'fresh',
                    }),
                  }),
                0,
              )
            }
          },
          close: () => {},
        },
      })
    })

    await expect(postStyleSweep('ZmFrZQ==')).resolves.toEqual({ noOp: true, changedParts: [] })
    expect(displayDialogAsync).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces a non-auth failure without a dialog', async () => {
    storeToken()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'boom' })))

    await expect(postStyleSweep('ZmFrZQ==')).rejects.toBeInstanceOf(ApiError)
    expect(displayDialogAsync).not.toHaveBeenCalled()
  })
})
