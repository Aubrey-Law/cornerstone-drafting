import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { BoundingBox, TextBlock, TextLayer, TextSpan } from './types'

/**
 * Bumped whenever a change here could move an offset. Stored on the layer so a
 * citation written under an older extractor is identifiable as possibly stale
 * rather than silently trusted.
 */
export const PDF_EXTRACTOR = 'pdfjs'
export const PDF_EXTRACTOR_VERSION = '1'

/**
 * A page with fewer than this many characters per page is treated as having no
 * text layer — the signature of a scan. The alternative, reporting an empty
 * layer as healthy, is worse than useless: downstream it reads as a document
 * with nothing wrong in it.
 */
const MIN_CHARS_PER_PAGE = 50

/** Multiple of the baseline line gap above which a vertical jump starts a new block. */
const BLOCK_GAP_RATIO = 1.35

/**
 * Percentile of observed line gaps taken as "normal line spacing".
 *
 * Not the median: on a short page the median can land on a *paragraph* gap and
 * then no gap looks unusual, which silently welds a heading onto the paragraph
 * below it — observed on the two-paragraph fixture page. A low percentile tracks
 * line spacing, which is the smallest recurring gap, while still resisting the
 * single tight line that would break a plain minimum.
 */
const LINE_GAP_PERCENTILE = 0.25

/** Horizontal gap, as a fraction of font size, that implies a space between items. */
const SPACE_GAP_RATIO = 0.18

const requireFromHere = createRequire(import.meta.url)

interface RawItem {
  str: string
  x: number
  /** Baseline, in PDF user space (origin bottom-left). */
  y: number
  width: number
  height: number
  hasEOL: boolean
}

interface PageItems {
  page: number
  height: number
  rotated: boolean
  items: RawItem[]
}

/**
 * pdf.js reaches for browser globals when it measures glyphs. `@napi-rs/canvas`
 * supplies them server-side; `lib/engagement/render.ts` already does the same
 * thing for its own PDF validation.
 */
function ensurePdfCanvasRuntime(): void {
  const canvas = requireFromHere('@napi-rs/canvas') as Record<string, unknown>
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D'] as const) {
    if (!(name in globalThis) && typeof canvas[name] === 'function') {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: canvas[name],
        writable: true,
      })
    }
  }
}

/**
 * Where pdf.js should find the Foxit substitutes for the base-14 fonts.
 *
 * A filesystem path, deliberately, not a `file://` URL: the Node build fails to
 * read those and logs a warning on every single extraction. Glyph widths come
 * out identical either way — font data matters for rendering, not for the text
 * content this module reads — so the only thing at stake is whether the logs
 * are honest or full of noise nobody should act on.
 */
function standardFontDataPath(): string | undefined {
  const entry = requireFromHere.resolve('pdfjs-dist/package.json') as unknown
  // A bundler that inlines pdfjs-dist answers this resolve with its own module
  // id — a number — and `path.dirname` then throws
  //   The "path" argument must be of type string. Received type number
  // which says nothing about fonts, pdf.js, or the bundle that caused it. The
  // first native engagement send died on exactly that, and the fix is to keep
  // pdfjs-dist external (see `serverExternalPackages` in next.config.mjs).
  //
  // Returning undefined rather than throwing is deliberate: pdf.js falls back
  // to its built-in metrics, and by the note above the glyph widths are the
  // same either way, so text extraction — the only thing this module reads —
  // is unaffected. Losing the font path must not take down a signature run.
  if (typeof entry !== 'string') {
    console.warn(
      '[textLayer] pdfjs-dist resolved to a %s (%s) rather than a path, so its standard '
        + 'fonts cannot be located. pdfjs-dist is probably being bundled; it belongs in '
        + "next.config.mjs's serverExternalPackages. Continuing without standardFontDataUrl.",
      typeof entry,
      String(entry),
    )
    return undefined
  }
  return path.join(path.dirname(entry), 'standard_fonts') + path.sep
}

async function readPages(bytes: Uint8Array): Promise<PageItems[]> {
  ensurePdfCanvasRuntime()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const fontPath = standardFontDataPath()
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    ...(fontPath === undefined ? {} : { standardFontDataUrl: fontPath }),
    useSystemFonts: false,
  }).promise

  try {
    const pages: PageItems[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: RawItem[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        if (item.str === '') continue
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
          hasEOL: item.hasEOL === true,
        })
      }
      pages.push({
        page: pageNumber,
        height: viewport.height,
        // Geometry on a rotated page would need the viewport transform applied
        // per item. Offsets stay correct without it, so the honest answer is to
        // keep the text and drop the boxes rather than emit rectangles that are
        // subtly wrong.
        rotated: page.rotate % 360 !== 0,
        items,
      })
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

