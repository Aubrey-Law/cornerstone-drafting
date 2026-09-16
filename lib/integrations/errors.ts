import type {
  IntegrationFailure,
  IntegrationFailureKind,
  IntegrationProvider,
} from './types'

export class IntegrationError extends Error {
  readonly provider: IntegrationProvider
  readonly kind: IntegrationFailureKind
  readonly code: string
  readonly safeMessage: string
  readonly retryAfterMs: number | null

  constructor(failure: IntegrationFailure, options?: ErrorOptions) {
    super(failure.safeMessage, options)
    this.name = 'IntegrationError'
    this.provider = failure.provider
    this.kind = failure.kind
    this.code = failure.code
    this.safeMessage = failure.safeMessage
    this.retryAfterMs = failure.retryAfterMs
  }
}

export function safeIntegrationError(error: IntegrationError) {
  return {
    provider: error.provider,
    kind: error.kind,
    code: error.code,
    message: error.safeMessage,
    retryAfterMs: error.retryAfterMs,
  }
}
