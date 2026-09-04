/**
 * The text layer is the substrate the citation model stands on.
 *
 * One iron rule governs everything here: **the canonical text is never
 * transformed.** No ligature folding, no smart-quote normalization, no
 * whitespace collapsing. Whatever the extractor read out of the document is
 * what `TextLayer.text` holds, character for character, because every citation
 * offset is an index into it. Normalization belongs in the *matching* layer
 * (`./match`), which carries an index map back to these raw offsets — the same
 * shape `normalizeForMatch` has proven in the tracked-changes engine.
 *
 * Projects that normalize on the way in discover six weeks later that their
 * stored offsets point at the wrong characters, and by then every citation ever
 * written is subtly wrong.
 */

/** Where a text layer came from. Only `pdf` is implemented in the citation slice. */
export type TextLayerSourceKind = 'docx' | 'pdf' | 'plain'

/**
 * `no_text` is a first-class outcome, not a failure. A scanned PDF yields a
 * valid layer with no usable characters, and saying so explicitly is the only
 * honest answer — an empty layer reported as `ok` reads downstream as "a
 * document with nothing wrong in it".
 */
export type TextLayerStatus = 'ok' | 'no_text'

/**
 * A rectangle in PDF user space, already flipped to a **top-left origin** so it
 * can be scaled straight into CSS pixels. PDF's native origin is bottom-left;
 * doing the flip once, here, keeps the viewer from having to know that.
 */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One addressable unit of the document — a paragraph in a DOCX, a line-run in a
 * PDF. Blocks are the unit a citation is scoped to, which is what lets the
 * verifier search a bounded span rather than the whole instrument.
 *
 * `charStart`/`charEnd` index into `TextLayer.text`, so
 * `layer.text.slice(block.charStart, block.charEnd) === block.text` always
 * holds. That invariant is asserted in the tests and is the thing everything
 * else depends on.
 */
export interface TextBlock {
  index: number
  charStart: number
  charEnd: number
  text: string
  /** 1-based. Null for formats with no page concept, such as DOCX. */
  page: number | null
  /** Null on rotated pages, where offsets stay correct but geometry does not. */
  bbox: BoundingBox | null
}

/**
 * One run of characters the extractor drew at a known place on a page.
 *
 * Spans exist so a citation covering part of a paragraph can be highlighted
 * accurately. Blocks are the unit a citation is *scoped* to; spans are the unit
 * it is *drawn* from. Without them the only geometry available for a
 * three-word quote would be the bounding box of its whole paragraph.
 */
export interface TextSpan {
  charStart: number
  charEnd: number
  /** 1-based. */
  page: number
  /** Null on rotated pages, where offsets stay correct but geometry does not. */
  bbox: BoundingBox | null
}

export interface TextLayer {
  sourceKind: TextLayerSourceKind
  status: TextLayerStatus
  /** Name and version of the extractor, so a re-extraction under new code is visible. */
  extractor: string
  extractorVersion: string
  /** sha256 of the source bytes. Makes extraction idempotent and drift detectable. */
  sourceSha256: string
  pageCount: number | null
  /** The canonical, untransformed text. Every offset in every citation indexes this. */
  text: string
  blocks: TextBlock[]
  /** Drawing geometry, in document order. Empty for formats without positions. */
  spans: TextSpan[]
}

/**
 * A claim about a span of a specific document *version*.
 *
 * Three deliberate choices, each of which is a bug avoided:
 *
 * 1. Citations anchor to a version, never to the mutable document. A redline
 *    creates a new version and every offset in the old one shifts.
 * 2. `page` is derived and nullable. `blockIndex`/`charStart`/`charEnd` is
 *    authoritative; page and bbox are display convenience.
 * 3. `verification` is stored rather than assumed. Anything that is not
 *    `verified` is excluded from every export, by construction.
 */
export type CitationVerification = 'verified' | 'unverified' | 'stale'

export interface Citation {
  blockIndex: number
  charStart: number
  charEnd: number
  page: number | null
  bbox: BoundingBox | null
  /** The exact substring of `TextLayer.text` between the offsets. */
  quote: string
  verification: CitationVerification
}
