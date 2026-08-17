import { getDocumentUrl } from '@/lib/documents'

/**
 * Fetches a short-lived URL for the invoice's rendered document and hands it
 * to the browser as a download.
 *
 * Shared by the composer's "Issue & download" and the detail page's Download,
 * so the filename a client receives is the same whichever route produced it.
 */
export async function downloadInvoiceDocument(input: {
  documentId: string
  invoiceNumber: string | null
  /** False when the DOCX→PDF worker was unavailable and only Word exists. */
  isPdf: boolean
}): Promise<void> {
  const url = await getDocumentUrl(input.documentId, 'download')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = input.invoiceNumber
    ? `Invoice ${input.invoiceNumber}.${input.isPdf ? 'pdf' : 'docx'}`
    : `Invoice.${input.isPdf ? 'pdf' : 'docx'}`
  anchor.rel = 'noopener noreferrer'
  anchor.click()
}
