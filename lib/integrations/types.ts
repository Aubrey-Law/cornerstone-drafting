export type IntegrationProvider = 'lawmatics' | 'statular'

export type IntegrationFailureKind = 'retryable' | 'attention'

export type IntegrationStatus = 'pending' | 'synced' | 'attention' | 'disabled'

export interface IntegrationResult {
  provider: IntegrationProvider
  externalRecordType: 'prospect' | 'event' | 'client' | 'matter'
  externalId: string
  operation: 'created' | 'updated' | 'cancelled' | 'reused'
  metadata?: Record<string, string | number | boolean | null>
}

export interface IntegrationFailure {
  provider: IntegrationProvider
  kind: IntegrationFailureKind
  code: string
  safeMessage: string
  retryAfterMs: number | null
}
