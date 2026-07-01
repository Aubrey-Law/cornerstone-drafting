import fs from 'node:fs/promises'
import path from 'node:path'
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import PizZip from 'pizzip'

const outputPath = path.join(
  process.cwd(),
  'tools/aubreylaw-docgeneration/templates/estate-plan-summary.docx',
)
const deterministicCoreDocxTimestamp = '2000-01-01T00:00:00.000Z'
const deterministicZipEntryDate = new Date(2000, 0, 1, 0, 0, 0)

function paragraph(
  text: string,
  options: { bold?: boolean; align?: keyof typeof AlignmentType; spacingAfter?: number; heading?: keyof typeof HeadingLevel } = {},
) {
  return new Paragraph({
    alignment: options.align ? AlignmentType[options.align] : undefined,
    heading: options.heading ? HeadingLevel[options.heading] : undefined,
    spacing: { after: options.spacingAfter ?? 180 },
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
        paragraph('Estate Plan Summary', { bold: true, align: 'CENTER', heading: 'TITLE', spacingAfter: 120 }),
        paragraph('{% if has_spouse %}{{ client.full_name }} and {{ spouse.full_name }}{% else %}{{ client.full_name }}{% endif %}', {
          align: 'CENTER',
          spacingAfter: 80,
        }),
        paragraph('{{ execution.display_doc_date }}', { align: 'CENTER', spacingAfter: 80 }),
        paragraph('Prepared by Aubrey Law', { align: 'CENTER', spacingAfter: 320 }),
        paragraph('This summary is provided to help you review the draft estate-planning documents. The signed legal documents control if anything in this summary differs from the documents themselves.'),
        paragraph('{% if has_spouse %}Your Estate Plan as a Couple{% else %}Your Estate Plan{% endif %}', {
          bold: true,
          heading: 'HEADING_1',
        }),
        paragraph('{% if has_spouse %}This package summarizes the draft documents prepared for {{ client.full_name }} and {{ spouse.full_name }}. Some documents may be joint, and some may be individual companion documents for each spouse.{% else %}This package summarizes the draft documents prepared for {{ client.full_name }}.{% endif %}'),
        paragraph('{% if planning.include_trust %}Your Revocable Living Trust{% endif %}', { bold: true, heading: 'HEADING_2' }),
        paragraph('{% if planning.include_trust and has_spouse %}Trust Name and Identity: {{ trust.name }} dated {{ trust.display_date }}. The trust is intended to hold trust assets for both of you during life and direct distribution after death.{% elif planning.include_trust %}Trust Name and Identity: {{ trust.name }} dated {{ trust.display_date }}. For transferring assets and naming the trust on beneficiary designations, use the trust name and trustee language shown in the trust document.{% endif %}'),
        paragraph('{% if planning.include_trust %}Trustees: {{ fiduciaries.trustee.primary.full_name }} serves initially. Successor trustee: {{ fiduciaries.trustee.successor.full_name }}{% if fiduciaries.trustee.second_successor.full_name %}, then {{ fiduciaries.trustee.second_successor.full_name }}{% endif %}.{% endif %}'),
        paragraph('{% if planning.include_trust %}During lifetime, you keep control of trust property while you are able. If incapacity occurs, the successor Trustee can step in without a court proceeding. After death, remaining trust property is distributed under the trust terms, including any staged distribution provisions and beneficiary protections selected in the design sheet.{% endif %}'),
        paragraph('{% if planning.include_pour_over_will %}Your Pour-Over Will{% elif planning.include_simple_will %}Your Will{% elif planning.include_testamentary_trust_will %}Your Testamentary Trust Will{% endif %}', {
          bold: true,
          heading: 'HEADING_2',
        }),
        paragraph('{% if planning.include_pour_over_will %}The pour-over will works with the trust. Property still in an individual name at death is directed into the trust and distributed under the trust terms. It also names the Personal Representative and sets the bond and administration provisions.{% elif planning.include_simple_will %}The will names the Personal Representative, directs disposition of tangible personal property and the residuary estate, and includes the selected administration provisions.{% elif planning.include_testamentary_trust_will %}The testamentary trust will names the Personal Representative and creates trust provisions inside the will for beneficiaries who are intended to receive property in trust after death.{% endif %}'),
        paragraph('{% if planning.include_pour_over_will or planning.include_simple_will or planning.include_testamentary_trust_will %}Personal Representative: {{ fiduciaries.executor.primary.full_name }}{% if fiduciaries.executor.co_primary.full_name %} and {{ fiduciaries.executor.co_primary.full_name }}{% endif %}. Successor: {{ fiduciaries.executor.successor.full_name }}{% if fiduciaries.executor.second_successor.full_name %}, then {{ fiduciaries.executor.second_successor.full_name }}{% endif %}.{% endif %}'),
        paragraph('{% if has_spouse and planning.spouse_docs and (planning.include_pour_over_will or planning.include_testamentary_trust_will) %}The package also includes companion will documents for {{ spouse.full_name }} using the spouse fiduciary selections from the design sheet.{% endif %}'),
        paragraph('{% if planning.include_dpoa %}Durable Power of Attorney{% endif %}', { bold: true, heading: 'HEADING_2' }),
        paragraph('{% if planning.include_dpoa %}The durable power of attorney appoints an agent to handle financial and legal affairs during incapacity. Agent: {{ fiduciaries.agent.primary.full_name }}{% if fiduciaries.agent.co_primary.full_name %} and {{ fiduciaries.agent.co_primary.full_name }}{% endif %}. Successor: {{ fiduciaries.agent.successor.full_name }}.{% endif %}'),
        paragraph('{% if has_spouse and planning.spouse_docs and planning.include_dpoa %}{{ spouse.full_name }} has a companion durable power of attorney naming {{ fiduciaries.spouse_agent.primary.full_name }} as agent and {{ fiduciaries.spouse_agent.successor.full_name }} as successor agent.{% endif %}'),
        paragraph('{% if planning.include_hcp %}Health Care Proxy{% endif %}', { bold: true, heading: 'HEADING_2' }),
        paragraph('{% if planning.include_hcp %}The Massachusetts Health Care Proxy appoints someone to make medical decisions if capacity is lost. Health Care Agent: {{ healthcare.agent.primary.full_name }}. Alternate: {{ healthcare.agent.alternate.full_name }}.{% endif %}'),
        paragraph('{% if has_spouse and planning.spouse_docs and planning.include_hcp %}{{ spouse.full_name }} has a companion Health Care Proxy naming {{ healthcare.spouse_agent.primary.full_name }} as agent and {{ healthcare.spouse_agent.alternate.full_name }} as alternate agent.{% endif %}'),
        paragraph('{% if planning.include_ahd %}Advance Health Directive{% endif %}', { bold: true, heading: 'HEADING_2' }),
        paragraph('{% if planning.include_ahd %}The advance directive states end-of-life care wishes so the Health Care Agent and physicians do not have to guess. It is intended to guide decisions about life-sustaining treatment, comfort care, and related medical choices.{% endif %}'),
        paragraph('{% if planning.include_hipaa %}HIPAA Authorization{% endif %}', { bold: true, heading: 'HEADING_2' }),
        paragraph('{% if planning.include_hipaa %}The HIPAA authorization allows the people chosen to act for you to receive medical information and communicate with health-care providers when needed.{% endif %}'),
        paragraph('{% if planning.include_ppm %}Personal Property Memorandum{% endif %}', { bold: true, heading: 'HEADING_2' }),
        paragraph('{% if planning.include_ppm %}The personal property memorandum lets you direct specific tangible personal property, such as jewelry, furniture, artwork, and keepsakes, without changing the will or trust.{% endif %}'),
        paragraph('Key People at a Glance', { bold: true, heading: 'HEADING_1' }),
        paragraph('Trustee: {{ fiduciaries.trustee.primary.full_name }}; successor {{ fiduciaries.trustee.successor.full_name }}{% if fiduciaries.trustee.second_successor.full_name %}; second successor {{ fiduciaries.trustee.second_successor.full_name }}{% endif %}.'),
        paragraph('Personal Representative: {{ fiduciaries.executor.primary.full_name }}{% if fiduciaries.executor.co_primary.full_name %} and {{ fiduciaries.executor.co_primary.full_name }}{% endif %}; successor {{ fiduciaries.executor.successor.full_name }}.'),
        paragraph('{% if planning.include_dpoa %}Power of Attorney Agent: {{ fiduciaries.agent.primary.full_name }}; successor {{ fiduciaries.agent.successor.full_name }}.{% endif %}'),
        paragraph('{% if planning.include_hcp %}Health Care Agent: {{ healthcare.agent.primary.full_name }}; alternate {{ healthcare.agent.alternate.full_name }}.{% endif %}'),
        paragraph('Next Steps', { bold: true, heading: 'HEADING_1' }),
        paragraph('Review the drafts carefully, especially names, fiduciary appointments, beneficiary provisions, distribution ages, and any special provisions. Send Aubrey Law any corrections, missing information, or questions before execution.'),
        paragraph('Important Disclaimer: This summary is informational only and does not replace the legal documents. If there is any discrepancy, the legal documents control.'),
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
          /<dcterms:created xsi:type="W3CDTF">.*?<\/dcterms:created>|<dcterms:created xsi:type="dcterms:W3CDTF">.*?<\/dcterms:created>/,
          `<dcterms:created xsi:type="dcterms:W3CDTF">${deterministicCoreDocxTimestamp}</dcterms:created>`,
        )
        .replace(
          /<dcterms:modified xsi:type="W3CDTF">.*?<\/dcterms:modified>|<dcterms:modified xsi:type="dcterms:W3CDTF">.*?<\/dcterms:modified>/,
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
