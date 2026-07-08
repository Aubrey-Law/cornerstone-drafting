/**
 * Client for the standalone LibreOffice DOCX→PDF convert worker.
 *
 * When DOCX_PDF_CONVERT_URL is unset, conversion is unavailable (501 from the
 * API route). Deploy the worker under tools/docx-pdf-worker/ (Fly.io scale-to-zero).
 */

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export class DocxPdfConvertNotConfiguredError extends Error {
  constructor() {
    super(
      'DOCX→PDF conversion is not configured. Set DOCX_PDF_CONVERT_URL (and DOCX_PDF_CONVERT_SECRET) or upload a PDF exported from Word.',
    )
    this.name = 'DocxPdfConvertNotConfiguredError'
  }
}

export class DocxPdfConvertError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'DocxPdfConvertError'
    this.status = status
  }
}

export function isDocxPdfConvertConfigured(): boolean {
  const url = process.env.DOCX_PDF_CONVERT_URL?.trim()
  return Boolean(url)
}

/**
 * POST DOCX bytes to the convert worker and return PDF bytes.
 * Throws DocxPdfConvertNotConfiguredError when env is unset.
 */
export async function convertDocxToPdf(
  docxBytes: Buffer | Uint8Array,
  filename = 'document.docx',
): Promise<Buffer> {
  const baseUrl = process.env.DOCX_PDF_CONVERT_URL?.trim()
  if (!baseUrl) throw new DocxPdfConvertNotConfiguredError()

  const secret = process.env.DOCX_PDF_CONVERT_SECRET?.trim()
  const url = `${baseUrl.replace(/\/$/, '')}/convert`

  const form = new FormData()
  const inputBytes =
    docxBytes instanceof Buffer
      ? docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength)
      : docxBytes
  const blob = new Blob([inputBytes], { type: DOCX_MIME })
  form.append('file', blob, filename)

  const headers: Record<string, string> = {}
  if (secret) headers.Authorization = `Bearer ${secret}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new DocxPdfConvertError(`Convert worker unreachable: ${message}`, 502)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new DocxPdfConvertError(
      `Convert worker failed (${res.status}): ${text.slice(0, 300) || res.statusText}`,
      res.status >= 400 && res.status < 600 ? res.status : 502,
    )
  }

  const pdfAb = await res.arrayBuffer()
  if (pdfAb.byteLength === 0) {
    throw new DocxPdfConvertError('Convert worker returned an empty PDF', 502)
  }
  return Buffer.from(pdfAb)
}
