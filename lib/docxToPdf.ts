import {
  deleteDriveItem,
  downloadFileAsPdf,
  ensureFolderByPath,
  rootPath,
  uploadFile,
} from '@/lib/microsoftOneDrive'

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function docxFilename(filename: string): string {
  const trimmed = filename.trim() || 'document.docx'
  return trimmed.toLowerCase().endsWith('.docx') ? trimmed : `${trimmed}.docx`
}

export function pdfFilenameFromDocx(filename: string): string {
  const base = filename.trim() || 'document'
  return base.replace(/\.docx$/i, '') + '.pdf'
}

/** Convert DOCX bytes to PDF using Microsoft Graph / OneDrive. */
export async function convertDocxBufferToPdf(
  docxBytes: Uint8Array,
  filename: string,
): Promise<Uint8Array> {
  const tempFolderPath = `${rootPath()}/.convert-temp`
  const parent = await ensureFolderByPath(tempFolderPath)
  const uploadName = `${Date.now()}-${docxFilename(filename)}`
  const uploaded = await uploadFile(parent.id, uploadName, docxBytes, DOCX_CONTENT_TYPE)
  try {
    return await downloadFileAsPdf(uploaded.id)
  } finally {
    await deleteDriveItem(uploaded.id).catch(err => {
      console.error('[docxToPdf] failed to delete temp OneDrive item', uploaded.id, err)
    })
  }
}
