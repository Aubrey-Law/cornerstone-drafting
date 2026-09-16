import { describe, expect, it } from 'vitest'
import { IntegrationError, safeIntegrationError } from '@/lib/integrations/errors'

describe('integration errors', () => {
  it('exposes safe classification without leaking provider bodies', () => {
    const cause = {
      providerBody: 'PROVIDER_BODY_SENTINEL_client@example.com',
      accessToken: 'ACCESS_TOKEN_SENTINEL',
      requestSnapshot: 'REQUEST_SNAPSHOT_SENTINEL',
    }
    const error = new IntegrationError({
      provider: 'statular',
      kind: 'attention',
      code: 'validation_failed',
      safeMessage: 'Statular rejected the client fields.',
      retryAfterMs: null,
    }, { cause })

    expect(error.cause).toBe(cause)

    const safeError = safeIntegrationError(error)
    expect(safeError).toStrictEqual({
      provider: 'statular',
      kind: 'attention',
      code: 'validation_failed',
      message: 'Statular rejected the client fields.',
      retryAfterMs: null,
    })

    const serialized = JSON.stringify(safeError)
    for (const sensitiveValue of [
      'providerBody',
      'PROVIDER_BODY_SENTINEL_client@example.com',
      'accessToken',
      'ACCESS_TOKEN_SENTINEL',
      'requestSnapshot',
      'REQUEST_SNAPSHOT_SENTINEL',
    ]) {
      expect(serialized).not.toContain(sensitiveValue)
    }
  })
})
