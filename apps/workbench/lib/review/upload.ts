import { extractorFor } from './run'

/**
 * Extraction holds the whole document in memory and the text layer travels
 * back in a JSON response, so an unbounded upload is a way to exhaust the
 * function's memory. 25 MB is far above any estate instrument.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export type ReviewUpload =
  | { ok: true; bytes: Buffer; filename: string }
  | { ok: false; message: string }

export async function readReviewUpload(form: FormData): Promise<ReviewUpload> {
  const field = form.get('document')
  if (!(field instanceof File) || field.name === '') {
    return { ok: false, message: 'Choose a document to review.' }
  }

  // The extension, not the browser's MIME type: browsers disagree about the
  // DOCX type and some send nothing at all, and the extension is what the
  // extractor is chosen by anyway.
  if (!extractorFor(field.name)) {
    return {
      ok: false,
      message: `${field.name} is not a PDF or a DOCX. Those are the only formats a citation can be anchored in.`,
    }
  }

  if (field.size === 0) {
    return { ok: false, message: `${field.name} is empty.` }
  }

  if (field.size > MAX_UPLOAD_BYTES) {
    const limitMb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))
    return {
      ok: false,
      message: `${field.name} is too large. The limit is ${limitMb} MB.`,
    }
  }

  return {
    ok: true,
    bytes: Buffer.from(await field.arrayBuffer()),
    filename: field.name,
  }
}
