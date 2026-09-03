/**
 * Builds the PDF fixtures the text-layer tests run against.
 *
 * These are written from raw PDF syntax rather than produced by a converter for
 * two reasons. A converter would add a dependency for test data alone, and —
 * more importantly — its output would drift with its version, so a fixture
 * regenerated next year would silently differ from the one the expected offsets
 * were written against. Hand-built PDFs are byte-stable forever.
 *
 *   npm run fixtures:text-layer
 *
 * The generated files are committed. Regenerate only when the fixture text
 * itself needs to change, and expect the offset assertions to move with it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures/text-layer')

interface Line {
  /** Baseline position in PDF user space (origin bottom-left). */
  x: number
  y: number
  size: number
  text: string
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function contentStream(lines: Line[]): string {
  const ops = lines.map(
    line => `BT /F1 ${line.size} Tf ${line.x} ${line.y} Td (${escapePdfString(line.text)}) Tj ET`,
  )
  return ops.join('\n')
}

/**
 * Assembles a PDF with a real cross-reference table. pdf.js tolerates a broken
 * xref by rebuilding it, but a fixture that only parses because the reader
 * repaired it is a fixture that proves nothing about the reader.
 */
function buildPdf(pages: Line[][]): Buffer {
  const objects: string[] = []
  const pageObjectNumbers: number[] = []

  // 1 = catalog, 2 = pages, 3 = font, then two objects per page.
  const fontObjectNumber = 3
  let next = 4
  for (const _page of pages) {
    pageObjectNumbers.push(next)
    next += 2
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] =
    `<< /Type /Pages /Count ${pages.length} ` +
    `/Kids [${pageObjectNumbers.map(n => `${n} 0 R`).join(' ')}] >>`
  objects[fontObjectNumber] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'

  pages.forEach((lines, i) => {
    const pageNumber = pageObjectNumbers[i]
    const contentNumber = pageNumber + 1
    const stream = contentStream(lines)
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> ` +
      `/Contents ${contentNumber} 0 R >>`
    objects[contentNumber] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  })

  const count = objects.length
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let n = 1; n < count; n += 1) {
    offsets[n] = Buffer.byteLength(pdf, 'latin1')
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n += 1) {
    pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

/** Lays out paragraphs down a page, leaving a wider gap between them. */
function layout(paragraphs: string[][], startY = 720, lineGap = 16, paragraphGap = 26): Line[] {
  const lines: Line[] = []
  let y = startY
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) y -= paragraphGap - lineGap
    for (const text of paragraph) {
      lines.push({ x: 72, y, size: 12, text })
      y -= lineGap
    }
  })
  return lines
}

/**
 * A trust excerpt. Deliberately contains a phrase that appears twice
 * ("the Trustee shall") so the verifier's ambiguity rule has something real to
 * reject, and an indemnity clause that is one-sided so a review rule has a
 * genuine finding to make.
 */
const TRUST_EXCERPT: string[][] = [
  ['ARTICLE VII. TRUSTEE POWERS'],
  [
    'The Trustee shall have the power to sell, exchange, or otherwise dispose of any',
    'property of the trust estate, whether real or personal, at public or private sale,',
    'without order of court and without notice to any beneficiary.',
  ],
  [
    'The Settlor shall indemnify and hold harmless the Trustee from and against any and',
    'all claims arising out of the administration of this trust, except for claims',
    'arising from the Trustee willful misconduct.',
  ],
  [
    'No bond or other security shall be required of any Trustee named herein, whether',
    'original or successor, in any jurisdiction.',
  ],
  [
    'In the exercise of any discretion granted under this Article, the Trustee shall',
    'consider the beneficiary other resources known to the Trustee.',
  ],
]

const SECOND_PAGE: string[][] = [
  ['ARTICLE VIII. DISTRIBUTIONS'],
  [
    'Upon the death of the Settlor, the remaining trust estate shall be distributed to',
    'the beneficiaries then living, per stirpes.',
  ],
]

/**
 * A page of drawing operations with no text at all — what a scan looks like to
 * an extractor. Detection of this case has to be explicit, because an empty
 * layer reported as healthy reads downstream as a clean document.
 */
const SCANNED: Line[][] = [[{ x: 72, y: 720, size: 12, text: '' }]]

function main(): void {
  mkdirSync(FIXTURE_DIR, { recursive: true })

  writeFileSync(
    path.join(FIXTURE_DIR, 'trust-excerpt.pdf'),
    buildPdf([layout(TRUST_EXCERPT), layout(SECOND_PAGE)]),
  )
  writeFileSync(path.join(FIXTURE_DIR, 'scanned.pdf'), buildPdf(SCANNED))

  process.stdout.write(`Wrote fixtures to ${path.relative(process.cwd(), FIXTURE_DIR)}\n`)
}

main()
