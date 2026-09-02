import { createHash } from 'node:crypto'
import PizZip from 'pizzip'

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function validateDocxStructure(buffer: Buffer): string | null {
  if (buffer.length === 0) return 'Template file is empty.'
  if (buffer.length > MAX_TEMPLATE_BYTES) return `Template exceeds the ${MAX_TEMPLATE_BYTES / 1024 / 1024} MB limit.`
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return 'Template is not a valid DOCX ZIP file.'
  try {
    const zip = new PizZip(buffer)
    if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) {
      return 'Template is missing required DOCX parts.'
    }
  } catch (error) {
    return `Template is not a readable DOCX: ${error instanceof Error ? error.message : String(error)}`
  }
  return null
}

