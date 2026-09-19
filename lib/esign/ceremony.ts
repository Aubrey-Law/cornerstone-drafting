/**
 * What an attorney is shown, and agreed to, before a document is sent.
 *
 * Deliberately free of `server-only`: the dialog that shows this wording and the
 * service that stores it have to be reading the same string. A copy pasted into
 * a client component would let the two drift, and the drift would be invisible —
 * a row recording wording nobody was actually shown. That is the exact failure
 * "stored rather than referenced" exists to prevent, so the constant lives here
 * and both sides import it.
 *
 * Never backfill it. Revising the wording changes what future senders agree to,
 * not what past ones did.
 */
export const CEREMONY_ATTESTATION_TEXT = [
  'I confirm this document does not require a witnessed or notarized signing',
  'ceremony under Massachusetts law — it is not a will, trust, power of attorney,',
  'health care proxy or advance directive (G.L. c. 190B).',
].join(' ')

/**
 * How many signature blocks the generated page actually holds before the last
 * one runs off the bottom of a US Letter sheet.
 *
 * Measured against appendSignaturePage rather than reasoned about — it was
 * written as eight, and the page refuses at seven, so a seven-signer send
 * passed the service's own check and was then turned away by the page with a
 * message contradicting the one the service would have given.
 * tests/esign-ceremony-text.test.ts keeps the two in step.
 */
export const MAX_SIGNERS = 6
