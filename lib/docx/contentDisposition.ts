/**
 * Build a Content-Disposition header for a .docx download whose name may
 * contain non-Latin-1 characters (em dashes, curly quotes, accented names).
 * Header values are ByteStrings — a raw "—" in filename= throws at response
 * construction — so the plain filename is ASCII-sanitized and the exact name
 * travels in the RFC 5987 filename* parameter, which browsers prefer.
 */
export function docxAttachmentDisposition(baseName: string): string {
  const trimmed = baseName.trim() || 'document'
  const ascii = trimmed
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Remaining non-ASCII plus characters unsafe in a quoted filename.
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
  // RFC 5987 percent-encoding: encodeURIComponent plus the characters it
  // leaves bare that attr-char forbids.
  const encoded = encodeURIComponent(`${trimmed}.docx`)
    .replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}.docx"; filename*=UTF-8''${encoded}`
}
