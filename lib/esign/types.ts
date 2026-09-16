/**
 * Provider-agnostic e-signature interface. Keep every provider-specific
 * detail (endpoints, payloads, auth) inside the provider module so a
 * future switch is a new client file plus webhook parsing — nothing else.
 */

/** Providers Cornerstone can be configured to sign through. */
export type EsignProviderName = 'firma' | 'native'

export type EsignEnvelopeStatus = 'sent' | 'viewed' | 'partially_signed' | 'signed' | 'declined' | 'unknown'

/**
 * Durable evidence of a completed signing.
 *
 * Providers differ: some return one combined PDF, some return the signed
 * document and its audit certificate separately, some do both. Modelling this
 * as a list rather than a single URL is what keeps the signed agreement and
 * its certificate distinguishable in the matter document workspace instead of
 * collapsing into one opaque download.
 */
export type EsignArtifactKind = 'signed_pdf' | 'audit_certificate' | 'combined_evidence'

export interface EsignArtifact {
  kind: EsignArtifactKind
  /** Pre-signed and short-lived. Fetch it promptly; do not persist the URL. */
  url: string
  mimeType: 'application/pdf' | 'application/zip'
}

/**
 * Which optional operations a provider actually supports.
 *
 * The point is to disable an action in the UI rather than let someone click it
 * and get an error back — a cancel button that always fails is worse than no
 * cancel button.
 */
export interface EsignProviderCapabilities {
  resend: boolean
  cancel: boolean
  embeddedSigning: boolean
  separateAuditCertificate: boolean
}

export interface EsignEnvelopeState {
  status: EsignEnvelopeStatus
  signedAt: string | null
  /** Empty until the signing completes and the provider has generated evidence. */
  artifacts: EsignArtifact[]
  recipients?: Array<{
    email: string
    status: 'sent' | 'signed' | 'declined'
    signedAt: string | null
    declinedAt: string | null
  }>
}

/**
 * The one artifact to store as *the* signed engagement agreement.
 *
 * A combined signed-document-plus-certificate PDF is preferred when the
 * provider offers one, because that is the single file a court or carrier
 * would be shown.
 */
export function primaryEvidenceArtifact(
  artifacts: EsignArtifact[] | null | undefined,
): EsignArtifact | null {
  // Tolerates a missing list rather than throwing. A provider adapter that
  // returns no artifacts key at all means "no evidence yet", and the caller
  // already knows how to wait for that; crashing here would turn a routine
  // "come back shortly" into a 500 on the evidence path.
  if (!artifacts) return null
  return artifacts.find(a => a.kind === 'combined_evidence')
    ?? artifacts.find(a => a.kind === 'signed_pdf')
    ?? null
}

export interface EsignSigner {
  name: string
  email: string
}

export interface EsignDocumentRequestInput {
  /**
   * The engagement agreement this request is for.
   *
   * A vendor provider has no use for it — the envelope lives on their side and
   * they hand back their own id. A provider backed by this database is the
   * other way round: it has no external system to mint an id, and its rows
   * reference the agreement directly. esign_signing_sessions.agreement_id is a
   * foreign key to engagement_agreements(id), and the signing route reads the
   * agreement back by it, so a locally-stored request must be keyed by the
   * real agreement rather than by an id it invents.
   */
  agreementId: string
  name: string
  document: Buffer
  recipients: Array<{ key: string; name: string; email: string; order: number }>
  anchors: Array<{ marker: string; type: 'signature' | 'date'; recipientKey: string; required: boolean; dateSigningDefault?: boolean }>
  expirationHours: number
  customMessage: string
}

export interface EsignDocumentRequestResult {
  requestId: string
  recipients: Array<{ key: string; externalId: string; signingLink: string | null }>
}

export type EsignDocumentRequestStatus = 'created' | 'sent' | 'viewed' | 'partially_signed' | 'completed' | 'declined' | 'cancelled' | 'expired' | 'unknown'
export type EsignExternalRecipient = { key: string; externalId: string; signingLink: string | null }

/** Normalized authoritative state for one document request. */
export interface EsignDocumentRequestState {
  status: EsignDocumentRequestStatus
  recipients?: EsignExternalRecipient[]
  artifacts?: EsignArtifact[]
}

export interface EsignProvider {
  name: EsignProviderName
  readonly capabilities: EsignProviderCapabilities
  /**
   * Solo client → single-signer template. When `spouse` is provided, a
   * second signer is added and the two-signer (joint) template is used.
   * `signingLink` is always the primary signer's link (for in-app Sign now).
   *
   * This is the legacy template-based path. Providers that render and stamp
   * the document themselves have no template to address and should throw.
   */
  createEngagementEnvelope(
    input: { primary: EsignSigner; spouse?: EsignSigner },
  ): Promise<{ envelopeId: string; signingLink: string | null }>
  createDocumentRequest(input: EsignDocumentRequestInput): Promise<EsignDocumentRequestResult>
  sendDocumentRequest(requestId: string, customMessage: string): Promise<void>
  getDocumentRequestState(requestId: string): Promise<EsignDocumentRequestState>
  /** Re-notify specific unsigned recipients. Guarded by `capabilities.resend`. */
  resendDocumentRequest(input: {
    requestId: string
    recipientIds: string[]
    customMessage?: string
  }): Promise<void>
  /** Cancel an active request. Guarded by `capabilities.cancel`. */
  cancelDocumentRequest(requestId: string, reason: string): Promise<void>
  /** Best-effort: cancel a superseded envelope before re-sending. */
  cancelEnvelope(envelopeId: string): Promise<void>
  /** Authoritative state — webhooks are treated as hints and re-checked here. */
  getEnvelopeState(envelopeId: string): Promise<EsignEnvelopeState>
}
