import type { BillingKind } from '@/lib/billing/types'

/** One rendered line. Amounts arrive pre-formatted so the PDF does no math. */
export interface InvoiceRenderLine {
  description: string
  kind: BillingKind
  amount: string
}

/**
 * Everything the invoice document needs, already formatted. Built once by
 * lib/invoices/generate.ts and shared by the DOCX, the email body and the
 * on-screen preview, so the three cannot drift apart.
 */
export interface InvoiceRenderData {
  firm: {
    name: string
    attorneyName: string
    street: string
    cityStateZip: string
    phone: string
    email: string
    website: string
    barNumber: string
  }
  billTo: {
    name: string
    email: string | null
    matterName: string | null
    matterNumber: string | null
  }
  invoiceNumber: string
  issueDate: string
  dueDate: string
  /** YYYY-MM-DD, for the past-due comparison in the email body. */
  dueDateKey: string
  lines: InvoiceRenderLine[]
  subtotal: string
  /** Omitted on a first issue; present on a reissue or receipt. */
  paymentsApplied: string | null
  balanceDue: string
  notes: string | null
  terms: string | null
  payLink: string | null
  remitTo: string
}

export interface InvoiceArtifact {
  /** Base filename without extension, e.g. `Invoice_2026-0004_Chen`. */
  baseName: string
  docxBytes: Buffer
  /** Null when the convert worker is unconfigured — issuing never blocks on it. */
  pdfBytes: Buffer | null
  /** Why the PDF is missing, surfaced in the UI rather than swallowed. */
  pdfUnavailableReason: string | null
}
