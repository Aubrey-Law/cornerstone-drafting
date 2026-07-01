import fs from 'node:fs/promises'
import path from 'node:path'
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'
import PizZip from 'pizzip'

const outputPath = path.join(
  process.cwd(),
  'tools/aubreylaw-docgeneration/templates/personal-property-memorandum.docx',
)
const deterministicCoreDocxTimestamp = '2000-01-01T00:00:00.000Z'
const deterministicZipEntryDate = new Date(2000, 0, 1, 0, 0, 0)

function paragraph(text: string, options: { bold?: boolean; align?: keyof typeof AlignmentType; spacingAfter?: number } = {}) {
  return new Paragraph({
    alignment: options.align ? AlignmentType[options.align] : undefined,
    spacing: { after: options.spacingAfter ?? 220 },
    children: [
      new TextRun({
        text,
        bold: options.bold,
      }),
    ],
  })
}

const doc = new Document({
  creator: 'Aubrey Law',
  lastModifiedBy: 'Aubrey Law',
  revision: 1,
  sections: [
    {
      properties: {},
      children: [
        paragraph('MEMORANDUM FOR DISPOSITION OF PERSONAL EFFECTS', { bold: true, align: 'CENTER', spacingAfter: 80 }),
        paragraph('IN LAST WILL AND TESTAMENT OF {{ client.full_name | name }}', { bold: true, align: 'CENTER', spacingAfter: 360 }),
        paragraph('To my Personal Representative:', { spacingAfter: 220 }),
        paragraph(
          'This memorandum is declared to be attached to a copy of my Last Will and Testament, as provided therein and provides for the particular disposition of my Personal Effects. I direct my Personal Representative to take possession of such property as nominee only and to deliver such property to the following designated person(s) as soon after the opening of the administration of my Estate as possible.',
          { spacingAfter: 360 },
        ),
        paragraph('PERSONAL PROPERTY SCHEDULE TO BE COMPLETED BY CLIENT', { bold: true, align: 'CENTER', spacingAfter: 360 }),
        paragraph('Dated: ___________________________', { spacingAfter: 520 }),
        paragraph('____________________________________', { spacingAfter: 80 }),
        paragraph('{{ client.full_name | name }}', { spacingAfter: 0 }),
      ],
    },
  ],
})

function normalizeDocx(buffer: Buffer) {
  const inputZip = new PizZip(buffer)
  const outputZip = new PizZip()

  for (const name of Object.keys(inputZip.files).sort()) {
    const file = inputZip.files[name]

    if (file.dir) {
      outputZip.file(name, '', { dir: true, date: deterministicZipEntryDate })
      continue
    }

    const content = name === 'docProps/core.xml'
      ? file.asText()
        .replace(
          /<dcterms:created xsi:type="dcterms:W3CDTF">.*?<\/dcterms:created>/,
          `<dcterms:created xsi:type="dcterms:W3CDTF">${deterministicCoreDocxTimestamp}</dcterms:created>`,
        )
        .replace(
          /<dcterms:modified xsi:type="dcterms:W3CDTF">.*?<\/dcterms:modified>/,
          `<dcterms:modified xsi:type="dcterms:W3CDTF">${deterministicCoreDocxTimestamp}</dcterms:modified>`,
        )
      : file.asNodeBuffer()

    outputZip.file(name, content, { date: deterministicZipEntryDate, binary: Buffer.isBuffer(content) })
  }

  return outputZip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}

async function main() {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, normalizeDocx(await Packer.toBuffer(doc)))
  console.log(`Wrote ${outputPath}`)
}

void main()
