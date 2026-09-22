import 'server-only'
import { getLawmaticsAccessToken } from '@/lib/lawmatics'
import { IntegrationError } from '@/lib/integrations/errors'
import type { IntegrationFailureKind } from '@/lib/integrations/types'
import { LawmaticsValidationError, parseLawmaticsValidation } from './validation'
import type { LawmaticsEventInput, LawmaticsProspectInput, LawmaticsRequestInit, LawmaticsResource } from './types'

const API_BASE = 'https://api.lawmatics.com'
const REQUEST_TIMEOUT_MS = 30_000

function failure(kind: IntegrationFailureKind, code: string, safeMessage: string, retryAfterMs: number | null = null) {
  return new IntegrationError({ provider: 'lawmatics', kind, code, safeMessage, retryAfterMs })
}

function retryAfter(value: string | null): number | null {
  if (!value) return null
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) ? delay : null
  }
  // Do not let Date.parse interpret negative seconds as a calendar date.
  if (!/^[A-Za-z]{3}, /.test(value)) return null
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function responseFailure(response: Response): IntegrationError {
  if (response.status === 429) {
    return failure('retryable', 'rate_limited', 'Lawmatics rate limit reached. Try again later.', retryAfter(response.headers.get('Retry-After')))
  }
  if (response.status >= 500) return failure('retryable', 'provider_unavailable', 'Lawmatics is temporarily unavailable.')
  switch (response.status) {
    case 401: return failure('attention', 'authentication_required', 'Reconnect Lawmatics to continue synchronization.')
    case 403: return failure('attention', 'permission_denied', 'The Lawmatics connection does not have permission for this operation.')
    case 404: return failure('attention', 'not_found', 'The Lawmatics record could not be found.')
    case 422: return failure('attention', 'validation_failed', 'Lawmatics rejected the supplied record fields.')
    default: return failure('attention', 'request_rejected', 'Lawmatics rejected the request.')
  }
}

const MAX_ERROR_BODY = 8_192

async function validationFailure(response: Response): Promise<LawmaticsValidationError> {
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY)
    const parsed = parseLawmaticsValidation(JSON.parse(text))
    return new LawmaticsValidationError(parsed.fields, parsed.details, parsed.customFieldIds)
  } catch {
    return new LawmaticsValidationError([], [])
  }
}

function invalidResponse(method: LawmaticsRequestInit['method']): IntegrationError {
  // A successful POST may have committed a new record despite an unusable response.
  if (method === 'POST') {
    return failure('attention', 'invalid_response', 'Lawmatics returned an invalid create response. Review the provider record before retrying.')
  }
  return failure('retryable', 'invalid_response', 'Lawmatics returned an invalid response.')
}

export async function lawmaticsRequest<T>(path: string, init: LawmaticsRequestInit): Promise<T> {
  if (!path.startsWith('/v1/')) throw failure('attention', 'invalid_request', 'The Lawmatics API path is invalid.')
  const cancelled = () => failure('retryable', 'timeout', 'The Lawmatics request timed out.')
  if (init.signal?.aborted) throw cancelled()

  let accessToken: string
  try {
    accessToken = await getLawmaticsAccessToken()
  } catch (error) {
    if (error instanceof Error && error.message === 'Lawmatics is not connected') {
      throw failure('attention', 'authentication_required', 'Reconnect Lawmatics to continue synchronization.')
    }
    throw failure('retryable', 'connection_unavailable', 'The Lawmatics connection could not be read.')
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  if (init.signal?.aborted) controller.abort()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    if (controller.signal.aborted) throw cancelled()
    const response = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    })
    if (controller.signal.aborted) throw cancelled()
    // Never log provider error bodies or attach unsafe transport causes. A 422
    // body is parsed only for the attribute names and messages it reports.
    if (response.status === 422) throw await validationFailure(response)
    if (!response.ok) throw responseFailure(response)
    if (response.status === 204) return undefined as T

    let json: unknown
    try {
      json = await response.json()
    } catch {
      if (controller.signal.aborted) throw failure('retryable', 'timeout', 'The Lawmatics request timed out.')
      throw invalidResponse(init.method)
    }
    if (controller.signal.aborted) throw cancelled()
    if (!json || typeof json !== 'object' || !('data' in json)) {
      throw invalidResponse(init.method)
    }
    return json.data as T
  } catch (error) {
    if (error instanceof IntegrationError) throw error
    if (controller.signal.aborted) throw failure('retryable', 'timeout', 'The Lawmatics request timed out.')
    throw failure('retryable', 'network_error', 'Lawmatics could not be reached.')
  } finally {
    clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abort)
  }
}

function resource<Type extends 'prospect' | 'event'>(data: unknown, type: Type): LawmaticsResource<Type> {
  if (!data || typeof data !== 'object' || !('id' in data) ||
    typeof data.id !== 'string' || !data.id.trim() || !('type' in data) || data.type !== type) {
    // The write may have succeeded. Require review before another create attempt.
    throw failure('attention', 'invalid_record', 'Lawmatics did not return a valid record identity. Review the provider record before retrying.')
  }
  return data as LawmaticsResource<Type>
}

export async function createLawmaticsProspect(input: LawmaticsProspectInput, signal?: AbortSignal): Promise<LawmaticsResource<'prospect'>> {
  const data = await lawmaticsRequest<unknown>('/v1/prospects', {
    method: 'POST', signal,
    body: { first_name: input.firstName, last_name: input.lastName, email: input.email, phone: input.phone },
  })
  return resource(data, 'prospect')
}

/** Creates a prospect from a fully built body (see buildLawmaticsProspectBody). */
export async function createLawmaticsProspectFromBody(body: Record<string, unknown>, signal?: AbortSignal): Promise<LawmaticsResource<'prospect'>> {
  return resource(await lawmaticsRequest<unknown>('/v1/prospects', { method: 'POST', body, signal }), 'prospect')
}

/** Overwrites the supplied fields on an existing prospect; omitted fields are left as they are. */
export async function updateLawmaticsProspect(id: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  await lawmaticsRequest<unknown>(`/v1/prospects/${encodeURIComponent(id)}`, { method: 'PUT', body, signal })
}

function eventBody(input: LawmaticsEventInput): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description,
    start_date: input.start,
    end_date: input.end,
    time_zone: input.timezone,
    eventable_type: 'Prospect',
    eventable_id: input.prospectId,
    event_type_id: input.eventTypeId,
    user_ids: input.userIds,
    location_id: input.locationId ?? null,
    all_day: false,
    send_invites: false,
    // Explicitly clear optional reminder settings on both create and update.
    reminder_type: null,
    reminder_delay_length: null,
  }
}

export async function createLawmaticsEvent(input: LawmaticsEventInput, signal?: AbortSignal): Promise<LawmaticsResource<'event'>> {
  return resource(await lawmaticsRequest<unknown>('/v1/events', { method: 'POST', body: eventBody(input), signal }), 'event')
}

export async function updateLawmaticsEvent(id: string, input: LawmaticsEventInput, signal?: AbortSignal): Promise<LawmaticsResource<'event'>> {
  return resource(await lawmaticsRequest<unknown>(`/v1/events/${encodeURIComponent(id)}`, { method: 'PUT', body: eventBody(input), signal }), 'event')
}

export async function cancelLawmaticsEvent(id: string, signal?: AbortSignal): Promise<void> {
  await lawmaticsRequest<unknown>(`/v1/events/${encodeURIComponent(id)}?notify_attendees=false`, { method: 'DELETE', signal })
}
