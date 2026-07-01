import fs from 'node:fs/promises'
import path from 'node:path'
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'
import PizZip from 'pizzip'

const outputPath = path.join(
  process.cwd(),
  'tools/aubreylaw-docgeneration/templates/testamentary-trust-will.docx',
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
        paragraph('LAST WILL AND TESTAMENT WITH TESTAMENTARY TRUST', { bold: true, align: 'CENTER', spacingAfter: 80 }),
        paragraph('OF {{ client.full_name | name }}', { bold: true, align: 'CENTER', spacingAfter: 360 }),
        paragraph('{{ include_clause("will.family_declaration") }}'),
        paragraph('{{ include_clause("will.executor_appointment") }}'),
        paragraph('{{ include_clause("will.bond_supervision") }}'),
        paragraph('{{ include_clause("will.tangible_personal_property") }}'),
        paragraph('{% if has_specific_gifts %}{{ include_clause("will.specific_gifts") }}{% endif %}'),
        paragraph('{% if has_pet_care %}{{ include_clause("will.pet_care") }}{% endif %}'),
        paragraph('{{ include_clause("testamentary_will.residuary_testamentary_trust") }}'),
        paragraph('{{ include_clause("testamentary_will.trustee_nomination") }}'),
        paragraph('{% if testamentary_trust.trust_protector_requested %}{{ include_clause("testamentary_will.trust_protector") }}{% endif %}'),
        paragraph('{{ include_clause("will.guardian_nomination") }}'),
        paragraph('{% if has_simultaneous_death %}{{ include_clause("will.simultaneous_death") }}{% endif %}'),
        paragraph('{{ include_clause("will.utma") }}'),
        paragraph('{% if will.no_contest_clause == "include" %}{{ include_clause("will.no_contest") }}{% endif %}'),
        paragraph('{% if will.include_disclaimer_article %}{{ include_clause("will.disclaimer") }}{% endif %}'),
        paragraph('{{ include_clause("execution.signing_block") }}'),
        paragraph('{% if will.include_self_proving_affidavit %}{{ include_clause("execution.self_proving_affidavit", state.code) }}{% endif %}'),
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
      : name.startsWith('word/') && name.endsWith('.xml')
        ? file.asText().replaceAll('&quot;', '"')
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
