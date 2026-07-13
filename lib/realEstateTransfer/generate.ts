import fs from 'node:fs'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import {
  DOCUMENT_TYPES,
  deedTemplateVariant,
  fieldsToTemplateData,
  type RealEstateTransferDocType,
  type RealEstateTransferFields,
} from './fields'
import { getRealEstateTransferTemplatePath } from './extract'
import { resolveDocumentTemplateForBundledPath } from '@/lib/documentTemplates/resolver'
import type { ResolvedDocumentTemplate } from '@/lib/documentTemplates/types'

function renderTemplate(templateFile: string, fields: RealEstateTransferFields, templateBuffer?: Buffer): Buffer {
  const templatePath = getRealEstateTransferTemplatePath(templateFile)
  if (!templateBuffer && !fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templateFile}`)
  }

  const content = templateBuffer ?? fs.readFileSync(templatePath)
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
  })

  doc.render(fieldsToTemplateData(fields))
  return Buffer.from(doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

export function realEstateTransferTemplateMeta(
  docType: RealEstateTransferDocType,
  fields: RealEstateTransferFields,
) {
  return docType === 'deed' ? deedTemplateVariant(fields) : DOCUMENT_TYPES[docType]
}

export function renderRealEstateTransferDocx(
  docType: RealEstateTransferDocType,
  fields: RealEstateTransferFields,
  templateBuffer?: Buffer,
): Buffer {
  const meta = realEstateTransferTemplateMeta(docType, fields)
  return renderTemplate(meta.templateFile, fields, templateBuffer)
}

export interface ResolvedRealEstateTransferDocx {
  buffer: Buffer
  template: ResolvedDocumentTemplate
}

export async function resolveAndRenderRealEstateTransferDocx(
  docType: RealEstateTransferDocType,
  fields: RealEstateTransferFields,
): Promise<ResolvedRealEstateTransferDocx> {
  const meta = realEstateTransferTemplateMeta(docType, fields)
  const template = await resolveDocumentTemplateForBundledPath(
    `tools/aubreylaw-docgeneration/templates/${meta.templateFile}`,
  )
  return { buffer: renderRealEstateTransferDocx(docType, fields, template.buffer), template }
}

export function safeDownloadFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'document.docx'
}

export interface RealEstateTransferPackageResult {
  buffer: Buffer
  contentType: string
  filename: string
}

export function renderRealEstateTransferPackage(
  docTypes: RealEstateTransferDocType[],
  fields: RealEstateTransferFields,
): RealEstateTransferPackageResult {
  if (docTypes.length === 0) {
    throw new Error('Select at least one document')
  }

  const unique = [...new Set(docTypes)]
  const grantorSlug = safeDownloadFilename(fields.grantor ?? 'real-estate-transfer').replace(/\.docx$/i, '')

  if (unique.length === 1) {
    const docType = unique[0]
    const meta = realEstateTransferTemplateMeta(docType, fields)
    const buffer = renderRealEstateTransferDocx(docType, fields)
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: safeDownloadFilename(`${meta.downloadBaseName} - ${grantorSlug}.docx`),
    }
  }

  const zip = new PizZip()
  for (const docType of unique) {
    const meta = realEstateTransferTemplateMeta(docType, fields)
    const buffer = renderRealEstateTransferDocx(docType, fields)
    zip.file(safeDownloadFilename(`${meta.downloadBaseName} - ${grantorSlug}.docx`), buffer)
  }

  return {
    buffer: Buffer.from(zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })),
    contentType: 'application/zip',
    filename: safeDownloadFilename(`Real-Estate-Transfer - ${grantorSlug}.zip`),
  }
}

export async function resolveAndRenderRealEstateTransferPackage(
  docTypes: RealEstateTransferDocType[],
  fields: RealEstateTransferFields,
): Promise<RealEstateTransferPackageResult> {
  if (docTypes.length === 0) throw new Error('Select at least one document')
  const unique = [...new Set(docTypes)]
  const grantorSlug = safeDownloadFilename(fields.grantor ?? 'real-estate-transfer').replace(/\.docx$/i, '')
  if (unique.length === 1) {
    const docType = unique[0]
    const meta = realEstateTransferTemplateMeta(docType, fields)
    const { buffer } = await resolveAndRenderRealEstateTransferDocx(docType, fields)
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: safeDownloadFilename(`${meta.downloadBaseName} - ${grantorSlug}.docx`),
    }
  }
  const zip = new PizZip()
  for (const docType of unique) {
    const meta = realEstateTransferTemplateMeta(docType, fields)
    const { buffer } = await resolveAndRenderRealEstateTransferDocx(docType, fields)
    zip.file(safeDownloadFilename(`${meta.downloadBaseName} - ${grantorSlug}.docx`), buffer)
  }
  return {
    buffer: Buffer.from(zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })),
    contentType: 'application/zip',
    filename: safeDownloadFilename(`Real-Estate-Transfer - ${grantorSlug}.zip`),
  }
}
