export class ApiRequestError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.body = body
  }
}
type ApiErrorBody = {
  error?: unknown
  message?: unknown
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const { error, message } = body as ApiErrorBody
  if (typeof error === 'string' && error.trim()) return error
  if (typeof message === 'string' && message.trim()) return message
  return fallback
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json().catch(() => undefined)
  }
  const text = await response.text().catch(() => '')
  return text || undefined
}

/**
 * Fetch JSON consistently in client components.
 *
 * Authentication remains explicit: callers pass a bearer token when the route
 * requires one. This helper only standardizes parsing and API error handling.
 */
export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fallbackError = 'Request failed',
): Promise<T> {
  const response = await fetch(input, init)
  const body = await responseBody(response)
  if (!response.ok) {
    throw new ApiRequestError(errorMessage(body, fallbackError), response.status, body)
  }
  return body as T
}
