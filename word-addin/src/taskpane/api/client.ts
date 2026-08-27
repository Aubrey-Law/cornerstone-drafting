import { clearSession, loadSession, signIn } from '../auth/session'

/**
 * Every call is same-origin: the dev server proxies `/api` through to
 * Cornerstone, and in production the pane is served by the Next app. That is
 * deliberate — Word's WebView blocks mixed content, so an HTTPS pane cannot
 * reach a plain-HTTP backend, and going same-origin removes the need for any
 * CORS handling on the Cornerstone side.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = loadSession()
  if (!session) throw new ApiError('Not signed in', 401)
  return { Authorization: `Bearer ${session.accessToken}` }
}

async function describeFailure(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    /* fall through to the status text */
  }
  return res.statusText || `Request failed (${res.status})`
}

/**
 * A 401 means the access token expired. Re-open the sign-in dialog once and
 * retry; a second 401 is a real failure worth surfacing.
 */
async function withAuthRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err
    clearSession()
    await signIn()
    return call()
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return withAuthRetry(async () => {
    const res = await fetch(path, {
      headers: await authHeaders(),
      cache: 'no-store',
    })
    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    return (await res.json()) as T
  })
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface StreamChatArgs {
  messages: ChatTurn[]
  documentText: string
  documentName: string | null
  signal?: AbortSignal
  onDelta: (text: string) => void
}

/**
 * Stream one chat turn.
 *
 * Resolves with the complete reply. The caller parses the `<EDITS>` block from
 * that, never from the deltas — a truncated `original` would still find a match
 * in the document, at the wrong boundary.
 */
export async function streamChat(args: StreamChatArgs): Promise<string> {
  return withAuthRetry(async () => {
    const res = await fetch('/api/addin/chat', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: args.messages,
        documentText: args.documentText,
        documentName: args.documentName,
      }),
      signal: args.signal,
    })

    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    if (!res.body) throw new ApiError('The server returned an empty stream.', 502)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reply = ''
    let sawDone = false

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line; the last chunk may be partial.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const line = frame.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue

        let payload: { delta?: string; done?: boolean; reply?: string; error?: string }
        try {
          payload = JSON.parse(line.slice(6))
        } catch {
          continue
        }

        if (payload.error) throw new ApiError(payload.error, 500)
        if (typeof payload.delta === 'string') {
          reply += payload.delta
          args.onDelta(payload.delta)
        }
        if (payload.done) {
          sawDone = true
          // The terminal frame carries the authoritative reply; deltas can be
          // dropped by an intermediary, and a partial reply must not be parsed
          // for edits.
          if (typeof payload.reply === 'string') reply = payload.reply
        }
      }
    }

    if (!sawDone) {
      throw new ApiError('The connection dropped before the reply finished.', 502)
    }
    return reply
  })
}

export interface StyleSweepResponse {
  noOp: boolean
  changedParts: string[]
  fileBase64?: string
}

/** Send the open document up for the firm style sweep and get the bytes back. */
export async function postStyleSweep(fileBase64: string): Promise<StyleSweepResponse> {
  return withAuthRetry(async () => {
    const res = await fetch('/api/addin/style-set/apply', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64 }),
    })
    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    return (await res.json()) as StyleSweepResponse
  })
}
