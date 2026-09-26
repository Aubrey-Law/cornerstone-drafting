/**
 * The open document's bytes, base64-encoded.
 *
 * Shared by the firm style sweep and the version save. Both need the whole
 * `.docx` as it currently stands on disk — including tracked changes, headers
 * and section properties, none of which Office.js exposes piecemeal.
 */

/** Office allows only two open file handles per document; every path closes. */
export async function readDocumentBytes(): Promise<string> {
  const file = await new Promise<Office.File>((resolve, reject) => {
    Office.context.document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: 4 * 1024 * 1024 },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value)
        else reject(new Error(result.error?.message ?? 'Could not read the document.'))
      },
    )
  })

  try {
    const chunks: number[][] = []
    for (let i = 0; i < file.sliceCount; i++) {
      const slice = await new Promise<Office.Slice>((resolve, reject) => {
        file.getSliceAsync(i, (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value)
          else reject(new Error(result.error?.message ?? 'Could not read the document.'))
        })
      })
      chunks.push(slice.data as number[])
    }
    return toBase64(chunks)
  } finally {
    file.closeAsync()
  }
}

function toBase64(chunks: number[][]): string {
  // Chunked so a large document does not blow the argument limit of
  // String.fromCharCode with a single spread of millions of bytes.
  let binary = ''
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 8192) {
      binary += String.fromCharCode(...chunk.slice(i, i + 8192))
    }
  }
  return btoa(binary)
}

/**
 * The open document's file name without its extension, or null when Word has
 * not saved it anywhere yet (or there is no Office host, as in a test).
 */
export function currentDocumentName(): string | null {
  try {
    const url = Office.context.document.url ?? ''
    const last = url.split(/[\\/]/).pop() ?? ''
    const name = decodeURIComponent(last).replace(/\.docx?$/i, '').trim()
    return name || null
  } catch {
    return null
  }
}

/**
 * Base64 inflates by 4/3, and the server sits behind Vercel's request body
 * limit. Checked before the upload so an oversized document is named as such
 * rather than arriving as a generic 413 after a long wait.
 */
export const MAX_UPLOAD_BASE64_CHARS = 4_400_000

export function describeOversize(base64Length: number): string {
  const megabytes = (base64Length * 0.75) / (1024 * 1024)
  return `This document is about ${megabytes.toFixed(1)} MB, over the ~3.3 MB the server accepts. Save a version from the Cornerstone web app instead.`
}
