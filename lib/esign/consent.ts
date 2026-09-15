import { createHash } from 'node:crypto'

/**
 * The ESIGN/UETA disclosure a signer accepts.
 *
 * One exported constant, used by both the page that displays it and the route
 * that records its hash. If the two could drift, the stored hash would attest
 * to wording nobody was shown — which is precisely the claim the hash exists
 * to support.
 *
 * Revising this is not a cosmetic change: agreements signed before the edit
 * carry the old hash, which is correct and must stay that way. Never
 * back-fill.
 */
export const ESIGN_CONSENT_TEXT = [
  'I agree to sign this document electronically. I understand that my electronic',
  'signature has the same legal effect as a handwritten one, and that this',
  'agreement is being entered into with Aubrey Law.',
  '',
  'I confirm that I am able to access this document in PDF form and that I can',
  'download or print a copy for my records. I may request a paper copy at no',
  'charge, and I may withdraw my consent to sign electronically at any time',
  'before completing my signature, by contacting the firm.',
].join('\n')

export function consentTextSha256(text: string = ESIGN_CONSENT_TEXT): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
