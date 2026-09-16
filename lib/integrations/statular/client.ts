import 'server-only'
import { z } from 'zod'
import { IntegrationError } from '@/lib/integrations/errors'
import type { IntegrationFailureKind } from '@/lib/integrations/types'
import { getStatularConfig } from './config'
import type { StatularClientPayload, StatularMatterPayload, StatularRecord } from './types'

const REQUEST_TIMEOUT_MS = 30_000
const nonblank = z.string().refine(value => value.trim().length > 0)
const id = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^\d+$/).refine(value => /[1-9]/.test(value)),
])
const gender = z.enum(['male', 'female', 'nonbinary'])
const address = z.object({
  streetAddress1: z.string().optional(), streetAddress2: z.string().optional(),
  city: z.string().optional(), county: z.string().optional(), state: z.string().optional(), zip: z.string().optional(),
}).strict()
const child = z.object({
  name: nonblank, relationship: z.enum(['joint', 'settlor1', 'settlor2']),
  gender: gender.optional(), birthdate: z.string().optional(), phone: z.string().optional(),
  email: z.string().email().optional(), address: address.optional(), deceased: z.boolean().optional(),
}).strict()
const clientSchema = z.object({
  first_name: nonblank, last_name: nonblank, middle_name: z.string().optional(),
  email: z.string().email().optional(), phone: z.string().optional(), dob: z.string().optional(),
  gender: gender.optional(), marital_status: z.string().optional(), address: address.optional(),
  partner: z.boolean().optional(), partner_first_name: z.string().optional(), partner_middle_name: z.string().optional(),
  partner_last_name: z.string().optional(), partner_email: z.string().email().optional(), partner_phone: z.string().optional(),
  partner_dob: z.string().optional(), partner_gender: gender.optional(), partner_address: address.optional(),
  children: z.array(child).optional(), notes: z.string().optional(),
}).strict()
const matterSchema = z.object({
  client_id: id, doc_id: id, state: z.string().regex(/^[A-Z]{2}$/).optional(),
  matter_name: z.string().optional(), drafter_id: id.optional(),
}).strict()

function failure(kind: IntegrationFailureKind, code: string, safeMessage: string, retryAfterMs: number | null = null) {
  return new IntegrationError({ provider: 'statular', kind, code, safeMessage, retryAfterMs })
}

function retryAfter(value: string | null): number | null {
  if (!value) return null
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) ? delay : null
  }
  if (!/^[A-Za-z]{3}, /.test(value)) return null
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function responseFailure(response: Response) {
  if (response.status === 429) return failure('retryable', 'rate_limited', 'Statular rate limit reached. Try again later.', retryAfter(response.headers.get('Retry-After')))
  if (response.status >= 500) return failure('retryable', 'provider_unavailable', 'Statular is temporarily unavailable.')
  switch (response.status) {
    case 401: return failure('attention', 'authentication_required', 'Replace the Statular webhook credentials to continue synchronization.')
    case 403: return failure('attention', 'permission_denied', 'Have an active Statular administrator replace the webhook credentials.')
    case 422: return failure('attention', 'validation_failed', 'Statular rejected the supplied record fields.')
    // Statular documents no response discriminator for its two 409 cases. The
    // durable external-record claim must reject same-key/different-hash requests
    // before this transport is called. Never infer that history in this process.
    case 409: return failure('retryable', 'idempotency_conflict', 'Statular has not completed this request. Try again shortly.', 2000)
    default: return failure('attention', 'request_rejected', 'Statular rejected the request.')
  }
}

function invalidResponse() {
  return failure('attention', 'invalid_response', 'Statular did not return a valid record identity. Review the provider record before retrying.')
}

async function createRecord(payload: StatularClientPayload | StatularMatterPayload, idempotencyKey: string, type: 'client' | 'matter', signal?: AbortSignal): Promise<StatularRecord> {
  const cancelled = () => failure('retryable', 'timeout', 'The Statular request timed out or was cancelled.')
  if (signal?.aborted) throw cancelled()
  const config = getStatularConfig()
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey)) {
    throw failure('attention', 'invalid_idempotency_key', 'The Statular idempotency key is invalid.')
  }
  const parsed = (type === 'client' ? clientSchema : matterSchema).safeParse(payload)
  if (!parsed.success) throw failure('attention', 'invalid_payload', 'The Statular payload contains invalid or unsupported fields.')

  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    if (controller.signal.aborted) throw cancelled()
    const response = await fetch(type === 'client' ? config.clientWebhookUrl : config.matterWebhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(parsed.data), signal: controller.signal, cache: 'no-store', redirect: 'error',
    })
    if (controller.signal.aborted) throw cancelled()
    // The URL is the credential; never read error bodies or retain fetch causes.
    if (!response.ok) throw responseFailure(response)
    if (response.status !== 201 && response.status !== 200) throw invalidResponse()
    let json: unknown
    try {
      json = await response.json()
    } catch {
      if (controller.signal.aborted) throw cancelled()
      throw invalidResponse()
    }
    if (controller.signal.aborted) throw cancelled()
    const record = z.object({ id }).safeParse(json)
    if (!record.success) throw invalidResponse()
    return { id: String(record.data.id) }
  } catch (error) {
    if (error instanceof IntegrationError) throw error
    if (controller.signal.aborted) throw cancelled()
    throw failure('retryable', 'network_error', 'Statular could not be reached.')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

/** Caller must durably claim the same frozen payload/hash for this key first. */
export function createStatularClient(payload: StatularClientPayload, idempotencyKey: string, signal?: AbortSignal): Promise<StatularRecord> {
  return createRecord(payload, idempotencyKey, 'client', signal)
}

/** Caller must durably claim the same frozen payload/hash for this key first. */
export function createStatularMatter(payload: StatularMatterPayload, idempotencyKey: string, signal?: AbortSignal): Promise<StatularRecord> {
  return createRecord(payload, idempotencyKey, 'matter', signal)
}
