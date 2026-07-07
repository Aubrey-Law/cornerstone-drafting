import fs from 'node:fs'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import {
  DOCUMENT_TYPES,
  fieldsToTemplateData,
  type RealEstateTransferDocType,
  type RealEstateTransferFields,
} from './fields'
import { getRealEstateTransferTemplatePath } from './extract'

function renderTemplate(templateFile: string, fields: RealEstateTransferFields): Buffer {
  const templatePath = getRealEstateTransferTemplatePath(templateFile)
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templateFile}`)
  }

  const content = fs.readFileSync(templatePath)
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
  })

  doc.render(fieldsToTemplateData(fields))
  return Buffer.from(doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

export function renderRealEstateTransferDocx(
  docType: RealEstateTransferDocType,
  fields: RealEstateTransferFields,
): Buffer {
  const meta = DOCUMENT_TYPES[docType]
  return renderTemplate(meta.templateFile, fields)
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
    const meta = DOCUMENT_TYPES[docType]
    const buffer = renderRealEstateTransferDocx(docType, fields)
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: safeDownloadFilename(`${meta.downloadBaseName} - ${grantorSlug}.docx`),
    }
  }

  const zip = new PizZip()
  for (const docType of unique) {
    const meta = DOCUMENT_TYPES[docType]
    const buffer = renderRealEstateTransferDocx(docType, fields)
    zip.file(safeDownloadFilename(`${meta.downloadBaseName} - ${grantorSlug}.docx`), buffer)
  }

  return {
    buffer: Buffer.from(zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })),
    contentType: 'application/zip',
    filename: safeDownloadFilename(`Real-Estate-Transfer - ${grantorSlug}.zip`),
  }
}
