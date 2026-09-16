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
 */
export function formatSigningDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function sealFieldsFor(marks: SignedMark[]): SealField[] {
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
        text: formatSigningDate(mark.signedAt),
      },
    ]
  })
}
