import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { convertDocxToPdf } from '@/lib/docxPdfConvert'
import { validateEngagementInput } from './schema'

const MASTER_KEY = 'ep-trust-couple' as const
const MASTER_VERSION = '1' as const
const ANCHORS = ['CLIENT_1_SIGNATURE', 'CLIENT_1_DATE', 'CLIENT_2_SIGNATURE', 'CLIENT_2_DATE'] as const

export interface EngagementRenderDependencies {
  convertDocx?: (docxBytes: Buffer, filename: string) => Promise<Buffer>
}

function formatFee(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

async function validatePdf(pdfBytes: Buffer): Promise<void> {
  if (pdfBytes.length === 0) throw new Error('Engagement PDF conversion returned an empty PDF')
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(pdfBytes) })
  try {
    const info = await parser.getInfo({ parsePageInfo: true })
    const text = await parser.getText()
    if (!info.pages?.length) throw new Error('Engagement PDF has no pages')
    if (info.pages.some(page => Math.abs(page.width - 612) > 2 || Math.abs(page.height - 792) > 2)) {
      throw new Error('Engagement PDF pages must all be US Letter (612 x 792 points)')
    }
    for (const anchor of ANCHORS) {
      const count = text.text.split(`[[${anchor}]]`).length - 1
      if (count !== 1) throw new Error(`Engagement PDF anchor [[${anchor}]] must exist exactly once; found ${count}`)
    }
  } finally {
    await parser.destroy()
  }
}

export async function renderEngagementAgreement(input: unknown, dependencies: EngagementRenderDependencies = {}) {
  const validated = validateEngagementInput(input)
  if (!validated.ok) throw new Error(`Invalid engagement input: ${validated.errors.join(', ')}`)
  const value = validated.value
  if (value.practiceArea !== 'EP' || value.clientMode !== 'couple' || value.scopeKey !== 'standard' || value.legalPlan !== null) {
    throw new Error('Engagement agreement template unavailable for this combination')
  }
  if (!value.spouse) throw new Error('Engagement agreement template unavailable without a spouse')

  const master = await readFile(path.join(process.cwd(), 'assets/engagement-agreements/ep-trust-couple-v1.docx'))
  const doc = new Docxtemplater(new PizZip(master), { paragraphLoop: true, linebreaks: true })
  doc.render({
    agreement_date: value.agreementDate,
    primary_name: value.primary.name,
    primary_email: value.primary.email,
    spouse_name: value.spouse.name,
    spouse_email: value.spouse.email,
    flat_fee: formatFee(value.fee.amount),
    payment_terms: value.fee.paymentTerms,
    additional_clauses: value.additionalClauses ?? [],
    schedule_a_clauses: value.scheduleAClauses ?? [],
  })
  const docxBytes = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
  const convert = dependencies.convertDocx ?? convertDocxToPdf
  const pdfBytes = await convert(docxBytes, `${MASTER_KEY}-v${MASTER_VERSION}.docx`)
  await validatePdf(pdfBytes)

  return {
    docxBytes,
    pdfBytes,
    pdfSha256: createHash('sha256').update(pdfBytes).digest('hex'),
    masterKey: MASTER_KEY,
    masterVersion: MASTER_VERSION,
  }
}
