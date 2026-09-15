import 'server-only'

import { buildPdfTextLayer } from '@aubrey-law/citations/textLayer/pdf'
import type { BoundingBox } from '@aubrey-law/citations/textLayer/types'

/**
 * Where on the page each signature anchor sits.
 *
 * This is the module that decides where a client's signature is drawn, so it
 * fails loudly rather than guessing. A signature stamped in the wrong place on
 * an executed fee agreement is the worst thing this engine can do: the
 * document looks finished, nobody re-reads it, and the error surfaces only if
 * the engagement is ever disputed.
 *
 * Every failure below therefore throws with its own message. None of them
 * returns a default position, an approximate box, or silently drops an anchor.
 *
 * The heavy lifting is already done by packages/citations: `buildPdfTextLayer`
 * returns the document's canonical text plus a span per drawn run, each with a
 * 1-based page and a bounding box. Locating `[[CLIENT_1_SIGNATURE]]` is an
 * indexOf into that text and a span lookup.
 */

export class AnchorLocationError extends Error {
  constructor(readonly code: AnchorFailureCode, message: string) {
    super(message)
    this.name = 'AnchorLocationError'
  }
}

export type AnchorFailureCode =
  | 'no_text'
  | 'marker_missing'
  | 'marker_duplicated'
  | 'geometry_unavailable'

/** An anchor resolved to a page and a box, in **top-left origin** coordinates. */
export interface LocatedAnchor {
  marker: string
  /** 1-based, as the text layer reports it. */
  page: number
  /** Top-left origin, matching BoundingBox. Convert at draw time. */
  bbox: BoundingBox
}

/**
 * Convert a top-left-origin box to the bottom-left origin PDF drawing uses.
 *
 * The text layer flips PDF's native bottom-left origin to top-left once, on
 * the way in, so it can be scaled straight into CSS pixels. pdf-lib draws in
 * the native origin, so it has to be flipped back. The formula is its own
 * inverse, which is a small mercy and also why it is easy to apply zero times
 * or twice by accident — hence one function, used everywhere, with a test.
 *
 * `pageHeight` must come from the page being drawn on (pdf-lib's
 * `page.getHeight()`), not from the extraction, so the two cannot disagree.
 */
export function toPdfOrigin(bbox: BoundingBox, pageHeight: number): BoundingBox {
  return { ...bbox, y: pageHeight - (bbox.y + bbox.height) }
}

function unionBox(boxes: BoundingBox[]): BoundingBox {
  const left = Math.min(...boxes.map(b => b.x))
  const top = Math.min(...boxes.map(b => b.y))
  const right = Math.max(...boxes.map(b => b.x + b.width))
  const bottom = Math.max(...boxes.map(b => b.y + b.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Locate each marker in a rendered PDF.
 *
 * Markers must appear exactly once. Zero means the render did not include the
 * anchor the caller expects — a template mismatch, not something to work
 * around. More than one is worse: there is no principled way to choose, and
 * picking the first would put a spouse's signature on the client's line.
 */
export async function locateAnchors(
  pdf: Buffer,
  markers: string[],
): Promise<LocatedAnchor[]> {
  const layer = await buildPdfTextLayer(pdf)

  if (layer.status === 'no_text') {
    // A scanned or image-only PDF. The text layer models this as a first-class
    // outcome rather than an error, but for anchoring it is fatal: there is
    // nothing to search.
    throw new AnchorLocationError(
      'no_text',
      'The rendered agreement has no extractable text, so signature anchors cannot be located. '
        + 'This usually means the PDF was produced as an image rather than from the DOCX.',
    )
  }

  return markers.map(marker => {
    const first = layer.text.indexOf(marker)
    if (first === -1) {
      throw new AnchorLocationError(
        'marker_missing',
        `Signature anchor ${marker} does not appear in the rendered agreement.`,
      )
    }
    if (layer.text.indexOf(marker, first + marker.length) !== -1) {
      throw new AnchorLocationError(
        'marker_duplicated',
        `Signature anchor ${marker} appears more than once in the rendered agreement; `
          + 'there is no safe way to choose between them.',
      )
    }

    const charStart = first
    const charEnd = first + marker.length
    const covering = layer.spans.filter(
      span => span.charStart < charEnd && span.charEnd > charStart,
    )
    if (covering.length === 0) {
      throw new AnchorLocationError(
        'geometry_unavailable',
        `Signature anchor ${marker} was found in the text but no drawn span covers it.`,
      )
    }

    // A rotated page keeps correct character offsets but reports null geometry,
    // which the text layer's own type comment is explicit about. Correct text
    // with unusable coordinates is exactly the case that must not be papered
    // over: it would place the signature confidently and wrongly.
    const boxes = covering.map(span => span.bbox)
    if (boxes.some(box => box === null)) {
      throw new AnchorLocationError(
        'geometry_unavailable',
        `Signature anchor ${marker} sits on a rotated page, where the extractor reports no `
          + 'usable geometry. The agreement must be rendered without page rotation.',
      )
    }

    const pages = new Set(covering.map(span => span.page))
    if (pages.size > 1) {
      throw new AnchorLocationError(
        'geometry_unavailable',
        `Signature anchor ${marker} spans a page break, so it has no single position.`,
      )
    }

    return {
      marker,
      page: covering[0].page,
      bbox: unionBox(boxes as BoundingBox[]),
    }
  })
}
