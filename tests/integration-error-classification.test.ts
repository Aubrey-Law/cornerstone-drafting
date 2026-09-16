import { describe, expect, it } from 'vitest'
import { IntegrationError, safeIntegrationError } from '@/lib/integrations/errors'

describe('integration errors', () => {
  it('exposes safe classification without leaking provider bodies', () => {
    const error = new IntegrationError({
      provider: 'statular',
      kind: 'attention',
      code: 'validation_failed',
      safeMessage: 'Statular rejected the client fields.',
      retryAfterMs: null,
    })
    expect(safeIntegrationError(error)).toEqual({
      provider: 'statular',
      kind: 'attention',
      code: 'validation_failed',
      message: 'Statular rejected the client fields.',
      retryAfterMs: null,
    })
  })
})
