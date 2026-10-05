import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { convertDocxToPdf } from '@/lib/docxPdfConvert'
import { validateEngagementInput } from './schema'
import { allEngagementAnchorMarkers } from './anchors'
import { OPTIONAL_SERVICES } from './definitions'
import { engagementTemplateFor, PROBATE_PHASE_SHARES, type EngagementTemplate } from './templates'
import { engagementLegalPlanLabel, type EngagementInput } from './types'
import { resolveDocumentTemplate } from '@/lib/documentTemplates/resolver'
import type { ResolvedDocumentTemplate } from '@/lib/documentTemplates/types'

const PDF_CANVAS_GLOBALS = ['DOMMatrix', 'ImageData', 'Path2D'] as const
const requireCanvasRuntime = createRequire(import.meta.url)

/**
 * The addendum's service boxes are marked when the agreement is drafted, not by
 * the signer: the e-sign pipeline's anchors are signature and date only
 * (`lib/esign/types.ts`), so there is no client-fillable checkbox to stamp. The
 * client adopts the marked services by signing the agreement that contains them.
 */
const CHECKED = '☒'
const UNCHECKED = '☐'

export interface EngagementRenderDependencies {
  convertDocx?: (docxBytes: Buffer, filename: string) => Promise<Buffer>
  template?: ResolvedDocumentTemplate
}

function formatFee(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

async function ensurePdfCanvasRuntime(): Promise<void> {
  const canvas = requireCanvasRuntime('@napi-rs/canvas') as Record<string, unknown>
  for (const name of PDF_CANVAS_GLOBALS) {
    if (!(name in globalThis) && typeof canvas[name] === 'function') {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: canvas[name],
        writable: true,
      })
    }
  }
}

export async function validateEngagementPdf(pdfBytes: Buffer, anchors: string[]): Promise<void> {
  if (pdfBytes.length === 0) throw new Error('Engagement PDF conversion returned an empty PDF')
  await ensurePdfCanvasRuntime()
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(pdfBytes) })
  try {
    const info = await parser.getInfo({ parsePageInfo: true })
    const text = await parser.getText()
    if (!info.pages?.length) throw new Error('Engagement PDF has no pages')
    if (info.pages.some(page => Math.abs(page.width - 612) > 2 || Math.abs(page.height - 792) > 2)) {
      throw new Error('Engagement PDF pages must all be US Letter (612 x 792 points)')
    }
    for (const anchor of anchors) {
      const count = text.text.split(anchor).length - 1
      if (count !== 1) throw new Error(`Engagement PDF anchor ${anchor} must exist exactly once; found ${count}`)
    }
  } finally {
    await parser.destroy()
  }
}

/** The merge data the chosen master expects — each master its own field set. */
function templateData(template: EngagementTemplate, value: EngagementInput): Record<string, unknown> {
  const shared = {
    agreement_date: value.agreementDate,
    primary_name: value.primary.name,
    primary_email: value.primary.email,
    spouse_name: value.spouse?.name ?? '',
    spouse_email: value.spouse?.email ?? '',
    additional_clauses: value.additionalClauses ?? [],
    schedule_a_clauses: value.scheduleAClauses ?? [],
  }
  if (template.phasesFee) {
    // The agreement prints the total and each phase, so the phases are computed
    // from the one number staff enter rather than asked for separately — three
    // fields that have to add up to a fourth is a subtraction error in a fee
    // the client is signing. Non-null: only a master that names a decedent is
    // reached with one, and the validator has required it.
    return {
      ...shared,
      decedent_name: value.decedentName!,
      flat_fee: formatFee(value.fee.amount),
      opening_fee: formatFee(value.fee.amount * PROBATE_PHASE_SHARES.opening),
      inventory_fee: formatFee(value.fee.amount * PROBATE_PHASE_SHARES.inventory),
      final_account_fee: formatFee(value.fee.amount * PROBATE_PHASE_SHARES.final_account),
    }
  }
  if (template.legalPlans === null) {
    return { ...shared, flat_fee: formatFee(value.fee.amount), payment_terms: value.fee.paymentTerms }
  }
  const elected = new Set(value.optionalClauseKeys)
  const boxes = Object.fromEntries(template.optionalServiceKeys.map(key => [
    OPTIONAL_SERVICES[key].checkboxTag,
    elected.has(key) ? CHECKED : UNCHECKED,
  ]))
  return {
    ...shared,
    // Non-null: only a definition carrying a plan resolves to a plan master.
    legal_plan: engagementLegalPlanLabel(value.legalPlan!),
    ...boxes,
  }
}

export async function renderEngagementAgreement(input: unknown, dependencies: EngagementRenderDependencies = {}) {
  const validated = validateEngagementInput(input)
  if (!validated.ok) throw new Error(`Invalid engagement input: ${validated.errors.join(', ')}`)
  const value = validated.value
  const template = engagementTemplateFor(value)
  if (!template) throw new Error('Engagement agreement template unavailable for this combination')
  if (template.clientMode === 'couple' && !value.spouse) {
    throw new Error('Engagement agreement template unavailable without a spouse')
  }

  const resolvedTemplate = dependencies.template ?? (
    process.env.NODE_ENV === 'test'
      ? null
      : await resolveDocumentTemplate(template.templateId)
  )
  const master = resolvedTemplate?.buffer ?? await readFile(path.join(process.cwd(), template.bundledPath))
  const doc = new Docxtemplater(new PizZip(master), { paragraphLoop: true, linebreaks: true })
  doc.render(templateData(template, value))
  const docxBytes = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
  const convert = dependencies.convertDocx ?? convertDocxToPdf
  const resolvedVersion = resolvedTemplate?.versionId ?? template.masterVersion
  const pdfBytes = await convert(docxBytes, `${template.masterKey}-v${resolvedVersion}.docx`)
  // Derived from the master's own signer count rather than listed, so this
  // cannot drift from what the signing route stamps — see lib/engagement/anchors.ts.
  await validateEngagementPdf(pdfBytes, allEngagementAnchorMarkers(template.recipientCount))

  return {
    docxBytes,
    pdfBytes,
    pdfSha256: createHash('sha256').update(pdfBytes).digest('hex'),
    masterKey: template.masterKey,
    masterVersion: resolvedVersion,
    templateId: resolvedTemplate?.definition.id ?? template.templateId,
    templateVersionId: resolvedTemplate?.versionId ?? null,
    templateSource: resolvedTemplate?.source ?? 'bundled',
  }
}
