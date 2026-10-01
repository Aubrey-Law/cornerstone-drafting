export type LifecycleFactOrigin =
  | 'record'
  | 'client_submission'
  | 'attorney_entry'
  | 'document_extraction'
  | 'communication_extraction'

export interface LifecycleFactEvidence<T = unknown> {
  key: string
  value: T
  origin: LifecycleFactOrigin
  status: 'suggested' | 'confirmed'
  confirmedBy?: string
  confirmedAt?: string
}

/** Extraction can populate a review proposal, never a confirmed legal fact. */
export function extractedFactSuggestion<T>(input: {
  key: string
  value: T
  origin: 'document_extraction' | 'communication_extraction'
}): LifecycleFactEvidence<T> {
  return { ...input, status: 'suggested' }
}

/** The caller must be an explicit user-confirmation action. */
export function confirmFactSuggestion<T>(
  suggestion: LifecycleFactEvidence<T>,
  actorId: string,
  confirmedAt = new Date().toISOString(),
): LifecycleFactEvidence<T> {
  if (suggestion.status !== 'suggested') throw new Error('Only a suggested fact can be confirmed')
  if (!actorId.trim()) throw new Error('A confirming actor is required')
  return { ...suggestion, status: 'confirmed', confirmedBy: actorId, confirmedAt }
}

export function factCanSatisfyRequirement(evidence: LifecycleFactEvidence): boolean {
  return evidence.status === 'confirmed'
}
