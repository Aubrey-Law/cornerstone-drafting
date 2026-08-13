/**
 * Builds tools/aubreylaw-docgeneration/templates/ferpa-release.docx.
 *
 * The firm had no FERPA source form, so this template is drafted from the
 * statute rather than converted from a Word original — which means the DOCX has
 * to be regenerable from source, not edited as an opaque binary. Run:
 *
 *   npx tsx scripts/generate-ferpa-release-template.ts
 *
 * Control tags (`{% if %}`, `{% for %}`) are authored as their own paragraphs;
 * the renderer's stripControlOnlyParagraphs unwraps them so a skipped branch
 * leaves no blank line.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  Paragraph,
  TextRun,
  type ISpacingProperties,
} from 'docx'
import PizZip from 'pizzip'

const outputPath = path.join(
  process.cwd(),
  'tools/aubreylaw-docgeneration/templates/ferpa-release.docx',
)
const deterministicCoreDocxTimestamp = '2000-01-01T00:00:00.000Z'
const deterministicZipEntryDate = new Date(2000, 0, 1, 0, 0, 0)

interface ParagraphOptions {
  align?: keyof typeof AlignmentType
  spacing?: ISpacingProperties
  indentLeft?: number
  keepNext?: boolean
}

/** A paragraph built from alternating plain/bold runs. */
function paragraph(
  runs: Array<{ text: string; bold?: boolean; italics?: boolean; size?: number; caps?: boolean }>,
  options: ParagraphOptions = {},
) {
  return new Paragraph({
    alignment: options.align ? AlignmentType[options.align] : AlignmentType.JUSTIFIED,
    spacing: options.spacing ?? { after: 200 },
    indent: options.indentLeft ? { left: options.indentLeft } : undefined,
    keepNext: options.keepNext,
    children: runs.map(run => new TextRun({
      text: run.text,
      bold: run.bold,
      italics: run.italics,
      size: run.size,
      allCaps: run.caps,
    })),
  })
}

function body(text: string, options: ParagraphOptions = {}) {
  return paragraph([{ text }], options)
}

/** A standalone Nunjucks control tag; the renderer unwraps the paragraph. */
function control(tag: string) {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: tag })],
  })
}

function heading(number: number, title: string) {
  return paragraph(
    [{ text: `${number}. `, bold: true }, { text: title, bold: true }],
    { align: 'LEFT', spacing: { before: 240, after: 80 }, keepNext: true },
  )
}

function labelled(label: string, value: string) {
  return paragraph(
    [{ text: `${label}: `, bold: true }, { text: value }],
    { align: 'LEFT', spacing: { after: 0 } },
  )
}

