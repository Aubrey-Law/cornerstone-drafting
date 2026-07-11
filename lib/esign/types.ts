/**
 * Provider-agnostic e-signature interface. Keep every provider-specific
 * detail (endpoints, payloads, auth) inside the provider module so a
 * future switch is a new client file plus webhook parsing — nothing else.
 */

export type EsignEnvelopeStatus = 'sent' | 'signed' | 'declined' | 'unknown'

export interface EsignEnvelopeState {
  status: EsignEnvelopeStatus
  signedAt: string | null
  /** Combined signed document + audit certificate PDF (pre-signed, short-lived). */
  finalDocumentUrl: string | null
}

export interface EsignSigner {
  name: string
  email: string
}

export interface EsignProvider {
  name: string
  /**
   * Solo client → single-signer template. When `spouse` is provided, a
   * second signer is added and the two-signer (joint) template is used.
   * `signingLink` is always the primary signer's link (for in-app Sign now).
   */
  createEngagementEnvelope(
    input: { primary: EsignSigner; spouse?: EsignSigner },
  ): Promise<{ envelopeId: string; signingLink: string | null }>
  /** Best-effort: cancel a superseded envelope before re-sending. */
  cancelEnvelope(envelopeId: string): Promise<void>
  /** Authoritative state — webhooks are treated as hints and re-checked here. */
  getEnvelopeState(envelopeId: string): Promise<EsignEnvelopeState>
}
