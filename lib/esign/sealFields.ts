import { engagementAnchorMarkers } from '@/lib/engagement/anchors'
import type { SealField } from '@/lib/esign/nativeSeal'

/**
 * Build the stamp list for an agreement from everyone who has signed it.
 *
 * The sealed document is rebuilt from the approved PDF on every signature, so
 * this has to describe *all* signers, not the one who just finished. The first
 * real two-party agreement was executed with only the last signer's marks on it:
 * each signature reloaded the original and overwrote the previous seal, leaving
 * `[[CLIENT_2_SIGNATURE]]` sitting unstamped on a document that claimed to be
 * executed. Rebuilding from the original every time is what keeps exactly one
 * audit certificate on the file; rebuilding it with everyone is what makes the
 * result correct regardless of the order people sign in.
 *
 * Pure, and deliberately so. The defect lived in a route that could only be
 * exercised against a real database, and every unit test of the provider mocks
 * that database away. This is the part worth asserting on directly.
 */

export interface SignedMark {
  /**
   * 1-based position in agreement order. Markers are numbered by position and
   * never by role — spouse is CLIENT_2 because they are second, not because
   * they are the spouse.
   */
  position: number
  signedAt: Date
  /** Drawn signature bytes, when the signer drew rather than typed. */
  signaturePng?: Buffer | null
  /** The adopted name, when the signer typed rather than drew. */
  typedName?: string | null
}

/**
 * The date as it is written onto the signature line.
 *
 * Each signer gets their own signing instant rather than the moment of the
 * latest signature: re-stamping an earlier signer with "now" would silently
 * move the date on a line they already signed.
 *
 * **The zone is a required argument because no sensible default exists.** A
 * `Date` is an instant; the day it falls on is a question you cannot answer
 * without a zone. This used to omit `timeZone` and so inherited whichever zone
 * the machine running the seal was set to — UTC on the deployed runtime, the
 * local zone on a developer's laptop. That is not a formatting detail: an
 * agreement signed at 9:43pm on the 15th in the firm's own zone would have been
 * stamped "September 16" for no reason except that the sealing process thinks
 * in UTC, and the date on the signature line of an executed legal document is a
 * term of the document. Caught while no agreement had yet been sealed through
 * this path, so it corrected a latent defect rather than an executed one.
 * Callers pass `getSchedulingSettings().timezone`, the same firm zone the
 * scheduler books against.
 *
 * Deliberately not defaulted and deliberately not read from settings here: a
 * default would let a new call site inherit the wrong zone in silence, and
 * reaching for settings would make this async and cost the module the purity
 * that lets the behaviour be asserted directly. An unusable zone throws out of
 * `toLocaleDateString` rather than falling back, for the same reason the
 * refusals below throw — a loud failure on a retryable seal beats a quietly
 * wrong date on a document that reads as executed.
 */
export function formatSigningDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString('en-US', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** @param timeZone IANA zone the signing dates are written in — the firm's. */
export function sealFieldsFor(marks: SignedMark[], timeZone: string): SealField[] {
  const ordered = [...marks].sort((a, b) => a.position - b.position)

  const positions = new Set<number>()
  for (const mark of ordered) {
    if (!Number.isInteger(mark.position) || mark.position < 1) {
      throw new Error(`A signature position must be a positive whole number, got ${mark.position}`)
    }
    if (positions.has(mark.position)) {
      throw new Error(`Two signatures claim position ${mark.position} on the same agreement`)
    }
    positions.add(mark.position)
  }

  return ordered.flatMap(mark => {
    const markers = engagementAnchorMarkers(mark.position)
    const typed = mark.typedName?.trim()

    // Neither a drawing nor a name means there is nothing to draw, and
    // stampField would paint a white rectangle over the marker and return —
    // producing a blank line on a document that reads as executed. Refuse
    // instead, the same way locateAnchors refuses to guess a position.
    if (!mark.signaturePng && !typed) {
      throw new Error(`The signer at position ${mark.position} has neither a drawn signature nor a typed name`)
    }

    return [
      {
        marker: markers.signature,
        kind: 'signature' as const,
        ...(mark.signaturePng ? { signaturePng: mark.signaturePng } : { text: typed }),
      },
      {
        marker: markers.date,
        kind: 'date' as const,
        text: formatSigningDate(mark.signedAt, timeZone),
      },
    ]
  })
}