const doc = new Document({
  creator: 'Aubrey Law',
  lastModifiedBy: 'Aubrey Law',
  revision: 1,
  styles: {
    default: {
      document: { run: { font: 'Garamond', size: 24 } },
    },
  },
  sections: [
    {
      properties: {},
      footers: {
        default: new Footer({
          children: [
            paragraph(
              [{ text: 'FERPA RELEASE FOR [CLIENT]', size: 20 }],
              { align: 'CENTER', spacing: { after: 0 } },
            ),
          ],
        }),
      },
      children: [
        // ── Title ──────────────────────────────────────────────────────────
        paragraph(
          [{ text: 'Authorization for Release of Education Records', bold: true, caps: true, size: 28 }],
          { align: 'CENTER', spacing: { after: 60 } },
        ),
        paragraph(
          [{
            text: 'Family Educational Rights and Privacy Act, 20 U.S.C. § 1232g; 34 C.F.R. Part 99',
            italics: true,
            size: 22,
          }],
          { align: 'CENTER', spacing: { after: 240 } },
        ),

        labelled('Student', '{{ client.full_name | name }}'),
        labelled('Date of Birth', '{{ client.date_of_birth }}'),
        labelled('Institution', '{{ ferpa.school_name }}'),
        control('{% if ferpa.school_location %}'),
        labelled('Campus', '{{ ferpa.school_location }}'),
        control('{% endif %}'),

        // ── Statement of intent ────────────────────────────────────────────
        paragraph(
          [
            { text: 'Statement of Intent.', bold: true },
            {
              text: '  I am a student who has reached eighteen years of age or who attends a '
                + 'postsecondary institution. Under the Family Educational Rights and Privacy Act '
                + '(“FERPA”), the rights in my education records have transferred from my parents '
                + 'to me, and the institution named above may not disclose those records without '
                + 'my written consent. I sign this authorization so that the people I name below '
                + 'may obtain my education records, and discuss them with the institution, without '
                + 'delay and without further inquiry into my capacity or circumstances.',
            },
          ],
          { spacing: { before: 240, after: 200 } },
        ),

        // ── 1. Authorized recipients ───────────────────────────────────────
        heading(1, 'Authorized Recipients'),
        body(
          'I authorize the institution named above, and each of its offices, officers, employees, '
          + 'and agents, to disclose my education records to the following persons, or any of them:',
        ),
        paragraph([{ text: '{{ ferpa.recipients }}' }], { align: 'LEFT', indentLeft: 720 }),
        body(
          'An Authorized Recipient may make inquiries, request copies, and discuss the contents of '
          + 'my education records with the institution to the same extent I could.',
        ),

        // ── 2. Records covered ─────────────────────────────────────────────
        heading(2, 'Records Covered'),
        control('{% if ferpa.all_records %}'),
        body(
          'I authorize the disclosure of all of my education records, without limitation, '
          + 'including academic, financial, disciplinary, and housing records.',
        ),
        control('{% else %}'),
        body('I authorize the disclosure of the following categories of my education records:'),
        control('{% for record in ferpa.records %}'),
        paragraph(
          [{ text: '•  ' }, { text: '{{ record.label }}' }],
          { align: 'LEFT', indentLeft: 720, spacing: { after: 60 } },
        ),
        control('{% endfor %}'),
        control('{% endif %}'),

        // Campus treatment records ride inside section 2 rather than taking a
        // number of their own, so sections 3–7 keep static numbering whether or
        // not the student selected the health center.
        control('{% if ferpa_includes_health_center %}'),
        paragraph(
          [
            { text: 'Campus health and counseling records.', bold: true },
            {
              text: '  I understand that treatment records maintained by the institution’s health '
                + 'or counseling center are generally excluded from FERPA’s definition of '
                + '“education records” under 34 C.F.R. § 99.3, and are governed instead by state '
                + 'law and, where it applies, the Health Insurance Portability and Accountability '
                + 'Act. To the fullest extent the institution may lawfully do so, I authorize '
                + 'disclosure of those records to my Authorized Recipients. I have signed a '
                + 'separate authorization addressed to my health care providers for the same purpose.',
            },
          ],
          { spacing: { before: 120, after: 200 } },
        ),
        control('{% endif %}'),

        // ── 3–7 ────────────────────────────────────────────────────────────
        heading(3, 'Purpose'),
        body(
          'Disclosure may be made for any purpose an Authorized Recipient reasonably requests, '
          + 'including reviewing my academic standing, paying or disputing charges on my student '
          + 'account, addressing financial aid, arranging housing, and responding to disciplinary '
          + 'or conduct proceedings.',
        ),

        heading(4, 'Duration and Revocation'),
        body(
          'This authorization takes effect on the date I sign it and remains in effect until I '
          + 'revoke it. I may revoke it at any time by delivering a written revocation to the '
          + 'institution’s registrar or other custodian of records. A revocation does not affect '
          + 'any disclosure the institution made before it received my revocation.',
        ),

        heading(5, 'Voluntary Authorization'),
        body(
          'I understand that signing this authorization is voluntary, and that the institution may '
          + 'not condition my enrollment, financial aid, or receipt of any benefit on whether I '
          + 'sign it.',
        ),

        heading(6, 'Copies and Counterparts'),
        body(
          'A photocopy, facsimile, or electronic image of this authorization has the same force and '
          + 'effect as an original. If I sign this authorization in counterparts, each counterpart '
          + 'has equal force and effect.',
        ),

        heading(7, 'Institutional Forms'),
        body(
          'I understand that my institution may also require its own release form or an '
          + 'authorization submitted through its student portal. This authorization is in addition '
          + 'to any such form, and not a substitute for one.',
        ),

        // ── Signature ──────────────────────────────────────────────────────
        paragraph(
          [{ text: 'Dated:  ' }, { text: '{{ execution.display_doc_date }}' }],
          { align: 'LEFT', spacing: { before: 480, after: 480 } },
        ),
        paragraph(
          [{ text: '____________________________________________' }],
          { align: 'LEFT', indentLeft: 3600, spacing: { after: 0 } },
        ),
        paragraph(
          [{ text: '{{ client.full_name | name }}' }, { text: ', Student' }],
          { align: 'LEFT', indentLeft: 3600, spacing: { after: 0 } },
        ),
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