/**
 * Groups a page's items into visual lines and orders them for reading.
 *
 * Single-column legal instruments are the easy case and the only one this
 * needs to be right about: sort into y-bands top to bottom, then left to right
 * within a band. Multi-column layouts would need real column detection, and
 * getting that wrong silently reorders a document, so this does not pretend to
 * handle them.
 */
function groupIntoLines(items: RawItem[]): RawItem[][] {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x))
  const lines: RawItem[][] = []
  for (const item of sorted) {
    const current = lines[lines.length - 1]
    const band = Math.max(item.height, 1) * 0.5
    if (current && Math.abs(current[0].y - item.y) <= band) current.push(item)
    else lines.push([item])
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x)
  return lines
}

function baselineLineGap(lines: RawItem[][]): number {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const gap = lines[i - 1][0].y - lines[i][0].y
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length * LINE_GAP_PERCENTILE)]
}

function boxFor(item: RawItem, pageHeight: number, rotated: boolean): BoundingBox | null {
  if (rotated) return null
  return {
    x: item.x,
    y: pageHeight - (item.y + item.height),
    width: item.width,
    height: item.height,
  }
}

function unionBox(boxes: Array<BoundingBox | null>): BoundingBox | null {
  const present = boxes.filter((b): b is BoundingBox => b !== null)
  if (present.length === 0) return null
  const left = Math.min(...present.map(b => b.x))
  const top = Math.min(...present.map(b => b.y))
  const right = Math.max(...present.map(b => b.x + b.width))
  const bottom = Math.max(...present.map(b => b.y + b.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Extracts a text layer with character offsets from a PDF's own text content.
 *
 * Uses pdf.js directly rather than `pdf-parse`'s `getText()`, which returns a
 * string and drops every position — and positions are the entire point here.
 *
 * A PDF has no text stream, only drawing operations, so the line and paragraph
 * breaks in `text` are *inserted* by this function from geometry. That is
 * unavoidable and it is why the joining rules below are fixed and deterministic:
 * the same bytes must always produce the same offsets, or every stored citation
 * becomes a lie the next time the document is re-extracted.
 */
export async function buildPdfTextLayer(bytes: Buffer | Uint8Array): Promise<TextLayer> {
  const input = bytes instanceof Buffer ? new Uint8Array(bytes) : bytes
  const sourceSha256 = createHash('sha256').update(input).digest('hex')
  // pdf.js takes ownership of the buffer it is handed, so give it a copy; the
  // caller's bytes stay intact for hashing and storage.
  const pages = await readPages(new Uint8Array(input))

  const spans: TextSpan[] = []
  const blocks: TextBlock[] = []
  let text = ''

  for (const page of pages) {
    const lines = groupIntoLines(page.items)
    const gapThreshold = baselineLineGap(lines) * BLOCK_GAP_RATIO

    let blockStart = text.length
    let blockSpans: TextSpan[] = []
    let blockOpen = false

    const closeBlock = (): void => {
      if (!blockOpen) return
      blocks.push({
        index: blocks.length,
        charStart: blockStart,
        charEnd: text.length,
        text: text.slice(blockStart, text.length),
        page: page.page,
        bbox: unionBox(blockSpans.map(s => s.bbox)),
      })
      blockSpans = []
      blockOpen = false
    }

    lines.forEach((line, lineIndex) => {
      const previous = lines[lineIndex - 1]
      const startsBlock =
        lineIndex === 0 ||
        (gapThreshold > 0 && previous[0].y - line[0].y > gapThreshold)

      if (startsBlock) {
        closeBlock()
        if (text.length > 0) text += '\n\n'
        blockStart = text.length
        blockOpen = true
      } else {
        text += '\n'
      }

      line.forEach((item, itemIndex) => {
        const before = line[itemIndex - 1]
        if (before) {
          const gap = item.x - (before.x + before.width)
          if (gap > item.height * SPACE_GAP_RATIO) text += ' '
        }
        const charStart = text.length
        text += item.str
        const span: TextSpan = {
          charStart,
          charEnd: text.length,
          page: page.page,
          bbox: boxFor(item, page.height, page.rotated),
        }
        spans.push(span)
        blockSpans.push(span)
      })
    })

    closeBlock()
  }

  const pageCount = pages.length
  const status =
    pageCount > 0 && text.replace(/\s/g, '').length / pageCount < MIN_CHARS_PER_PAGE
      ? 'no_text'
      : 'ok'

  return {
    sourceKind: 'pdf',
    status,
    extractor: PDF_EXTRACTOR,
    extractorVersion: PDF_EXTRACTOR_VERSION,
    sourceSha256,
    pageCount,
    text,
    blocks,
    spans,
  }
}
